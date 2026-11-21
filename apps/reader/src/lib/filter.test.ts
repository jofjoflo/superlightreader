import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, computeFacets, countActiveFilters, defaultFilters, filtersFromParams, filtersToParams } from './filter.ts';
import { UNKNOWN_PUBLISHER } from './types.ts';
import type { Filters, Series, SortKey } from './types.ts';

// ───────────── fixtures ─────────────

let seq = 0;
/** Series fixture; sortKey defaults to the lowercased name. */
const ser = (name: string, o: Partial<Series> = {}): Series => ({
	id: `s${++seq}`,
	name,
	sortKey: name.toLowerCase(),
	publisher: UNKNOWN_PUBLISHER,
	genres: [],
	creators: [],
	related: [],
	issues: [],
	issueCount: 1,
	coverIssueId: 'c',
	addedAt: 0,
	completedCount: 0,
	progress: 0,
	state: 'unread',
	favorite: false,
	rtl: false,
	oneShot: false,
	complete: false,
	matched: false,
	...o
});
const f = (o: Partial<Filters> = {}): Filters => ({ ...defaultFilters, ...o });
const names = (xs: Series[]) => xs.map((s) => s.name);
const run = (xs: Series[], o: Partial<Filters> = {}) => names(applyFilters(xs, f(o)));

// ───────────── q ─────────────

test('q: case/accent-insensitive; every word must match name, publisher, genres or creators', () => {
	const lib = [
		ser('Åke och hans värld', { publisher: 'Bonnier', genres: ['Humor'], creators: ['Gösta Hammarlund'] }),
		ser('Saga', { publisher: 'Image Comics', genres: ['Fantasy', 'Sci-Fi'], creators: ['Brian K. Vaughan', 'Fiona Staples'] }),
		ser('Spider-Man', { publisher: 'Marvel', genres: ['Superhero'], creators: ['Stan Lee'] })
	];
	assert.deepEqual(run(lib), ['Saga', 'Spider-Man', 'Åke och hans värld']); // sv collation: å after z
	for (const q of ['ake', 'AKE', 'åke', 'Åke', 'varld', 'gosta', 'GÖSTA', 'bonnier humor'])
		assert.deepEqual(run(lib, { q }), ['Åke och hans värld'], q);
	for (const q of ['saga', 'SAGA', 'image', 'comics', 'sci-fi', 'fantasy', 'vaughan', 'fiona', 'image vaughan', '  saga  '])
		assert.deepEqual(run(lib, { q }), ['Saga'], q);
	assert.deepEqual(run(lib, { q: 'spider man' }), ['Spider-Man']); // words match independently
	assert.deepEqual(run(lib, { q: 'marvel stan' }), ['Spider-Man']); // …and across fields
	assert.deepEqual(run(lib, { q: 'marvel saga' }), []);
	assert.deepEqual(run(lib, { q: 'zzz' }), []);
	assert.deepEqual(run(lib, { q: '   ' }), run(lib)); // blank = no filter
});

test('creator: exact case/accent-insensitive match, not substring', () => {
	const lib = [
		ser('Exact', { creators: ['Åke Öberg'] }),
		ser('Different', { creators: ['Åke Öberg Jr.'] }),
		ser('Other', { creators: ['Ake Oberg'] }),
		ser('None')
	];
	assert.deepEqual(run(lib, { creator: 'ake oberg' }), ['Exact', 'Other']);
	assert.deepEqual(run(lib, { creator: '  ÅKE ÖBERG  ' }), ['Exact', 'Other']);
	assert.deepEqual(run(lib, { creator: 'berg' }), []);
	assert.deepEqual(run(lib), ['Different', 'Exact', 'None', 'Other']);
});

test('creator and q search include uncapped issue-level Metron creators', () => {
	const s = ser('Metron series', {
		creators: Array.from({ length: 10 }, (_, i) => `Visible ${i}`),
		issues: [{ metron: { source: 'metron', id: 1, characters: [], creators: ['Hidden creator'], sourceUrl: 'https://metron.cloud/issue/1/' } } as unknown as Series['issues'][number]]
	});
	assert.deepEqual(run([s], { creator: 'hidden creator' }), ['Metron series']);
	assert.deepEqual(run([s], { q: 'hidden' }), ['Metron series']);
});

// ───────────── multi-select, status, kind ─────────────

test('publishers/genres/decades: OR within a group, AND between groups', () => {
	const lib = [
		ser('A', { publisher: 'Marvel', genres: ['Superhero', 'Sci-Fi'], startYear: 1963 }),
		ser('B', { publisher: 'DC Comics', genres: ['Superhero'], startYear: 1987 }),
		ser('C', { publisher: 'Image', genres: ['Fantasy'], startYear: 2012 }),
		ser('D', { genres: ['Fantasy', 'Sci-Fi'] }), // unknown publisher, no start year
		ser('E', { publisher: 'Marvel', startYear: 1999 }),
		ser('F', { publisher: 'Marvel', startYear: 2000 })
	];
	assert.deepEqual(run(lib, { publishers: ['Marvel', 'Image'] }), ['A', 'C', 'E', 'F']);
	assert.deepEqual(run(lib, { publishers: [UNKNOWN_PUBLISHER] }), ['D']);
	assert.deepEqual(run(lib, { genres: ['Sci-Fi'] }), ['A', 'D']);
	assert.deepEqual(run(lib, { genres: ['Fantasy', 'Superhero'] }), ['A', 'B', 'C', 'D']);
	assert.deepEqual(run(lib, { genres: ['Nope'] }), []);
	assert.deepEqual(run(lib, { decades: [1960, 1980] }), ['A', 'B']); // no-year series never match
	assert.deepEqual(run(lib, { decades: [1990] }), ['E']);
	assert.deepEqual(run(lib, { decades: [2000, 2010] }), ['C', 'F']);
	// AND between groups
	assert.deepEqual(run(lib, { publishers: ['Marvel', 'DC Comics'], genres: ['Sci-Fi'] }), ['A']);
	assert.deepEqual(run(lib, { publishers: ['Marvel', 'Image'], genres: ['Superhero'], decades: [1960, 2010] }), ['A']);
	assert.deepEqual(run(lib, { genres: ['Sci-Fi'], decades: [1960, 2010] }), ['A']);
	assert.deepEqual(run(lib, { q: 'comics', genres: ['Superhero'], publishers: ['DC Comics'], decades: [1980] }), ['B']);
	assert.deepEqual(run(lib, { q: 'comics', publishers: ['Marvel'] }), []);
});

test('status and kind', () => {
	const lib = [
		ser('Unread'),
		ser('Reading', { state: 'reading' }),
		ser('Done', { state: 'done', complete: true }),
		ser('Fav', { state: 'reading', favorite: true }),
		ser('Shot', { oneShot: true }),
		ser('Manga', { rtl: true, complete: true })
	];
	assert.deepEqual(run(lib, { status: 'all' }), ['Done', 'Fav', 'Manga', 'Reading', 'Shot', 'Unread']);
	assert.deepEqual(run(lib, { status: 'unread' }), ['Manga', 'Shot', 'Unread']);
	assert.deepEqual(run(lib, { status: 'reading' }), ['Fav', 'Reading']);
	assert.deepEqual(run(lib, { status: 'done' }), ['Done']);
	assert.deepEqual(run(lib, { status: 'favorites' }), ['Fav']);
	assert.deepEqual(run(lib, { kind: 'series' }), ['Done', 'Fav', 'Manga', 'Reading', 'Unread']);
	assert.deepEqual(run(lib, { kind: 'oneshot' }), ['Shot']);
	assert.deepEqual(run(lib, { kind: 'manga' }), ['Manga']);
	assert.deepEqual(run(lib, { kind: 'complete' }), ['Done', 'Manga']);
	assert.deepEqual(run(lib, { status: 'unread', kind: 'complete' }), ['Manga']);
	assert.deepEqual(run(lib, { status: 'favorites', kind: 'manga' }), []);
});

// ───────────── sort ─────────────

test('every sort key: ascending/descending, missing values always last, ties by name', () => {
	const lib = [
		ser('a', { addedAt: 30, lastReadAt: 100, startYear: 1990, issueCount: 5, rating: 4, progress: 0.5 }),
		ser('b', { addedAt: 10, lastReadAt: 300, startYear: 2000, issueCount: 5, rating: 1, progress: 0 }),
		ser('c', { addedAt: 20, startYear: 1980, issueCount: 9, rating: 5, progress: 1 }),
		ser('d', { addedAt: 40, lastReadAt: 200, issueCount: 1, progress: 0 }),
		ser('e', { addedAt: 40, issueCount: 5, progress: 0.25 })
	];
	const cases: [SortKey, string, string][] = [
		['name', 'abcde', 'edcba'],
		['added', 'bcade', 'deacb'], // d/e tie on 40 → name order in both directions
		['read', 'adbce', 'bdace'], // c, e never read → last either way
		['year', 'cabde', 'bacde'],
		['issues', 'dabec', 'cabed'],
		['rating', 'bacde', 'cabde'],
		['progress', 'bdeac', 'caebd'] // 0 is a value, not "missing"
	];
	for (const [sort, asc, desc] of cases) {
		assert.equal(run(lib, { sort }).join(''), asc, `${sort} asc`);
		assert.equal(run(lib, { sort, desc: true }).join(''), desc, `${sort} desc`);
	}
	assert.equal(run(lib).join(''), 'abcde'); // default: name ascending
});

test('name sort uses sortKey with Swedish collation and natural numbers', () => {
	const lib = [ser('Åsa'), ser('Zorro'), ser('The Boys', { sortKey: 'boys' }), ser('Ärlig'), ser('Saga 10'), ser('Saga 2'), ser('Östen')];
	const asc = ['The Boys', 'Saga 2', 'Saga 10', 'Zorro', 'Åsa', 'Ärlig', 'Östen'];
	assert.deepEqual(run(lib), asc);
	assert.deepEqual(run(lib, { desc: true }), [...asc].reverse());
});

test('does not mutate its input and returns a new array', () => {
	const lib = Object.freeze([ser('b'), ser('a')]) as Series[];
	for (const o of [{}, { sort: 'year', desc: true }, { q: 'a' }] as Partial<Filters>[]) {
		const out = applyFilters(lib, f(o));
		assert.notEqual(out, lib);
		assert.deepEqual(names(lib), ['b', 'a']);
	}
});

// ───────────── facets ─────────────

test('computeFacets: counts, sorted by count desc then value (sv); decades skip series without a year', () => {
	const lib = [
		ser('1', { publisher: 'Marvel', genres: ['Superhero', 'Sci-Fi'], startYear: 1963 }),
		ser('2', { publisher: 'Marvel', genres: ['Superhero'], startYear: 1969 }),
		ser('3', { publisher: 'DC Comics', genres: ['Superhero', 'Fantasy'], startYear: 1987 }),
		ser('4', { publisher: 'Åhlén & Åkerlund', genres: ['Humor'] }),
		ser('5', { genres: ['Fantasy'], startYear: 2012 }),
		ser('6', { publisher: 'Bonnier', startYear: 2015 }),
		ser('7', { publisher: 'Bonnier', startYear: 1999 }),
		ser('8', { publisher: 'Bonnier', startYear: 2000 })
	];
	const facets = computeFacets(lib);
	assert.deepEqual(facets.publishers, [
		{ value: 'Bonnier', count: 3 },
		{ value: 'Marvel', count: 2 },
		{ value: 'DC Comics', count: 1 },
		{ value: UNKNOWN_PUBLISHER, count: 1 },
		{ value: 'Åhlén & Åkerlund', count: 1 }
	]);
	assert.deepEqual(facets.genres, [
		{ value: 'Superhero', count: 3 },
		{ value: 'Fantasy', count: 2 },
		{ value: 'Humor', count: 1 },
		{ value: 'Sci-Fi', count: 1 }
	]);
	assert.deepEqual(facets.decades, [
		{ value: 1960, count: 2 },
		{ value: 2010, count: 2 },
		{ value: 1980, count: 1 },
		{ value: 1990, count: 1 },
		{ value: 2000, count: 1 }
	]);
	assert.deepEqual(computeFacets([]), { publishers: [], genres: [], decades: [] });
});

test('countActiveFilters: one per non-default field; sort is not counted', () => {
	assert.equal(countActiveFilters(defaultFilters), 0);
	assert.equal(countActiveFilters(f({ sort: 'year', desc: true })), 0);
	assert.equal(countActiveFilters(f({ q: '  ' })), 0);
	assert.equal(countActiveFilters(f({ q: 'saga' })), 1);
	assert.equal(countActiveFilters(f({ creator: 'A' })), 1);
	assert.equal(countActiveFilters(f({ publishers: ['A', 'B'] })), 1);
	assert.equal(countActiveFilters(f({ status: 'done' })), 1);
	assert.equal(countActiveFilters(f({ kind: 'manga', decades: [1980] })), 2);
	assert.equal(countActiveFilters(f({ q: 'x', publishers: ['A'], genres: ['G'], decades: [1980], status: 'done', kind: 'manga' })), 6);
});

// ───────────── URL params ─────────────

test('filtersToParams: omits defaults, repeats multi-selects', () => {
	assert.equal(filtersToParams(defaultFilters).toString(), '');
	assert.equal(filtersToParams(f({ sort: 'name', desc: false })).toString(), '');
	assert.equal(filtersToParams(f({ sort: 'year' })).toString(), 'sort=year');
	assert.equal(filtersToParams(f({ desc: true })).toString(), 'desc=1');
	assert.equal(
		filtersToParams(
			f({ q: 'x', creator: 'Ake Oberg', publishers: ['A', 'B'], genres: ['G'], decades: [1980, 2000], status: 'done', kind: 'manga', sort: 'added', desc: true })
		).toString(),
		'q=x&creator=Ake+Oberg&publisher=A&publisher=B&genre=G&decade=1980&decade=2000&status=done&kind=manga&sort=added&desc=1'
	);
});

test('filtersFromParams: empty → defaults, with fresh arrays', () => {
	const a = filtersFromParams(new URLSearchParams());
	assert.deepEqual(a, defaultFilters);
	a.publishers.push('x');
	assert.deepEqual(filtersFromParams(new URLSearchParams()).publishers, []);
	assert.deepEqual(defaultFilters.publishers, []);
});

test('params round-trip through a query string', () => {
	const roundTrip = (want: Filters) => assert.deepEqual(filtersFromParams(new URLSearchParams(filtersToParams(want).toString())), want);
	for (const o of [
		{},
		{ q: 'åke & co #1' },
		{ creator: 'Åke Oberg' },
		{ q: 'spider ' }, // trailing space survives: the search box may sync through the URL while typing
		{ publishers: ['Dark Horse', UNKNOWN_PUBLISHER, 'A&B Comics', 'Åhlén & Åkerlund'] },
		{ genres: ['Sci-Fi/Fantasy', 'Slice of Life', 'a=b'] },
		{ decades: [1980, 2010] },
		{ q: 'x', publishers: ['A'], genres: ['G'], decades: [1990], status: 'favorites', kind: 'complete', sort: 'progress', desc: true }
	] as Partial<Filters>[])
		roundTrip(f(o));
	// every status / kind / sort value is accepted
	for (const status of ['all', 'unread', 'reading', 'done', 'favorites'] as const)
		for (const kind of ['all', 'series', 'oneshot', 'manga', 'complete'] as const)
			for (const sort of ['name', 'added', 'read', 'year', 'issues', 'rating', 'progress'] as const)
				for (const desc of [false, true]) roundTrip(f({ status, kind, sort, desc }));
});

test('filtersFromParams: invalid or unknown values fall back to defaults', () => {
	const bad = new URLSearchParams('status=bogus&kind=nope&sort=weird&desc=yes&q=');
	assert.deepEqual(filtersFromParams(bad), defaultFilters);
	for (const key of ['status', 'kind', 'sort'])
		for (const v of ['constructor', '__proto__', 'toString', 'ALL', ''])
			assert.deepEqual(filtersFromParams(new URLSearchParams({ [key]: v })), defaultFilters, `${key}=${v}`);
	for (const v of ['0', 'true', 'yes', '']) assert.equal(filtersFromParams(new URLSearchParams({ desc: v })).desc, false, `desc=${v}`);
	assert.equal(filtersFromParams(new URLSearchParams('desc=1')).desc, true);

	const messy = new URLSearchParams(
		'decade=abc&decade=1985&decade=&decade=19800&decade=-1980&decade=1980&decade=1980&decade=2020&publisher=&genre=&publisher=A&publisher=A&genre=G'
	);
	assert.deepEqual(filtersFromParams(messy), f({ decades: [1980, 2020], publishers: ['A'], genres: ['G'] }));
});
