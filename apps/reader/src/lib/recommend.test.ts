import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeRows } from './recommend.ts';
import type { Series } from './types.ts';

const series = (id: string, patch: Partial<Series> = {}): Series => ({
	id, name: id, sortKey: id.toLowerCase(), publisher: 'Förlag', startYear: 2020,
	genres: [], creators: [], related: [], issues: [], issueCount: 1, coverIssueId: `${id}-issue`,
	addedAt: 1, completedCount: 0, progress: 0, state: 'unread', favorite: false, rtl: false,
	oneShot: true, complete: true, matched: false, ...patch
});

test('home rows recommend unread local series from a creator of a read series', () => {
	const rows = buildHomeRows([
		series('Read', { creators: ['Alan Moore'], completedCount: 1, progress: 1, state: 'done', lastReadAt: 20 }),
		series('Unread', { creators: ['Alan Moore'], addedAt: 2 }),
		series('Other', { creators: ['Other creator'], addedAt: 3 })
	], 30);
	const row = rows.find((candidate) => candidate.id === 'creator-alan moore');
	assert.ok(row);
	assert.equal(row?.kind, 'series');
	assert.equal(row?.title, 'Mer från Alan Moore');
	assert.deepEqual(row?.items.map((item) => item.series.id), ['Unread']);
});

test('creator shelf needs reading history and never includes already-read source series', () => {
	const rows = buildHomeRows([
		series('Read', { creators: ['Alan Moore'], completedCount: 1, progress: 1, state: 'done' }),
		series('Read too', { creators: ['Alan Moore'], completedCount: 1, progress: 1, state: 'done' })
	], 30);
	assert.equal(rows.some((candidate) => candidate.id.startsWith('creator-')), false);

	const cold = buildHomeRows([series('Unread', { creators: ['Alan Moore'] })], 30);
	assert.equal(cold.some((candidate) => candidate.id.startsWith('creator-')), false);
});
