const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('./metron.js');

function response() {
	const headers = new Map();
	return {
		statusCode: 200,
		body: undefined,
		setHeader(name, value) { headers.set(name.toLowerCase(), value); },
		get headers() { return headers; },
		end(body) { this.body = body; }
	};
}

function request(url, method = 'GET') {
	return { method, url };
}

test('validates only the two issue operations', () => {
	const { validateRequest } = handler._test;
	assert.deepEqual(validateRequest(request('/api/metron?action=search&q=Batman')), { action: 'search', q: 'Batman', page: 1 });
	assert.deepEqual(validateRequest(request('/api/metron?action=search&q=Batman&number=%201A%20')), { action: 'search', q: 'Batman', page: 1, number: '1A' });
	assert.deepEqual(validateRequest(request('/api/metron?action=detail&id=42')), { action: 'detail', id: '42' });
	assert.equal(validateRequest(request('/api/metron?action=search&q=Batman&url=https://evil.test')).status, 400);
	assert.equal(validateRequest(request(`/api/metron?action=search&q=Batman&number=${'1'.repeat(31)}`)).status, 400);
	assert.equal(validateRequest(request('/api/metron?action=search&q=Batman&number=%00')).status, 400);
	assert.equal(validateRequest(request('/api/metron?action=detail&id=0')).status, 400);
	assert.equal(validateRequest(request('/api/metron?action=search&q=Batman&q=Spawn')).status, 400);
	assert.equal(validateRequest(request('/api/metron?action=search&q=Batman', 'POST')).status, 405);
});

test('forwards only fixed Metron URLs and server-side bearer auth', async () => {
	const oldKey = process.env.METRON_KEY;
	const oldFetch = global.fetch;
	process.env.METRON_KEY = 'unit-test-token';
	const calls = [];
	global.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return {
			ok: true,
			arrayBuffer: async () => Buffer.from(JSON.stringify({ results: [] }))
		};
	};
	try {
		const res = response();
		await handler(request('/api/metron?action=search&q=Batman&page=2&number=1'), res);
		assert.equal(res.statusCode, 200);
		assert.equal(calls[0].url, 'https://metron.cloud/api/issue/?series_name=Batman&page=2&number=1');
		assert.equal(calls[0].init.headers.Authorization, 'Bearer unit-test-token');
		assert.equal(calls[0].init.headers.authorization, undefined);

		const detail = response();
		await handler(request('/api/metron?action=detail&id=42'), detail);
		assert.equal(calls[1].url, 'https://metron.cloud/api/issue/42/');
	} finally {
		if (oldKey === undefined) delete process.env.METRON_KEY;
		else process.env.METRON_KEY = oldKey;
		global.fetch = oldFetch;
		handler._test.resetRateLimit();
	}
});

test('does not expose upstream response bodies', async () => {
	const oldKey = process.env.METRON_KEY;
	const oldFetch = global.fetch;
	process.env.METRON_KEY = 'unit-test-token';
	global.fetch = async () => ({ ok: false, status: 401, arrayBuffer: async () => Buffer.from('secret upstream detail') });
	try {
		const res = response();
		await handler(request('/api/metron?action=detail&id=42'), res);
		assert.equal(res.statusCode, 401);
		assert.deepEqual(JSON.parse(res.body), { error: 'Metron request failed (401)' });
		assert.doesNotMatch(res.body, /secret upstream detail/);
	} finally {
		if (oldKey === undefined) delete process.env.METRON_KEY;
		else process.env.METRON_KEY = oldKey;
		global.fetch = oldFetch;
		handler._test.resetRateLimit();
	}
});

test('blocks anonymous production relay', async () => {
	const before = process.env.VERCEL;
	process.env.VERCEL = '1';
	try {
		const res = response();
		await handler(request('/api/metron?action=detail&id=42'), res);
		assert.equal(res.statusCode, 503);
	} finally {
		if (before === undefined) delete process.env.VERCEL;
		else process.env.VERCEL = before;
	}
});
