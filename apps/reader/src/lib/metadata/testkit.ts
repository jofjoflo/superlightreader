/** Test helpers for the metadata modules (not a test file): fixture loading, a routed fetch mock, tiny Wikipedia/Wikidata builders. */
import { readFileSync } from 'node:fs';
import { netConfig, resetNet } from './net.ts';
import { resetWikidataCache } from './wikipedia.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

export type Call = { url: string; init?: RequestInit };
export type Route = [match: RegExp | ((url: string) => boolean), reply: unknown];

export const reply = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** First matching route answers (a function reply gets (url, init); a Response is passed through); no match = dead network (TypeError). */
export function mockFetch(routes: Route[], calls: Call[] = []): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		const hit = routes.find(([m]) => (typeof m === 'function' ? m(url) : m.test(url)));
		if (!hit) throw new TypeError(`network down: ${url}`);
		const r = typeof hit[1] === 'function' ? await (hit[1] as (u: string, i?: RequestInit) => unknown)(url, init) : hit[1];
		return r instanceof Response ? r : reply(r);
	}) as typeof fetch;
}

/** Every source answers successfully with nothing. */
export const emptyBody = (url: string): unknown =>
	url.includes('graphql') ? { data: { Page: { media: [] } } } : url.includes('googleapis') ? { kind: 'books#volumes', totalItems: 0 } : url.includes('openlibrary') ? { numFound: 0, docs: [] } : url.includes('generator=search') ? { query: { pages: [] } } : { entities: {} };
export const emptyRoutes = (): Route[] => [[() => true, (u: string) => emptyBody(u)]];

/** No pacing, default limits, empty caches: call in beforeEach. */
export function resetForTest(): void {
	netConfig.gapMs = {};
	netConfig.defaultGapMs = 0;
	netConfig.timeoutMs = 8000;
	netConfig.maxInFlight = 2;
	netConfig.cooldownMs = {};
	netConfig.defaultCooldownMs = 20;
	netConfig.minCooldownMs = 20;
	netConfig.maxWaitMs = 100;
	resetNet();
	resetWikidataCache();
}

export const page = (title: string, qid: string, description: string, index = 1, extract = '') => ({
	pageid: index, title, index, pageprops: { wikibase_item: qid }, terms: { description: [description] }, extract
});
const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const time = (y: number) => ({ mainsnak: { datavalue: { value: { time: `+${y}-00-00T00:00:00Z` } } } });
/** Wikidata entity: `ids` maps property → item ids, `years` maps property → years. */
export const entity = (id: string, ids: Record<string, string[]>, years: Record<string, number[]> = {}) => ({
	id,
	claims: { ...Object.fromEntries(Object.entries(ids).map(([p, v]) => [p, v.map(item)])), ...Object.fromEntries(Object.entries(years).map(([p, v]) => [p, v.map(time)])) }
});
/** Routes for one Wikipedia search → claims → labels round trip. */
export function wikiRoutes(o: { pages: unknown[]; entities?: Record<string, unknown>; labels?: Record<string, string> }): Route[] {
	return [
		[(u) => u.includes('.wikipedia.org') && u.includes('generator=search'), { query: { pages: o.pages } }],
		[(u) => u.includes('wikidata.org') && u.includes('props=claims'), { entities: o.entities ?? {} }],
		[(u) => u.includes('wikidata.org') && u.includes('props=labels'), { entities: Object.fromEntries(Object.entries(o.labels ?? {}).map(([id, v]) => [id, { id, labels: { en: { language: 'en', value: v } } }])) }]
	];
}
