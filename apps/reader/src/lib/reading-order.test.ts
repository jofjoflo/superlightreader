import assert from 'node:assert/strict';
import test from 'node:test';
import { matchReadingOrder, parseReadingOrderJson } from './reading-order.ts';
import type { Issue, Series } from './types.ts';

const issue = (overrides: Partial<Issue> = {}): Issue => ({
	id: 'i1', fileName: 'Saga 001.cbz', relPath: 'Saga 001.cbz', size: 1, lastModified: 0, addedAt: 0, format: 'cbz',
	seriesId: 's1', seriesName: 'Saga', number: 1, numberLabel: '001', pageCount: 10, coverIndex: 0, hasCover: true, ...overrides
});
const series = (overrides: Partial<Series> = {}): Series => ({
	id: 's1', name: 'Saga', sortKey: 'saga', publisher: 'Förlag', genres: [], creators: [], related: [], issues: [issue()], issueCount: 1,
	coverIssueId: 'i1', addedAt: 0, completedCount: 0, progress: 0, state: 'unread', favorite: false, rtl: false, oneShot: false, complete: false, matched: false, ...overrides
});

test('reading order JSON parses supported fields and rejects malformed JSON', () => {
	const result = parseReadingOrderJson(JSON.stringify({ title: 'Saga order', year: 2012, characters: ['Alana'], sourceUrl: 'https://example.test', items: [{ series: 'Saga', issue: 1, essential: true }] }));
	assert.deepEqual(result.errors, []);
	assert.equal(result.order?.items[0].issue, 1);
	assert.ok(parseReadingOrderJson('{').errors.includes('Filen innehåller ogiltig JSON.'));
});

test('reading order JSON reports invalid URL and missing item series', () => {
	const result = parseReadingOrderJson({ title: 'x', sourceUrl: 'javascript:alert(1)', items: [{ issue: 1 }] });
	assert.equal(result.order, undefined);
	assert.ok(result.errors.some((x) => x.includes('sourceUrl')));
	assert.ok(result.errors.some((x) => x.includes('series')));
});

test('reading order matching matches exact series and issue while preserving missing entries', () => {
	const parsed = parseReadingOrderJson({ title: 'x', items: [{ series: 'saga', issue: 1 }, { series: 'Unknown', issue: 1 }] });
	const result = matchReadingOrder(parsed.order!, [series()]);
	assert.deepEqual(result.items.map((x) => x.status), ['matched', 'missing']);
	assert.equal(result.items[0].issue?.id, 'i1');
});

test('story is an annotation and does not require an issue title match', () => {
	const parsed = parseReadingOrderJson({ title: 'x', items: [{ series: 'Saga', issue: 1, story: 'Chapter One' }] });
	const result = matchReadingOrder(parsed.order!, [series()]);
	assert.equal(result.items[0].status, 'matched');
});

test('reading order matching does not guess when duplicate series names exist', () => {
	const parsed = parseReadingOrderJson({ title: 'x', items: [{ series: 'Saga', issue: 1 }] });
	const result = matchReadingOrder(parsed.order!, [series(), series({ id: 's2', issues: [issue({ id: 'i2', seriesId: 's2' })] })]);
	assert.equal(result.items[0].status, 'ambiguous');
});
