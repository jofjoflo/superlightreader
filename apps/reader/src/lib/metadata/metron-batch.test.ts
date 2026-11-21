import test from 'node:test';
import assert from 'node:assert/strict';
import type { Issue } from '../types.ts';
import { runMetronBatch } from './metron-batch.ts';

const oldFetch = globalThis.fetch;
const issue = (patch: Partial<Issue> = {}): Issue => ({
	id: 'local-1', fileName: 'Saga 001.cbz', relPath: 'Saga 001.cbz', size: 1, lastModified: 0, addedAt: 0,
	format: 'cbz', seriesId: 'saga', seriesName: 'Saga', number: 1, numberLabel: '001', year: 2012,
	pageCount: 20, coverIndex: 0, hasCover: true, ...patch
});

test.afterEach(() => { globalThis.fetch = oldFetch; });

test('batch walks every page and only auto-matches an exact issue/year candidate', async () => {
	const pages: number[] = [];
	globalThis.fetch = (async (url: string) => {
		const parsed = new URL(url);
		const page = Number(parsed.searchParams.get('page') ?? 1);
		pages.push(page);
		if (parsed.searchParams.get('action') === 'detail') {
			return { ok: true, json: async () => ({ id: 2, series: { name: 'Saga', year_began: 2012 }, number: '1', characters: [] }) };
		}
		return {
			ok: true,
			json: async () => page === 1
				? { count: 2, next: 'https://metron.cloud/api/issue/?page=2', results: [{ id: 1, series: { name: 'Saga', year_began: 2011 }, number: '1' }] }
				: { count: 2, results: [{ id: 2, series: { name: 'Saga', year_began: 2012 }, number: '1' }] }
		};
	}) as unknown as typeof fetch;
	const saved: string[] = [];
	const result = await runMetronBatch([issue()], { minIntervalMs: 0, onMatch: (row) => { saved.push(row.id); } });
	assert.equal(result.status, 'completed');
	assert.equal(result.items[0].status, 'matched');
	assert.deepEqual(saved, ['local-1']);
	assert.deepEqual(pages, [1, 2, 1]);
});

test('batch skips an existing match and leaves it out of the write callback', async () => {
	let calls = 0;
	const result = await runMetronBatch([issue({ metron: { source: 'metron', id: 77, characters: [], creators: [], sourceUrl: 'https://metron.cloud/issue/77/' } })], {
		onMatch: () => { calls++; }
	});
	assert.equal(result.items[0].status, 'skipped');
	assert.equal(result.progress.skipped, 1);
	assert.equal(calls, 0);
});

test('batch reports progress and stops cleanly on abort', async () => {
	const controller = new AbortController();
	const progress: string[] = [];
	const result = await runMetronBatch([issue(), issue({ id: 'local-2' })], {
		signal: controller.signal,
		onProgress: (state) => {
			progress.push(`${state.done}/${state.total}`);
			if (state.currentIssueId === 'local-1') controller.abort();
		}
	});
	assert.equal(result.status, 'aborted');
	assert.equal(result.items.length, 0);
	assert.ok(progress.length >= 2);
});
