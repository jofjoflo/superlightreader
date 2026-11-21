import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { candidateToMeta, fetchSeriesMeta, searchMeta } from './index.ts';
import type { MetaCandidate } from '../types.ts';
import { type Call, type Route, emptyBody, emptyRoutes, entity, fixture, mockFetch, page, reply, resetForTest, wikiRoutes } from './testkit.ts';

const realFetch = globalThis.fetch;
beforeEach(resetForTest);
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Recorded Batman responses; any other request answers "nothing found". */
const recorded = (): Route[] => [
	[(u) => u.includes('generator=search'), fixture('wikipedia-batman-search.json')],
	[(u) => u.includes('props=claims'), fixture('wikidata-batman-claims.json')],
	[(u) => u.includes('props=labels'), fixture('wikidata-batman-labels.json')],
	[/googleapis/, fixture('googlebooks-batman.json')],
	[/openlibrary/, fixture('openlibrary-batman.json')],
	[/graphql\.anilist/, fixture('anilist-berserk.json')],
	...emptyRoutes()
];
const comicPage = (title: string, extra: Partial<{ P123: string[] }> = {}): Route[] =>
	wikiRoutes({
		pages: [page(`${title} (comic book)`, 'Q1', 'comic book series', 1, 'A description.')],
		entities: { Q1: entity('Q1', { P31: ['Q2'], ...extra }) },
		labels: { Q2: 'comic book series', Q3: 'Demo Press' }
	});

describe('candidateToMeta', () => {
	it('maps a selected candidate and cleans its description', () => {
		const c: MetaCandidate = { source: 'googlebooks', title: 'Saga', description: '<p>A story.</p> (Source: test)', publisher: 'Marvel Comics', genres: ['Sci-fi'], startYear: 2012, score: 0.9 };
		const m = candidateToMeta('s1', c, true);
		assert.equal(m.seriesId, 's1');
		assert.equal(m.publisher, 'Marvel');
		assert.equal(m.description, 'A story.');
		assert.equal(m.confidence, 0.9);
		assert.equal(m.userEdited, true);
	});
});

describe('fetchSeriesMeta', () => {
	it('picks the comic series over films and fills the missing start year from the character page', async () => {
		const calls: Call[] = [];
		globalThis.fetch = mockFetch(recorded(), calls);
		const m = await fetchSeriesMeta('b1', { name: 'Batman' });
		assert.ok(m && !m.notFound);
		assert.deepEqual([m.name, m.source, m.publisher, m.startYear, m.status], ['Batman', 'wikipedia', 'DC', 1939, undefined]);
		assert.equal(m.sourceUrl, 'https://en.wikipedia.org/wiki/Batman_(comic_book)');
		assert.equal(m.confidence, 1);
		assert.ok(m.genres?.includes('superhero comics') && m.creators?.includes('Bob Kane'));
		assert.ok(m.description && m.description.length <= 700 && !/[<>]/.test(m.description));
		assert.equal(typeof m.fetchedAt, 'number');
		assert.equal(calls.length, 3, 'complete after Wikipedia: Google Books / Open Library / AniList are not asked');
	});

	it('rejects a film-only hit (P31 = film) instead of matching it', async () => {
		globalThis.fetch = mockFetch([
			...wikiRoutes({
				pages: [page('Batman (1989 film)', 'Q1', '', 1, 'Batman is a 1989 superhero film based on the DC Comics character.')],
				entities: { Q1: entity('Q1', { P31: ['Q11424'] }) },
				labels: { Q11424: 'film' }
			}),
			...emptyRoutes()
		]);
		const m = await fetchSeriesMeta('b1', { name: 'Batman' });
		assert.equal(m?.notFound, true);
	});

	it('manga: AniList is primary, plain-text description, publisher lent by Open Library (normalised)', async () => {
		const ol = { numFound: 1, docs: [{ key: '/works/OL1W', title: 'Berserk', author_name: ['Kentaro Miura'], first_publish_year: 2003, publisher: ['Dark Horse Comics'], subject: ['Comic books, strips, etc.'] }] };
		globalThis.fetch = mockFetch([[/graphql\.anilist/, fixture('anilist-berserk.json')], [/openlibrary/, ol], ...emptyRoutes()]);
		const m = await fetchSeriesMeta('s1', { name: 'Berserk', manga: true });
		assert.ok(m && !m.notFound);
		assert.deepEqual([m.name, m.source, m.publisher, m.startYear], ['Berserk', 'anilist', 'Dark Horse', 1989]);
		assert.ok(m.related?.includes('Vinland Saga') && m.creators?.includes('Kentarou Miura'));
		assert.ok(m.description && m.description.length <= 700 && !/[<>]|~!|\(Source/.test(m.description), m.description);
	});

	it('descriptions: HTML/credits stripped, ≤ 700 chars, cut at a sentence end', async () => {
		const description = `<p>${'Sentence one is here. '.repeat(60)}</p><br>(Source: MAL)`;
		const media = { format: 'MANGA', title: { romaji: 'Test Manga', english: null }, description, genres: ['Action'], startDate: { year: 2001 }, endDate: { year: null }, status: 'FINISHED', siteUrl: 'https://anilist.co/manga/1', staff: { edges: [] }, recommendations: { nodes: [] } };
		globalThis.fetch = mockFetch([[/graphql\.anilist/, { data: { Page: { media: [media] } } }], ...emptyRoutes()]);
		const m = await fetchSeriesMeta('t', { name: 'Test Manga', manga: true });
		assert.ok(m?.description && m.description.length <= 700 && m.description.endsWith('.') && !/[<>]|Source/.test(m.description));
		assert.equal(m.status, 'ended');
	});

	it('Swedish titles: English finds nothing, Swedish Wikipedia answers', async () => {
		globalThis.fetch = mockFetch([
			[(u) => u.includes('en.wikipedia.org') && u.includes('generator=search'), { query: { pages: [] } }],
			...wikiRoutes({
				pages: [page('Kalle Anka & C:o', 'Q2743606', 'svensk serietidning från 1948', 3, 'Kalle Anka & C:o är en svensk serietidning.')],
				entities: { Q2743606: entity('Q2743606', { P31: ['Q1'] }, { P577: [1948, 1948] }) },
				labels: { Q1: 'comic book' }
			}),
			...emptyRoutes()
		]);
		const m = await fetchSeriesMeta('k', { name: 'Kalle Anka & C:o' });
		assert.ok(m && !m.notFound);
		assert.deepEqual([m.name, m.startYear, m.confidence], ['Kalle Anka & C:o', 1948, 1]);
		assert.match(m.sourceUrl ?? '', /^https:\/\/sv\.wikipedia\.org\//);
	});

	it('generic short titles are only accepted with year/publisher/creator corroboration', async () => {
		globalThis.fetch = mockFetch([...comicPage('The Long Road'), ...emptyRoutes()]);
		assert.equal((await fetchSeriesMeta('g1', { name: 'The Long Road', year: 2020, publisher: 'Demo Press' }))?.notFound, true);
		const withPublisher = wikiRoutes({
			pages: [page('The Long Road (comic book)', 'Q1', 'comic book series', 1, 'A description.')],
			entities: { Q1: entity('Q1', { P31: ['Q2'], P123: ['Q3'] }) },
			labels: { Q2: 'comic book series', Q3: 'Demo Press' }
		});
		globalThis.fetch = mockFetch([...withPublisher, ...emptyRoutes()]);
		const m = await fetchSeriesMeta('g2', { name: 'The Long Road', publisher: 'Demo Press' });
		assert.deepEqual([m?.name, m?.publisher], ['The Long Road', 'Demo Press']);
	});

	it('every source failing → undefined (retry later), never notFound', async () => {
		globalThis.fetch = (async () => {
			throw new Error('offline');
		}) as typeof fetch;
		assert.equal(await fetchSeriesMeta('s1', { name: 'Saga' }), undefined);
		resetForTest();
		globalThis.fetch = mockFetch([[() => true, () => reply({}, 429)]]);
		assert.equal(await fetchSeriesMeta('s1', { name: 'Saga' }), undefined);
	});

	it('all sources answered but nothing matches → notFound with fetchedAt', async () => {
		globalThis.fetch = mockFetch(emptyRoutes());
		const m = await fetchSeriesMeta('s1', { name: 'Zzzz Nonexistent Series 12345' });
		assert.deepEqual([m?.seriesId, m?.notFound, typeof m?.fetchedAt], ['s1', true, 'number']);
	});

	it('notFound needs the primary source to have answered: Wikipedia empty + others down → notFound; Wikipedia down → undefined', async () => {
		globalThis.fetch = mockFetch([[(u) => u.includes('generator=search'), { query: { pages: [] } }]]);
		assert.equal((await fetchSeriesMeta('s1', { name: 'Saga' }))?.notFound, true);
		resetForTest();
		globalThis.fetch = mockFetch([[/openlibrary|googleapis|graphql/, (u: string) => emptyBody(u)]]);
		assert.equal(await fetchSeriesMeta('s1', { name: 'Saga' }), undefined);
		resetForTest(); // manga: AniList is primary too
		globalThis.fetch = mockFetch([[(u) => u.includes('generator=search'), { query: { pages: [] } }], [/openlibrary|googleapis/, (u: string) => emptyBody(u)]]);
		assert.equal(await fetchSeriesMeta('s1', { name: 'Berserk', manga: true }), undefined);
	});

	it('does not use AniList after a failed Western primary source', async () => {
		const calls: Call[] = [];
		globalThis.fetch = mockFetch([[(u) => u.includes('generator=search'), () => reply({}, 429)], ...emptyRoutes()], calls);
		assert.equal(await fetchSeriesMeta('s1', { name: 'Berserk' }), undefined);
		assert.ok(!calls.some((c) => c.url.includes('graphql.anilist')));
	});

	it('an incomplete Western match asks Google Books / Open Library, but not AniList', async () => {
		const calls: Call[] = [];
		globalThis.fetch = mockFetch([...comicPage('Hellboy'), ...emptyRoutes()], calls);
		const m = await fetchSeriesMeta('h', { name: 'Hellboy' });
		assert.equal(m?.name, 'Hellboy');
		assert.ok(calls.some((c) => c.url.includes('openlibrary')) && calls.some((c) => c.url.includes('googleapis')));
		assert.ok(!calls.some((c) => c.url.includes('graphql')));
	});

	it('an aborted lookup returns undefined', async () => {
		assert.equal(await fetchSeriesMeta('s1', { name: 'Saga' }, AbortSignal.abort()), undefined);
		const ac = new AbortController();
		globalThis.fetch = ((_u: string, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)))) as typeof fetch;
		const p = fetchSeriesMeta('s1', { name: 'Saga' }, ac.signal);
		setTimeout(() => ac.abort(), 20);
		assert.equal(await p, undefined);
	});

	it('never more than 2 requests in flight, even for concurrent lookups', async () => {
		let now = 0, max = 0;
		globalThis.fetch = (async (input: string | URL | Request) => {
			max = Math.max(max, ++now);
			await new Promise((r) => setTimeout(r, 5));
			now--;
			return reply(emptyBody(String(input)));
		}) as typeof fetch;
		await Promise.all(['A', 'B', 'C', 'D'].map((n) => fetchSeriesMeta(n, { name: `Series ${n}`, manga: n === 'D' })));
		assert.equal(max, 2);
	});
});

describe('searchMeta', () => {
	it('returns best-first candidates from every source, publishers normalised, internals stripped', async () => {
		globalThis.fetch = mockFetch(recorded());
		const out = await searchMeta({ name: 'Batman' });
		assert.equal(out[0].source, 'wikipedia');
		assert.deepEqual([...new Set(out.map((c) => c.source))].sort(), ['googlebooks', 'openlibrary', 'wikipedia']);
		assert.equal(out.find((c) => c.source === 'googlebooks')?.publisher, 'DC');
		assert.ok(out.every((c, i) => i === 0 || out[i - 1].score >= c.score));
		assert.ok(out.every((c) => !('kind' in c) && c.score > 0));
	});

	it('an empty query or an aborted signal returns nothing without any request', async () => {
		const calls: Call[] = [];
		globalThis.fetch = mockFetch(emptyRoutes(), calls);
		assert.deepEqual(await searchMeta({ name: '  ' }), []);
		assert.deepEqual(await searchMeta({ name: 'Saga' }, AbortSignal.abort()), []);
		assert.equal(calls.length, 0);
	});
});
