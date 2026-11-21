const METRON_ISSUE_URL = 'https://metron.cloud/api/issue/';
const MAX_QUERY_LENGTH = 120;
const MAX_NUMBER_LENGTH = 30;
const MAX_PAGE = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const REQUEST_TIMEOUT_MS = 8_000;

// This is intentionally process-local. Vercel may run several instances, so this
// complements (rather than replaces) Metron's own rate limit.
const requestTimes = [];
let activeRequests = 0;

function json(res, status, body) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Cache-Control', 'private, no-store');
	res.end(JSON.stringify(body));
}

function metronKey() {
	return String(process.env.METRON_KEY || process.env.metron_key || '').trim();
}

function queryEntries(req) {
	let url;
	try {
		url = new URL(req.url || '/', 'http://localhost');
	} catch {
		return { error: 'Invalid request URL' };
	}
	const entries = [...url.searchParams.entries()];
	const values = new Map();
	for (const [name, value] of entries) {
		if (values.has(name)) return { error: `Duplicate parameter: ${name}` };
		values.set(name, value);
	}
	return { values };
}

function validateRequest(req) {
	if (req.method !== 'GET') return { status: 405, error: 'Only GET is allowed' };
	const parsed = queryEntries(req);
	if (parsed.error) return { status: 400, error: parsed.error };
	const values = parsed.values;
	const action = values.get('action');
	if (action !== 'search' && action !== 'detail') return { status: 400, error: 'action must be search or detail' };

	const allowed = action === 'search' ? new Set(['action', 'q', 'page', 'number']) : new Set(['action', 'id']);
	for (const name of values.keys()) {
		if (!allowed.has(name)) return { status: 400, error: `Unsupported parameter: ${name}` };
	}

	if (action === 'search') {
		const q = values.get('q')?.trim();
		if (!q || q.length > MAX_QUERY_LENGTH) return { status: 400, error: `q must be 1-${MAX_QUERY_LENGTH} characters` };
		const pageText = values.get('page');
		const page = pageText === undefined ? 1 : Number(pageText);
		if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE || (pageText !== undefined && !/^\d+$/.test(pageText))) {
			return { status: 400, error: `page must be an integer from 1 to ${MAX_PAGE}` };
		}
		const number = values.get('number')?.trim();
		if (number !== undefined && (!number || number.length > MAX_NUMBER_LENGTH || /[\u0000-\u001f\u007f]/.test(number))) {
			return { status: 400, error: `number must be 1-${MAX_NUMBER_LENGTH} characters` };
		}
		return { action, q, page, ...(number === undefined ? {} : { number }) };
	}

	const id = values.get('id');
	if (!id || !/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2_147_483_647) {
		return { status: 400, error: 'id must be a positive integer' };
	}
	return { action, id };
}

function takeRequestSlot() {
	const now = Date.now();
	while (requestTimes[0] !== undefined && requestTimes[0] <= now - REQUEST_WINDOW_MS) requestTimes.shift();
	if (activeRequests >= 2 || requestTimes.length >= MAX_REQUESTS_PER_WINDOW) return false;
	activeRequests++;
	requestTimes.push(now);
	return true;
}

function releaseRequestSlot() {
	activeRequests = Math.max(0, activeRequests - 1);
}

async function readJson(response) {
	const reader = response.body?.getReader?.();
	if (reader) {
		const chunks = [];
		let total = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > MAX_RESPONSE_BYTES) {
					await reader.cancel().catch(() => {});
					throw new Error('response too large');
				}
				chunks.push(Buffer.from(value));
			}
		} finally {
			reader.releaseLock?.();
		}
		return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
	}
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('response too large');
	return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

async function fetchMetron(request) {
	const url = new URL(request.action === 'detail' ? `${METRON_ISSUE_URL}${request.id}/` : METRON_ISSUE_URL);
	if (request.action === 'search') {
		url.searchParams.set('series_name', request.q);
		url.searchParams.set('page', String(request.page));
		if (request.number !== undefined) url.searchParams.set('number', request.number);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: { Accept: 'application/json', Authorization: `Bearer ${metronKey()}` },
			signal: controller.signal
		});
		if (!response.ok) {
			const error = new Error(`Metron returned ${response.status}`);
			error.status = response.status;
			throw error;
		}
		return await readJson(response);
	} finally {
		clearTimeout(timer);
	}
}

async function handler(req, res) {
	// Public hosting has no application authentication yet. Never expose the
	// server credential as an anonymous relay, even behind a per-process limit.
	if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
		return json(res, 503, { error: 'Metron proxy requires access control before public deployment' });
	}
	const request = validateRequest(req);
	if (request.status) {
		if (request.status === 405) res.setHeader('Allow', 'GET');
		return json(res, request.status, { error: request.error });
	}
	if (!metronKey()) return json(res, 503, { error: 'Metron is not configured' });
	if (!takeRequestSlot()) return json(res, 429, { error: 'Metron proxy rate limit exceeded' });
	try {
		return json(res, 200, await fetchMetron(request));
	} catch (error) {
		const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
		return json(res, status, { error: status === 502 ? 'Metron request failed' : `Metron request failed (${status})` });
	} finally {
		releaseRequestSlot();
	}
}

module.exports = handler;
module.exports._test = { validateRequest, fetchMetron, resetRateLimit: () => { requestTimes.length = 0; activeRequests = 0; } };
