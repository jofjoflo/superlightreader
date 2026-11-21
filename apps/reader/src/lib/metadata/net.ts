/**
 * Shared fetch for the metadata sources. Pure module (no browser globals at import time).
 * Rules: 8 s timeout per request (AbortSignal.any([caller, timeout])), at most 2 requests in flight overall,
 * polite per-host spacing (Wikimedia answers 429 beyond ~1 req/s for scripts), a short cool-down after 429/503
 * (short ones are waited out with one retry, long ones fail fast), and no custom headers (a plain GET avoids the CORS preflight; only
 * AniList's JSON content-type is passed by its caller).
 */

export const netConfig = {
	timeoutMs: 8000,
	maxInFlight: 2,
	/** Minimum ms between request starts per host group (wikipedia.org + wikidata.org share one group). */
	gapMs: { wikimedia: 1500, 'graphql.anilist.co': 1000 } as Record<string, number>,
	defaultGapMs: 120,
	/** Cool-down after 429/503 when there is no readable Retry-After (browsers hide it on CORS responses): Wikimedia recovers in seconds, quota-style 429s (Google Books, AniList) do not. */
	cooldownMs: { wikimedia: 10_000 } as Record<string, number>,
	defaultCooldownMs: 60_000,
	/** A Retry-After is clamped to [minCooldownMs, 5 min]. */
	minCooldownMs: 5_000,
	/** A cool-down up to this long is waited out (one retry); a longer one fails the request at once so the caller retries later. */
	maxWaitMs: 20_000
};

export class NetError extends Error {
	status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = 'NetError';
		this.status = status;
	}
}

let active = 0;
const waiting: Array<() => void> = [];
const nextAt = new Map<string, number>();
const blockedUntil = new Map<string, number>();

/** Forget pacing, cool-downs and the queue (tests). */
export function resetNet(): void {
	active = 0;
	waiting.length = 0;
	nextAt.clear();
	blockedUntil.clear();
}

const abortReason = (s?: AbortSignal): unknown => s?.reason ?? new DOMException('Aborted', 'AbortError');
const groupOf = (url: string): string => {
	const h = new URL(url).hostname;
	return /(?:^|\.)(?:wikipedia|wikidata)\.org$/.test(h) ? 'wikimedia' : h;
};

function acquire(signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	if (active < netConfig.maxInFlight) {
		active++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		const go = () => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		};
		const onAbort = () => {
			const i = waiting.indexOf(go);
			if (i >= 0) waiting.splice(i, 1);
			reject(abortReason(signal));
		};
		waiting.push(go);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function release(): void {
	const next = waiting.shift();
	if (next) next(); // hand the slot over
	else active = Math.max(0, active - 1);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortReason(signal));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		if (signal?.aborted) onAbort();
		else signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** Wait out a short cool-down, then take the next spacing slot of the host group. Throws when the host is blocked for too long. */
async function pace(group: string, signal?: AbortSignal): Promise<void> {
	for (let i = 0; i < 3; i++) {
		const hold = (blockedUntil.get(group) ?? 0) - Date.now();
		if (hold > netConfig.maxWaitMs) break;
		await wait(hold, signal);
		const now = Date.now();
		const at = Math.max(now, nextAt.get(group) ?? 0);
		nextAt.set(group, at + (netConfig.gapMs[group] ?? netConfig.defaultGapMs));
		await wait(at - now, signal);
		if ((blockedUntil.get(group) ?? 0) <= Date.now()) return;
	}
	throw new NetError(`${group} is rate limiting; retry later`, 429);
}

function block(group: string, ms: number): void {
	blockedUntil.set(group, Math.max(blockedUntil.get(group) ?? 0, Date.now() + ms));
}

function cooldownFor(res: Response, group: string): number {
	const s = Number(res.headers.get('retry-after'));
	return Math.min(300_000, Math.max(netConfig.minCooldownMs, Number.isFinite(s) && s > 0 ? s * 1000 : (netConfig.cooldownMs[group] ?? netConfig.defaultCooldownMs)));
}

/** GET/POST → parsed JSON. Throws NetError on timeout, network failure, non-2xx or bad JSON; rethrows caller aborts as-is. HTTP 429/503 is retried once after a short cool-down. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<any> {
	const group = groupOf(url);
	for (let attempt = 0; ; attempt++) {
		await pace(group, signal);
		await acquire(signal);
		let status: number | undefined;
		try {
			const timeout = AbortSignal.timeout(netConfig.timeoutMs);
			let res: Response;
			try {
				res = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
			} catch (e) {
				if (signal?.aborted) throw e;
				if (timeout.aborted) throw new NetError(`timeout after ${netConfig.timeoutMs} ms`);
				block(group, netConfig.minCooldownMs); // a CORS-hidden 429 looks like any other network error
				throw new NetError(`network error: ${e instanceof Error ? e.message : String(e)}`);
			}
			if (res.ok) {
				try {
					return await res.json();
				} catch {
					throw new NetError('invalid JSON');
				}
			}
			status = res.status;
			if (status === 429 || status === 503) block(group, cooldownFor(res, group));
		} finally {
			release();
		}
		if (attempt > 0 || (status !== 429 && status !== 503)) throw new NetError(`HTTP ${status}`, status);
	}
}
