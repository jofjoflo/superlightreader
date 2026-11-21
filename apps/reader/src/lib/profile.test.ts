import test from 'node:test';
import assert from 'node:assert/strict';
import { findLocalProfile, issueProfileNames, listLocalProfiles, profileHref, profileKey } from './profile.ts';
import type { Issue, Series } from './types.ts';

const issue = (o: Partial<Issue> = {}): Issue => ({
	id: 'i1', fileName: 'Saga 1.cbz', relPath: 'Saga 1.cbz', size: 1, lastModified: 0, addedAt: 0,
	format: 'cbz', seriesId: 's1', seriesName: 'Saga', number: 1, pageCount: 10, coverIndex: 0, hasCover: true, ...o
});
const series = (issues: Issue[], o: Partial<Series> = {}): Series => ({
	id: 's1', name: 'Saga', sortKey: 'saga', publisher: 'Image', genres: [], creators: [], issues,
	issueCount: issues.length, coverIssueId: issues[0]?.id ?? '', addedAt: 0, completedCount: 0, progress: 0,
	state: 'unread', favorite: false, rtl: false, oneShot: false, complete: false, matched: false, related: [], ...o
});

test('profileKey normalizes spacing and case without folding accents', () => {
	assert.equal(profileKey('  ÁlAnA   Strange '), 'álana strange');
	assert.equal(profileHref('characters', 'Alana Strange'), '/characters/Alana%20Strange');
});

test('issueProfileNames deduplicates ComicInfo and Metron names and does not expose roles', () => {
	const i = issue({
	characters: ['Alana', ' Marko '],
	writers: ['Brian K. Vaughan'],
	artists: ['Fiona Staples'],
	metron: { source: 'metron', id: 4, characters: ['alana'], creators: ['Brian K. Vaughan', 'Fiona Staples'], sourceUrl: 'https://metron.cloud/issue/4/' }
	});
	assert.deepEqual(issueProfileNames(i, 'characters'), ['Alana', 'Marko']);
	assert.deepEqual(issueProfileNames(i, 'creators'), ['Brian K. Vaughan', 'Fiona Staples']);
});

test('findLocalProfile returns only matching local issues and their series', () => {
	const first = issue({ id: 'i1', number: 1, characters: ['Alana'], metron: { source: 'metron', id: 1, characters: ['Alana'], creators: [], sourceUrl: 'https://metron.cloud/issue/1/' } });
	const second = issue({ id: 'i2', number: 2, characters: ['Marko'] });
	const s = series([first, second]);
	const found = findLocalProfile('characters', 'Alana', [first, second], [s]);
	assert.ok(found);
	assert.equal(found?.name, 'Alana');
	assert.deepEqual(found?.series[0].issues.map((row) => row.id), ['i1']);
	assert.equal(found?.issueCount, 1);
	assert.equal(findLocalProfile('characters', 'Unknown', [first], [s]), undefined);
});

test('creator profile can retain a series-level creator while avoiding invented issue credits', () => {
	const i = issue({ writers: [], artists: [] });
	const s = series([i], { creators: ['Brian K. Vaughan'] });
	const found = findLocalProfile('creators', 'Brian K. Vaughan', [i], [s]);
	assert.ok(found);
	assert.deepEqual(found?.series[0].issues, []);
});

test('listLocalProfiles keeps spelling variants as separate names', () => {
	const a = issue({ characters: ['Åsa'] });
	const b = issue({ id: 'i2', characters: ['asa'] });
	const s = series([a, b]);
	assert.deepEqual(listLocalProfiles('characters', [a, b], [s]), ['asa', 'Åsa']);
});
