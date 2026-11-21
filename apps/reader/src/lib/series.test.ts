import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeries } from './series.ts';
import { UNKNOWN_PUBLISHER } from './types.ts';
import type { Issue, Progress, Series, SeriesMeta, SeriesUser } from './types.ts';

// ───────────── fixtures ─────────────

let seq = 0;
/** Issue with unique id/fileName; override anything. Defaults to series "s1" / "Saga". */
const iss = (o: Partial<Issue> = {}): Issue => {
	const n = ++seq;
	return {
		id: `i${n}`,
		fileName: `file ${n}.cbz`,
		relPath: `file ${n}.cbz`,
		size: 1,
		lastModified: 0,
		addedAt: 0,
		format: 'cbz',
		seriesId: 's1',
		seriesName: 'Saga',
		pageCount: 10,
		coverIndex: 0,
		hasCover: true,
		...o
	};
};
const nums = (...numbers: number[]): Issue[] => numbers.map((number) => iss({ number }));
const meta = (o: Partial<SeriesMeta> = {}): SeriesMeta => ({ seriesId: 's1', ...o });
const reading = (i: Issue, page: number, updatedAt = 1): Progress => ({ issueId: i.id, page, pageCount: 10, completed: false, updatedAt });
const finished = (i: Issue, updatedAt = 1): Progress => ({ issueId: i.id, page: 9, pageCount: 10, completed: true, updatedAt });

const by = <T>(xs: T[], key: (x: T) => string): Record<string, T> => Object.fromEntries(xs.map((x) => [key(x), x]));
interface Extra {
	progress?: Progress[];
	meta?: SeriesMeta[];
	user?: SeriesUser[];
}
const build = (issues: Issue[], o: Extra = {}): Series[] =>
	buildSeries({
		issues,
		progress: by(o.progress ?? [], (p) => p.issueId),
		meta: by(o.meta ?? [], (m) => m.seriesId),
		user: by(o.user ?? [], (u) => u.seriesId)
	});
/** The one series built from `issues` (asserts there is exactly one). */
const one = (issues: Issue[], o: Extra = {}): Series => {
	const out = build(issues, o);
	assert.equal(out.length, 1);
	return out[0];
};
const ids = (xs: Issue[]) => xs.map((i) => i.id);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);
/** `number` of the issue "Läs / Fortsätt" would open. */
const nextNo = (issues: Issue[], progress: Progress[] = []) => {
	const s = one(issues, { progress });
	return s.issues.find((i) => i.id === s.nextIssueId)?.number;
};
function freeze<T>(x: T): T {
	if (typeof x === 'object' && x !== null) {
		Object.values(x).forEach(freeze);
		Object.freeze(x);
	}
	return x;
}

// ───────────── grouping & issue order ─────────────

test('groups by seriesId; empty input gives no series', () => {
	assert.deepEqual(build([]), []);
	const out = build([
		iss({ seriesId: 'a', seriesName: 'A' }),
		iss({ seriesId: 'b', seriesName: 'B' }),
		iss({ seriesId: 'a', seriesName: 'A' })
	]);
	assert.deepEqual(out.map((s) => [s.id, s.issueCount]).sort(), [['a', 2], ['b', 1]]);
});

test('issues sort by volume, number, year (missing last each), then natural fileName', () => {
	const v1n1y2000 = iss({ volume: 1, number: 1, year: 2000 });
	const v1n1y2001 = iss({ volume: 1, number: 1, year: 2001 });
	const v1n1 = iss({ volume: 1, number: 1 });
	const v1n2 = iss({ volume: 1, number: 2 });
	const v1annual = iss({ volume: 1, fileName: 'Annual.cbz' });
	const v2n1 = iss({ volume: 2, number: 1 });
	const noVolume = iss({ number: 1 });
	const f2 = iss({ number: 7, fileName: 'x 2.cbz' });
	const f10 = iss({ number: 7, fileName: 'x 10.cbz' });
	const expected = [v1n1y2000, v1n1y2001, v1n1, v1n2, v1annual, v2n1, noVolume];
	const shuffled = [noVolume, v1n2, v2n1, v1n1, v1annual, v1n1y2001, v1n1y2000];
	assert.deepEqual(ids(one(shuffled).issues), ids(expected));
	assert.deepEqual(ids(one([...shuffled].reverse()).issues), ids(expected));
	assert.deepEqual(ids(one([f10, f2]).issues), ids([f2, f10]));
});

test('issue order is independent of input order even when everything ties', () => {
	const a = iss({ id: 'a', fileName: 'same.cbz' });
	const b = iss({ id: 'b', fileName: 'same.cbz' });
	assert.deepEqual(ids(one([b, a]).issues), ['a', 'b']);
	assert.deepEqual(ids(one([a, b]).issues), ['a', 'b']);
});

test('does not mutate its input', () => {
	const issues = freeze([
		iss({ seriesId: 'a', seriesName: 'Same', number: 2, writers: ['W'], year: 2000 }),
		iss({ seriesId: 'a', seriesName: 'Same', number: 1, genres: ['G'] }),
		iss({ seriesId: 'b', seriesName: 'Same', year: 2010 })
	]);
	const progress = freeze({ [issues[0].id]: finished(issues[0]) });
	const metas = freeze({ a: meta({ seriesId: 'a', genres: ['G2'] }) });
	const user = freeze({ a: { seriesId: 'a', favorite: true, updatedAt: 1 } });
	const before = JSON.stringify([issues, progress, metas, user]);
	const out = buildSeries({ issues, progress, meta: metas, user });
	assert.equal(out.length, 2);
	assert.equal(JSON.stringify([issues, progress, metas, user]), before);
});

// ───────────── name, sortKey ─────────────

test('name: user-edited meta.name, else the seriesName of the first issue', () => {
	assert.equal(one([iss({ number: 2, seriesName: 'Second' }), iss({ number: 1, seriesName: 'First' })]).name, 'First');
	assert.equal(one([iss({ seriesName: 'Raw' })], { meta: [meta({ name: 'Fancy' })] }).name, 'Raw'); // auto-matched meta never renames
	assert.equal(one([iss({ seriesName: 'Raw' })], { meta: [meta({ name: 'Fancy', userEdited: true })] }).name, 'Fancy');
	assert.equal(one([iss({ seriesName: 'Raw' })], { meta: [meta({ name: '' })] }).name, 'Raw');
});

test('duplicate names get " (startYear)", else " (publisher)"', () => {
	const out = build([
		iss({ seriesId: 'a', seriesName: 'Batman', year: 2016 }),
		iss({ seriesId: 'b', seriesName: 'Batman', year: 2011 }),
		iss({ seriesId: 'c', seriesName: 'Saga', publisher: 'Image' }),
		iss({ seriesId: 'd', seriesName: 'Saga', publisher: 'Dark Horse' }),
		iss({ seriesId: 'e', seriesName: 'Solo', year: 2000 }),
		iss({ seriesId: 'x', seriesName: 'Raw X', year: 1990 }),
		iss({ seriesId: 'y', seriesName: 'Raw Y' })
	], { meta: [meta({ seriesId: 'x', name: 'Wolverine', userEdited: true }), meta({ seriesId: 'y', name: 'Wolverine', publisher: 'Marvel', userEdited: true })] });
	const name = (id: string) => out.find((s) => s.id === id)?.name;
	assert.deepEqual(
		['a', 'b', 'c', 'd', 'e', 'x', 'y'].map(name),
		['Batman (2016)', 'Batman (2011)', 'Saga (Image)', 'Saga (Dark Horse)', 'Solo', 'Wolverine (1990)', 'Wolverine (Marvel)']
	);
});

test('duplicate names with no year and no known publisher are left alone; sortKey follows the final name', () => {
	const plain = build([iss({ seriesId: 'a', seriesName: 'Same' }), iss({ seriesId: 'b', seriesName: 'Same' })]);
	assert.deepEqual(plain.map((s) => s.name), ['Same', 'Same']);
	const dup = build([iss({ seriesId: 'a', seriesName: 'The Boys', year: 2019 }), iss({ seriesId: 'b', seriesName: 'The Boys', year: 2006 })]);
	assert.deepEqual(dup.map((s) => s.sortKey), ['boys (2019)', 'boys (2006)']);
});

test('sortKey: lowercase, leading article dropped', () => {
	const key = (seriesName: string) => one([iss({ seriesName })]).sortKey;
	assert.equal(key('The Boys'), 'boys');
	assert.equal(key('A Silent Voice'), 'silent voice');
	assert.equal(key('An Example'), 'example');
	assert.equal(key('En Dag'), 'dag');
	assert.equal(key('Ett Hål'), 'hål');
	assert.equal(key('Theory of Everything'), 'theory of everything');
	assert.equal(key('A-Force'), 'a-force');
	assert.equal(key('Åsa'), 'åsa');
	assert.equal(key('The'), 'the');
});

// ───────────── publisher, genres, creators, year, description ─────────────

test('publisher: userEdited meta > majority of issues > meta > unknown', () => {
	const pub = (publishers: (string | undefined)[], m?: Partial<SeriesMeta>) =>
		one(publishers.map((publisher, i) => iss({ number: i + 1, publisher })), { meta: m ? [meta(m)] : [] }).publisher;
	assert.equal(pub(['Marvel', 'DC', 'Marvel']), 'Marvel');
	assert.equal(pub(['Marvel', undefined, 'DC', 'DC']), 'DC');
	assert.equal(pub(['Marvel', 'DC']), 'Marvel'); // tie → first in issue order
	assert.equal(pub(['DC', 'Marvel']), 'DC');
	assert.equal(pub(['Marvel'], { publisher: 'Image' }), 'Marvel');
	assert.equal(pub(['Marvel'], { publisher: 'Image', userEdited: true }), 'Image');
	assert.equal(pub(['Marvel'], { userEdited: true }), 'Marvel');
	assert.equal(pub([undefined], { publisher: 'Image' }), 'Image');
	assert.equal(pub([undefined, undefined]), UNKNOWN_PUBLISHER);
});

test('genres and creators: issue data first, then meta; unique; capped', () => {
	const s = one(
		[
			iss({ number: 1, genres: ['Action', 'Sci-Fi'], writers: ['Writer'], artists: ['Artist'] }),
			iss({ number: 2, genres: ['sci-fi', 'Drama'], writers: ['Writer', 'Other'], artists: ['Artist 2'] })
		],
		{ meta: [meta({ genres: ['Drama', 'Comedy'], creators: ['Other', 'Meta Person'] })] }
	);
	assert.deepEqual(s.genres, ['Action', 'Sci-Fi', 'Drama', 'Humor']);
	assert.deepEqual(s.creators, ['Writer', 'Artist', 'Other', 'Artist 2', 'Meta Person']);

	const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
	const big = one(
		[iss({ number: 1, genres: many('g', 11), writers: many('w', 6), artists: many('a', 6) })],
		{ meta: [meta({ genres: ['m1', 'm2'], creators: ['c1'] })] }
	);
	assert.deepEqual(big.genres, [...many('G', 11), 'M1']); // normalised to title case
	assert.equal(big.creators.length, 10);
	assert.deepEqual(big.creators.slice(0, 6), many('w', 6));

	const none = one([iss()]);
	assert.deepEqual([none.genres, none.creators, none.related], [[], [], []]);
});

test('Metron creators are additive and do not replace local ComicInfo creators', () => {
	const s = one([
		iss({ writers: ['Local writer'], metron: { source: 'metron', id: 7, characters: ['Hero'], creators: ['Metron creator'], sourceUrl: 'https://metron.cloud/issue/7/' } })
	]);
	assert.deepEqual(s.creators, ['Local writer', 'Metron creator']);
});

test('startYear: user edit > volumeYear > online match > earliest issue year', () => {
	const year = (years: (number | undefined)[], m?: Partial<SeriesMeta>, volumeYear?: number) =>
		one(years.map((y, i) => iss({ number: i + 1, year: y, volumeYear })), { meta: m ? [meta(m)] : [] }).startYear;
	assert.equal(year([2012, 2010, undefined]), 2010);
	assert.equal(year([2012, 2010], { startYear: 1999 }), 1999);
	assert.equal(year([undefined], undefined, 2016), 2016);
	assert.equal(year([2018], undefined, 2016), 2016); // folder "(2016)" beats issue years
	assert.equal(year([2018], { startYear: 1999 }, 2016), 2016); // …and an online match
	assert.equal(year([2018], { startYear: 1999, userEdited: true }, 2016), 1999);
	assert.equal(year([undefined]), undefined);
});

test('description, related, status, endYear and meta pass through', () => {
	const m = meta({ description: 'From meta', related: ['Y: The Last Man'], status: 'ended', endYear: 2018 });
	const s = one([iss({ number: 1, summary: '' }), iss({ number: 2, summary: 'From issue 2' })], { meta: [m] });
	assert.deepEqual([s.description, s.related, s.status, s.endYear, s.meta], ['From meta', ['Y: The Last Man'], 'ended', 2018, m]);
	const plain = one([iss({ number: 2, summary: 'Later' }), iss({ number: 1, summary: 'First' }), iss({ number: 3 })]);
	assert.deepEqual([plain.description, plain.status, plain.meta], ['First', undefined, undefined]);
	assert.equal(one([iss()]).description, undefined);
});

// ───────────── cover, dates ─────────────

test('cover issue: first with a cover (else first); color from it; addedAt is the max', () => {
	const a = iss({ number: 1, hasCover: false, color: '#111111', addedAt: 5 });
	const b = iss({ number: 2, color: '#222222', addedAt: 30 });
	const c = iss({ number: 3, color: '#333333', addedAt: 10 });
	const s = one([c, b, a]);
	assert.equal(s.coverIssueId, b.id);
	assert.equal(s.color, '#222222');
	assert.equal(s.addedAt, 30);
	const bare = one([iss({ number: 2, hasCover: false }), a]);
	assert.equal(bare.coverIssueId, a.id);
	assert.equal(bare.color, '#111111');
});

test('lastReadAt: max updatedAt, records with 0 ignored, undefined when none', () => {
	const [a, b, c] = nums(1, 2, 3);
	assert.equal(one([a, b, c]).lastReadAt, undefined);
	assert.equal(one([a, b, c], { progress: [reading(a, 3, 0), finished(b, 0)] }).lastReadAt, undefined);
	assert.equal(one([a, b, c], { progress: [reading(a, 3, 100), finished(b, 0), finished(c, 250)] }).lastReadAt, 250);
});

// ───────────── progress, state ─────────────

test('completedCount, progress and state', () => {
	const four = nums(1, 2, 3, 4);
	const [a, b, c] = four;
	let s = one(four);
	assert.deepEqual([s.completedCount, s.progress, s.state, s.inProgressIssueId], [0, 0, 'unread', undefined]);

	s = one(four, { progress: [finished(a), reading(b, 5)] });
	assert.deepEqual([s.completedCount, s.progress, s.state, s.inProgressIssueId], [1, 0.375, 'reading', b.id]);

	s = one(four, { progress: [reading(a, 5), reading(b, 2, 2)] }); // every started issue counts its share
	near(s.progress, (0.5 + 0.2) / 4);

	s = one(four, { progress: [{ ...reading(a, 5), pageCount: 0 }] }); // falls back to issue.pageCount
	assert.equal(s.progress, 0.125);

	s = one(four, { progress: [finished(a)] });
	assert.deepEqual([s.completedCount, s.progress, s.state, s.inProgressIssueId], [1, 0.25, 'reading', undefined]);

	s = one(four, { progress: [reading(a, 0), reading(b, 0)] }); // opened but still on page 1 → not started
	assert.deepEqual([s.progress, s.state, s.inProgressIssueId], [0, 'unread', undefined]);

	s = one(four, { progress: four.map((i) => finished(i)) });
	assert.deepEqual([s.completedCount, s.progress, s.state], [4, 1, 'done']);
	s = one([c], { progress: [finished(c)] });
	assert.deepEqual([s.progress, s.state], [1, 'done']);
});

test('inProgressIssueId: the most recently touched unfinished issue (ties → later issue)', () => {
	const [a, b, c] = nums(1, 2, 3);
	assert.equal(one([a, b, c], { progress: [reading(a, 3, 50), reading(b, 4, 100), reading(c, 2, 20)] }).inProgressIssueId, b.id);
	assert.equal(one([a, b, c], { progress: [reading(a, 3, 50), reading(b, 4, 10), reading(c, 2, 50)] }).inProgressIssueId, c.id);
	assert.equal(one([a, b, c], { progress: [finished(a, 500), reading(b, 4, 10)] }).inProgressIssueId, b.id);
});

// ───────────── nextIssueId ─────────────

test('nextIssueId: nothing read → first issue', () => {
	assert.equal(nextNo(nums(3, 1, 2)), 1);
	assert.equal(nextNo([iss()]), undefined); // one-shot: its only issue
	const only = iss();
	assert.equal(one([only]).nextIssueId, only.id);
});

test('nextIssueId: an issue in progress wins', () => {
	const [i1, i2, i3] = nums(1, 2, 3);
	assert.equal(nextNo([i1, i2, i3], [reading(i2, 4)]), 2); // even though #1 is unread
	const five = nums(1, 2, 3, 4, 5);
	assert.equal(nextNo(five, [finished(five[0]), finished(five[1]), reading(five[3], 2)]), 4);
});

test('nextIssueId: issues 1-3 completed → issue 4', () => {
	const five = nums(1, 2, 3, 4, 5);
	assert.equal(nextNo(five, five.slice(0, 3).map((i) => finished(i))), 4);
});

test('nextIssueId: all completed → first issue', () => {
	const three = nums(1, 2, 3);
	assert.equal(nextNo(three, three.map((i) => finished(i))), 1);
});

test('nextIssueId: gaps in numbering do not matter', () => {
	const gappy = nums(1, 2, 5, 6);
	const [i1, i2, i5] = gappy;
	assert.equal(nextNo(gappy, [finished(i1), finished(i2)]), 5);
	assert.equal(nextNo(gappy, [finished(i1), finished(i2), finished(i5)]), 6);
});

test('nextIssueId: continues after the issue finished last, skipping ahead', () => {
	const five = nums(1, 2, 3, 4, 5);
	assert.equal(nextNo(five, [finished(five[2])]), 4); // #1 and #2 unread, but #3 was the last one read
	assert.equal(nextNo(five, [finished(five[1]), finished(five[2])]), 4);
	assert.equal(nextNo(five, [finished(five[0]), finished(five[2])]), 4); // same timestamp → the later issue counts as last
	// Finished last by time wins over position: #4 was done long ago, #1 and #2 just now.
	assert.equal(nextNo(five, [finished(five[3], 1), finished(five[0], 5), finished(five[1], 6)]), 3);
});

test('nextIssueId: nothing unfinished after the last finished → first unfinished', () => {
	const three = nums(1, 2, 3);
	assert.equal(nextNo(three, [finished(three[2])]), 1);
	assert.equal(nextNo(three, [finished(three[1]), finished(three[2])]), 1);
	assert.equal(nextNo(three, [finished(three[0]), finished(three[2], 9)]), 2);
});

// ───────────── flags ─────────────

test('rtl: meta overrides, else any issue', () => {
	assert.equal(one([iss()]).rtl, false);
	assert.equal(one([iss(), iss({ rtl: true })]).rtl, true);
	assert.equal(one([iss({ rtl: true })], { meta: [meta({ rtl: false })] }).rtl, false);
	assert.equal(one([iss()], { meta: [meta({ rtl: true })] }).rtl, true);
});

test('oneShot: exactly one issue without a number', () => {
	assert.equal(one([iss()]).oneShot, true);
	assert.equal(one([iss({ number: 1 })]).oneShot, false);
	assert.equal(one([iss(), iss()]).oneShot, false);
	assert.equal(one([iss(), iss({ number: 1 })]).oneShot, false);
});

test('complete: ≥2 whole numbers, unbroken from 0 or 1', () => {
	const complete = (numbers: (number | undefined)[]) => one(numbers.map((number) => iss({ number }))).complete;
	for (const yes of [[1, 2], [0, 1], [3, 1, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2], [1, 1.5, 2], [1, 2, 3, undefined]])
		assert.equal(complete(yes), true, `[${yes}] should be complete`);
	for (const no of [[1], [undefined, undefined], [1, 3], [1, 2, 4], [2, 3, 4], [0, 2], [1, 1], [1, 1.5], [5], [1, 2, 2020]])
		assert.equal(complete(no), false, `[${no}] should not be complete`);
});

test('matched: a source that was not "notFound"', () => {
	const matched = (m?: Partial<SeriesMeta>) => one([iss()], { meta: m ? [meta(m)] : [] }).matched;
	assert.equal(matched(), false);
	assert.equal(matched({}), false);
	assert.equal(matched({ source: 'wikipedia' }), true);
	assert.equal(matched({ source: 'user' }), true);
	assert.equal(matched({ source: 'anilist', notFound: true }), false);
	assert.equal(matched({ notFound: true }), false);
});

test('favorite and rating come from user data', () => {
	const user = (u: Partial<SeriesUser>): SeriesUser => ({ seriesId: 's1', updatedAt: 1, ...u });
	let s = one([iss()]);
	assert.deepEqual([s.favorite, s.rating], [false, undefined]);
	s = one([iss()], { user: [user({ favorite: true, rating: 4 })] });
	assert.deepEqual([s.favorite, s.rating], [true, 4]);
	s = one([iss()], { user: [user({ rating: 0 })] });
	assert.deepEqual([s.favorite, s.rating], [false, undefined]);
});

test('series ids that are Object.prototype keys do not pick up inherited "records"', () => {
	const s = one([iss({ id: 'toString', seriesId: 'constructor', seriesName: 'Constructor' })]);
	assert.deepEqual([s.name, s.meta, s.favorite, s.matched, s.state], ['Constructor', undefined, false, false, 'unread']);
});

// ───────────── scale ─────────────

test('handles ~5,000 issues quickly (many series, and one huge series)', () => {
	const many = Array.from({ length: 5000 }, (_, i) =>
		iss({ seriesId: `s${i % 400}`, seriesName: `Series ${i % 400}`, number: Math.floor(i / 400) + 1, writers: [`w${i % 7}`], genres: [`g${i % 5}`] })
	);
	const progress = many.filter((_, i) => i % 3 === 0).map((i) => finished(i, 5));
	let t = performance.now();
	const out = build(many, { progress });
	const manyMs = performance.now() - t;
	assert.equal(out.length, 400);
	assert.ok(out.every((s) => s.issueCount === 12 || s.issueCount === 13));

	const huge = Array.from({ length: 5000 }, (_, i) => iss({ number: 5000 - i }));
	t = performance.now();
	const [s] = build(huge);
	const hugeMs = performance.now() - t;
	assert.deepEqual(s.issues.slice(0, 3).map((i) => i.number), [1, 2, 3]);
	assert.ok(manyMs < 1500 && hugeMs < 1500, `too slow: ${manyMs.toFixed(0)}ms / ${hugeMs.toFixed(0)}ms`);
});
