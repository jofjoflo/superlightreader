import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anilist } from './anilist.ts';
import { googleBooks } from './googlebooks.ts';
import { NetError, fetchJson, netConfig } from './net.ts';
import { openLibrary } from './openlibrary.ts';
import { pickPublisher } from './shared.ts';
import { classify, wikipedia } from './wikipedia.ts';
import { type Call, type Route, entity, fixture, mockFetch, page, reply, resetForTest, wikiRoutes } from './testkit.ts';

const realFetch = globalThis.fetch;
beforeEach(resetForTest);
afterEach(() => {
	globalThis.fetch = realFetch;
});

const batman: Route[] = [
	[(u) => u.includes('generator=search'), fixture('wikipedia-batman-search.json')],
	[(u) => u.includes('props=claims'), fixture('wikidata-batman-claims.json')],
	[(u) => u.includes('props=labels'), fixture('wikidata-batman-labels.json')]
];

describe('wikipedia (recorded Batman responses)', () => {
	it('keeps the comic series and the character, drops the films, labels resolved in one batch', async () => {
		assert.ok(fixture('wikipedia-batman-search.json').query.pages.some((p: { title: string }) => /film/.test(p.title)), 'fixture should contain a film page');
		const calls: Call[] = [];
		globalThis.fetch = mockFetch(batman, calls);
		const out = await wikipedia({ name: 'Batman' });
		assert.deepEqual(out.map((c) => [c.title, c.kind]), [['Batman', 'series'], ['Batman', 'character']]);
		const [series, character] = out;
		assert.equal(series.url, 'https://en.wikipedia.org/wiki/Batman_(comic_book)');
		assert.equal(series.publisher, 'DC Comics');
		assert.ok(series.genres?.includes('superhero comics'));
		assert.ok(series.creators?.includes('Bob Kane'));
		assert.match(series.description ?? '', /^Batman is an ongoing/);
		assert.ok((series.description ?? '').length <= 700);
		assert.equal(character.startYear, 1939); // "+1939-00-00T00:00:00Z"
		assert.ok(out.every((c) => !/film/i.test(c.url ?? '')));
		// search → claims → ONE labels batch; every request is a plain GET with origin=* and no headers
		assert.equal(calls.length, 3);
		assert.ok(calls.every((c) => c.init?.headers === undefined && c.init?.method === undefined && c.url.includes('origin=*')));
		assert.equal(calls.filter((c) => c.url.includes('props=labels')).length, 1);
		// labels are cached: a second lookup needs no labels request
		await wikipedia({ name: 'Batman' });
		assert.equal(calls.length, 5);
	});

	it('falls back to Swedish when English has no plausible title', async () => {
		const calls: Call[] = [];
		globalThis.fetch = mockFetch(
			[
				[(u) => u.includes('en.wikipedia.org'), { query: { pages: [] } }],
				...wikiRoutes({
					pages: [page('Fantomen', 'Q947755', 'tecknad serie skapad av Lee Falk', 1, 'Fantomen är en tecknad serie.')],
					entities: { Q947755: entity('Q947755', { P31: ['Q1114461'], P123: ['Q1'] }, { P577: [1936] }) },
					labels: { Q1114461: 'comic strip', Q1: 'King Features Syndicate' }
				})
			],
			calls
		);
		const out = await wikipedia({ name: 'Fantomen' });
		assert.equal(out.length, 1);
		assert.match(out[0].url ?? '', /^https:\/\/sv\.wikipedia\.org\/wiki\/Fantomen$/);
		assert.deepEqual([out[0].publisher, out[0].startYear], ['King Features Syndicate', 1936]);
		assert.deepEqual(calls.filter((c) => c.url.includes('generator=search')).map((c) => c.url.slice(8, 10)), ['en', 'sv']);
	});

	it('throws when Wikipedia cannot be reached (so the lookup is retried, not marked notFound)', async () => {
		globalThis.fetch = mockFetch([]);
		await assert.rejects(wikipedia({ name: 'Batman' }), NetError);
	});

	it('classify: P31 decides, films/TV/novels are rejected even when they mention comics', () => {
		assert.equal(classify(['comic book series'], '', [], ''), 'series');
		assert.equal(classify(['comics character', 'film character'], '', [], ''), 'character');
		assert.equal(classify(['film'], '2009 film directed by Zack Snyder', ['superhero film'], 'based on the DC Comics series'), undefined);
		assert.equal(classify(['television series'], 'based on the comic', [], ''), undefined);
		assert.equal(classify(['limited series', 'literary work'], 'superhero comic book series by Alan Moore', [], ''), 'series');
		assert.equal(classify(['Wikimedia disambiguation page'], '', [], 'may refer to a comic'), undefined);
		assert.equal(classify(['literary genre'], '', [], 'Sagas are prose narratives'), undefined);
		assert.equal(classify(['comic book'], 'svensk serietidning från 1948', [], ''), 'series');
	});
});

describe('anilist (recorded Berserk response)', () => {
	it('parses manga hits: plain-text description, genres, years, staff, recommendations', async () => {
		const calls: Call[] = [];
		globalThis.fetch = mockFetch([[/graphql\.anilist\.co/, fixture('anilist-berserk.json')]], calls);
		const out = await anilist({ name: 'Berserk', manga: true });
		const b = out[0];
		assert.deepEqual([b.title, b.kind, b.startYear, b.status, b.source], ['Berserk', 'series', 1989, 'ongoing', 'anilist']);
		assert.ok(b.genres?.includes('Action'));
		assert.ok(b.creators?.includes('Kentarou Miura'));
		assert.ok(b.related?.includes('Vinland Saga'));
		assert.ok(b.description && b.description.length <= 700 && !/[<>]|~!|\(Source/.test(b.description), b.description);
		// the one request with a header: POST + JSON content-type only
		assert.equal(calls.length, 1);
		assert.equal(calls[0].init?.method, 'POST');
		assert.deepEqual(Object.keys(calls[0].init?.headers as object), ['Content-Type']);
		assert.deepEqual(JSON.parse(String(calls[0].init?.body)).variables, { search: 'Berserk' });
	});

	it('light novels count as media; a GraphQL error is a failed source', async () => {
		const novel = { format: 'NOVEL', title: { romaji: 'Berserk of Gluttony', english: null }, status: 'CANCELLED', genres: [], startDate: { year: 2017 }, endDate: { year: null } };
		globalThis.fetch = mockFetch([[/anilist/, { data: { Page: { media: [novel] } } }]]);
		const [n] = await anilist({ name: 'Berserk of Gluttony' });
		assert.deepEqual([n.kind, n.status, n.endYear], ['media', 'ended', undefined]);
		globalThis.fetch = mockFetch([[/anilist/, { errors: [{ message: 'Too Many Requests.' }], data: null }]]);
		await assert.rejects(anilist({ name: 'x' }), /Too Many Requests/);
	});
});

describe('googlebooks / openlibrary', () => {
	it('Google Books: merges volumes of one series, drops other categories and other titles, strips HTML + credits', async () => {
		globalThis.fetch = mockFetch([[/googleapis/, fixture('googlebooks-batman.json')]]);
		const out = await googleBooks({ name: 'Batman' });
		assert.equal(out.length, 1);
		assert.deepEqual([out[0].title, out[0].publisher, out[0].startYear, out[0].kind], ['Batman', 'DC Comics', 2012, 'series']);
		assert.deepEqual(out[0].creators, ['Scott Snyder', 'Greg Capullo']);
		assert.equal(out[0].description, 'The Court of Owls has ruled Gotham from the shadows.');
	});

	it('Google Books: keyless quota (HTTP 429) is a failed source, not "no match"', async () => {
		globalThis.fetch = mockFetch([[/googleapis/, reply({ error: { code: 429 } }, 429)]]);
		await assert.rejects(googleBooks({ name: 'Batman' }), (e: unknown) => e instanceof NetError && e.status === 429);
	});

	it('Open Library: one candidate per series with the most common publisher and earliest year', async () => {
		globalThis.fetch = mockFetch([[/openlibrary/, fixture('openlibrary-batman.json')]]);
		const out = await openLibrary({ name: 'Batman' });
		assert.equal(out.length, 1);
		const c = out[0];
		assert.deepEqual([c.title, c.publisher, c.kind], ['Batman', 'DC Comics', 'series']);
		assert.ok(c.startYear && c.startYear >= 1939 && c.startYear <= 2000, String(c.startYear));
		assert.ok(c.creators?.length);
		assert.ok(c.genres?.some((g) => /comic|fiction/i.test(g)));
	});

	it('Open Library: unrelated subjects and titles are dropped; an unverified hit is "unknown"', async () => {
		const docs = [
			{ title: 'Saga', subject: ['Norse mythology'], publisher: ['X'] },
			{ title: 'Fear Street saga', subject: ['Horror stories'] },
			{ title: 'Saga', publisher: ['Image Comics'], first_publish_year: 2012 }
		];
		globalThis.fetch = mockFetch([[/openlibrary/, { numFound: 3, docs }]]);
		const out = await openLibrary({ name: 'Saga' });
		assert.deepEqual(out.map((c) => [c.title, c.kind, c.publisher]), [['Saga', 'unknown', 'Image Comics']]);
	});
});

describe('pickPublisher', () => {
	it('prefers known brands and ignores self-publishing / rebinder noise', () => {
		assert.equal(pickPublisher(['Independently Published', 'Independently Published', 'Dark Horse Comics']), 'Dark Horse Comics');
		assert.equal(pickPublisher(['Jump Comics', 'Viz Media, LLC']), 'Viz Media');
		assert.equal(pickPublisher(['Turtleback', 'Planeta']), 'Planeta');
		assert.equal(pickPublisher(['CreateSpace Independent Publishing Platform']), undefined);
	});
});

describe('net', () => {
	it('keeps at most 2 requests in flight', async () => {
		let now = 0, max = 0;
		globalThis.fetch = (async () => {
			max = Math.max(max, ++now);
			await new Promise((r) => setTimeout(r, 10));
			now--;
			return reply({ ok: 1 });
		}) as typeof fetch;
		await Promise.all(Array.from({ length: 6 }, (_, i) => fetchJson(`https://example.test/${i}`)));
		assert.equal(max, 2);
	});

	it('times out after netConfig.timeoutMs with a NetError', async () => {
		netConfig.timeoutMs = 30;
		globalThis.fetch = ((_u: string, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)))) as typeof fetch;
		await assert.rejects(fetchJson('https://example.test/slow'), (e: unknown) => e instanceof NetError && /timeout/.test(e.message));
	});

	it('rethrows a caller abort as-is (not a NetError) and frees the slot', async () => {
		const ac = new AbortController();
		globalThis.fetch = ((_u: string, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)))) as typeof fetch;
		const p = fetchJson('https://example.test/x', {}, ac.signal);
		setTimeout(() => ac.abort(), 10);
		await assert.rejects(p, (e: unknown) => !(e instanceof NetError));
		globalThis.fetch = mockFetch([[/.*/, { ok: true }]]);
		assert.deepEqual(await fetchJson('https://example.test/y'), { ok: true });
	});

	it('cools a host down after HTTP 429: too long to wait → fails fast without calling fetch again', async () => {
		netConfig.minCooldownMs = netConfig.defaultCooldownMs = 1000;
		netConfig.maxWaitMs = 0;
		const calls: Call[] = [];
		globalThis.fetch = mockFetch([[/rate\.test/, () => reply({}, 429)]], calls);
		await assert.rejects(fetchJson('https://rate.test/a'), (e: unknown) => e instanceof NetError && e.status === 429);
		await assert.rejects(fetchJson('https://rate.test/b'), (e: unknown) => e instanceof NetError && /rate limiting/.test(e.message));
		assert.equal(calls.length, 1);
	});

	it('retries once after a short cool-down (429, then 503 is not retried twice)', async () => {
		let n = 0;
		globalThis.fetch = mockFetch([[/retry\.test/, () => (++n === 1 ? reply({}, 429) : { ok: n })]]);
		assert.deepEqual(await fetchJson('https://retry.test/a'), { ok: 2 });
		n = 0;
		globalThis.fetch = mockFetch([[/retry2\.test/, () => (++n, reply({}, 503))]]);
		await assert.rejects(fetchJson('https://retry2.test/a'), (e: unknown) => e instanceof NetError && e.status === 503);
		assert.equal(n, 2);
	});

	it('sends plain GETs (no headers, no method) and paces requests to one host', async () => {
		netConfig.defaultGapMs = 60;
		const starts: number[] = [];
		const calls: Call[] = [];
		globalThis.fetch = mockFetch([[/.*/, () => (starts.push(Date.now()), { ok: true })]], calls);
		await Promise.all([fetchJson('https://example.test/a'), fetchJson('https://example.test/b')]);
		assert.equal(calls[0].init?.headers, undefined);
		assert.equal(calls[0].init?.method, undefined);
		assert.ok(starts[1] - starts[0] >= 50, `${starts[1] - starts[0]} ms between starts`);
	});
});
