import test from 'node:test';
import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { applyMetronIssue, fetchMetronIssue, matchMetronIssue, metronTokenStatus, searchMetronIssues, searchMetronPage, setMetronToken } from './metron.ts';
import type { Issue } from '../types.ts';

const oldFetch = globalThis.fetch;
const issue = (o: Partial<Issue> = {}): Issue => ({
	id: 'local-1', fileName: 'Saga 001.cbz', relPath: 'Saga 001.cbz', size: 1, lastModified: 0, addedAt: 0,
	format: 'cbz', seriesId: 'saga', seriesName: 'Saga', number: 1, numberLabel: '001', year: 2012,
	pageCount: 20, coverIndex: 0, hasCover: true, writers: ['Brian K. Vaughan'], characters: ['Alana'], ...o
});

function mock(body: unknown) {
	globalThis.fetch = (async (url: string) => ({ ok: true, json: async () => body, url })) as typeof fetch;
}

test.afterEach(() => {
	globalThis.fetch = oldFetch;
	Capacitor.isNativePlatform = () => false;
});

test('web token helpers never accept or persist a user secret', async () => {
	assert.equal(await metronTokenStatus(), 'unavailable');
	await assert.rejects(setMetronToken('local-secret'), /bara anges i Android-appen/i);
});

test('searchMetronIssues sends series and number, then filters mismatching volume/year conservatively', async () => {
	let requested = '';
	globalThis.fetch = (async (url: string) => {
		requested = url;
		return { ok: true, json: async () => ({ results: [
			{ id: 2, series: { name: 'Saga', volume: 1, year_began: 2012 }, number: '1', issue: 'Saga #1' },
			{ id: 3, series: { name: 'Saga', volume: 2, year_began: 2012 }, number: '1', issue: 'Saga #1' },
			{ id: 4, series: { name: 'Saga Deluxe', volume: 1, year_began: 2012 }, number: '1' }
		] }) };
	}) as unknown as typeof fetch;
	const out = await searchMetronIssues(issue({ volume: 1 }));
	assert.match(requested, /action=search/);
	assert.match(requested, /q=Saga/);
	assert.match(requested, /number=1/);
	assert.deepEqual(out.map((x) => x.id), [2]);
});

test('native APK without its plugin/token fails with a clear Swedish explanation', async () => {
	Capacitor.isNativePlatform = () => true;
	let called = false;
	globalThis.fetch = (async () => { called = true; throw new Error('should not fetch'); }) as unknown as typeof fetch;
	await assert.rejects(searchMetronIssues({ name: 'Saga', number: 1 }), /Metron kunde inte nås.*Android-appen/i);
	assert.equal(called, false);
});

test('leading article variation is exposed as an uncertain candidate, never auto-selected silently', async () => {
	mock({ results: [{ id: 8, series: { name: 'The Avengers', volume: 1, year_began: 1963 }, number: '1', issue: 'The Avengers #1' }] });
	const rows = await searchMetronIssues({ name: 'Avengers', number: 1, year: 1963 });
	assert.equal(rows.length, 1);
	assert.ok(rows[0].confidence < 0.9);
	const match = await matchMetronIssue({ name: 'Avengers', number: 1, year: 1963 });
	assert.equal(match.status, 'ambiguous');
});

test('search result reports server pagination without changing array semantics', async () => {
	mock({ count: 125, next: 'https://metron.cloud/api/issue/?page=2', results: [{ id: 8, series: { name: 'Saga' }, number: '1' }] });
	const rows = await searchMetronIssues({ name: 'Saga', number: 1 });
	assert.equal(rows.length, 1);
	assert.equal(rows.hasMore, true);
});

test('searchMetronPage requests the requested proxy page', async () => {
	let requested = '';
	globalThis.fetch = (async (url: string) => {
		requested = url;
		return { ok: true, json: async () => ({ results: [{ id: 9, series: { name: 'Saga' }, number: '2' }] }) };
	}) as unknown as typeof fetch;
	await searchMetronPage({ name: 'Saga', number: 2 }, 2);
	assert.match(requested, /page=2/);
});

test('detail extraction keeps source, characters and creator names without role guessing', async () => {
	mock({
		id: 2,
		series: { name: 'Saga', volume: 1, year_began: 2012 },
		number: '1', issue: 'Saga (2012) #1', desc: 'Solicitation',
		characters: [{ name: 'Alana' }, { name: 'Marko' }],
		credits: [{ creator: { name: 'Brian K. Vaughan' }, role: { name: 'Writer' } }, { creator: { name: 'Fiona Staples' }, role: { name: 'Artist' } }],
		resource_url: 'https://metron.cloud/issue/2/', attribution: [{ source: 'Marvel', url: 'https://marvel.com' }]
	});
	const found = await fetchMetronIssue(2);
	assert.deepEqual(found.characters, ['Alana', 'Marko']);
	assert.deepEqual(found.creators, ['Brian K. Vaughan', 'Fiona Staples']);
	assert.equal(found.sourceUrl, 'https://metron.cloud/issue/2/');
	assert.deepEqual(found.attribution, [{ source: 'Marvel', url: 'https://marvel.com' }]);
});

test('ambiguous candidates are exposed for manual selection and not fetched automatically', async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return { ok: true, json: async () => ({ results: [
			{ id: 2, series: { name: 'Saga', volume: 1, year_began: 2012 }, number: '1' },
			{ id: 3, series: { name: 'Saga', volume: 2, year_began: 2012 }, number: '1' }
		] }) };
	}) as unknown as typeof fetch;
	const found = await matchMetronIssue(issue());
	assert.equal(found.status, 'ambiguous');
	assert.equal(found.selected, undefined);
	assert.equal(calls, 1);
	assert.ok(found.candidates.every((x) => x.uncertain));
});

test('applyMetronIssue preserves local ComicInfo-derived fields', () => {
	const local = issue({ publisher: 'Marvel', summary: 'Local summary' });
	const metron = {
		source: 'metron' as const, id: 2, characters: ['Marko'], creators: ['Fiona Staples'], sourceUrl: 'https://metron.cloud/issue/2/'
	};
	const out = applyMetronIssue(local, metron);
	assert.deepEqual([out.publisher, out.summary, out.characters, out.metron?.id], ['Marvel', 'Local summary', ['Alana'], 2]);
});

