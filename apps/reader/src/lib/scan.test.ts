import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { test } from 'node:test';
import { seriesKey } from './parse/name.ts';
import { normalizePublisher } from './parse/publishers.ts';
import { issueIdFor, scanFile, scanFiles } from './scan.ts';
import type { ScanDeps } from './scan.ts';
import type { ComicArchive, CoverResult, Issue, ScanInput } from './types.ts';
import { hash } from './util.ts';

// ───────────────────────── helpers ─────────────────────────

const NOW = 1_800_000_000_000;
const MODIFIED = 1_700_000_000_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const fileOf = (name: string, size = 100, bytes?: Uint8Array) =>
	new File([bytes ? Uint8Array.from({ length: size }, (_, i) => bytes[i] ?? 0) : new Uint8Array(size)], name, { lastModified: MODIFIED });
/** `path` is the relative path; the file name is its last segment. */
const input = (path: string, size = 100, bytes?: Uint8Array): ScanInput => ({
	file: fileOf(path.split('/').pop()!, size, bytes),
	path
});
const RAR = Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00); // "Rar!"
const ZIP = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0); // "PK\3\4"

const comicInfo = (body: string) =>
	`<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</ComicInfo>`;

interface FakeArchive extends ComicArchive {
	closed: number;
	blobs: Blob[]; // blobs[i] is what readPage(i) returns
}
function fakeArchive(
	spec: { pages?: number; xml?: string; textError?: boolean; pageError?: boolean; format?: 'zip' | 'rar' } = {}
): FakeArchive {
	const blobs = Array.from({ length: spec.pages ?? 3 }, (_, i) => new Blob([`page ${i}`], { type: 'image/jpeg' }));
	const archive: FakeArchive = {
		format: spec.format ?? 'zip',
		pages: blobs.map((b, index) => ({ index, name: `${index + 1}.jpg`, size: b.size, mime: 'image/jpeg' })),
		blobs,
		closed: 0,
		async readPage(i) {
			if (spec.pageError) throw new Error('boom');
			return blobs[i];
		},
		async readText(name) {
			if (spec.textError) throw new Error('boom');
			return name === 'ComicInfo.xml' ? spec.xml : undefined;
		},
		close() {
			archive.closed++;
		}
	};
	return archive;
}

const COVER: CoverResult = { blob: new Blob(['webp']), width: 400, height: 600, color: '#336699' };
/** makeCover fake that records the blobs it was given. */
function fakeCovers(fail = false) {
	const seen: Blob[] = [];
	const makeCover = async (image: Blob): Promise<CoverResult> => {
		seen.push(image);
		if (fail) throw new Error('decode failed');
		return COVER;
	};
	return { seen, makeCover };
}

/** scanFile with a fake archive and a fake cover maker. */
async function scanOne(path: string, archive: FakeArchive = fakeArchive(), covers = fakeCovers()) {
	const res = await scanFile(input(path), NOW, { openArchive: async () => archive, makeCover: covers.makeCover });
	return { ...res, archive, covers };
}

/** scanFiles with per-file-name behaviour: Error → open fails with it, otherwise the fake archive. */
function depsFor(behave: (name: string) => FakeArchive | Error = () => fakeArchive()) {
	const opened: string[] = [];
	const deps: ScanDeps = {
		openArchive: async (file) => {
			opened.push(file.name!);
			const r = behave(file.name!);
			if (r instanceof Error) throw r;
			return r;
		},
		makeCover: fakeCovers().makeCover
	};
	return { deps, opened };
}

/** Collects what scanFiles reports. */
function collector(extra: { onIssue?: (issue: Issue, input: ScanInput) => void | Promise<void> } = {}) {
	const issues: Issue[] = [];
	const covers: (CoverResult | undefined)[] = [];
	const known: { id: string; path: string }[] = [];
	const progress: [number, number, string][] = [];
	return {
		issues,
		covers,
		known,
		progress,
		opts: {
			onIssue: async (issue: Issue, cover: CoverResult | undefined, inp: ScanInput) => {
				await extra.onIssue?.(issue, inp);
				issues.push(issue);
				covers.push(cover);
			},
			onKnown: (id: string, inp: ScanInput) => known.push({ id, path: inp.path }),
			onProgress: (done: number, total: number, label: string) => progress.push([done, total, label])
		}
	};
}

// ───────────────────────── issueIdFor ─────────────────────────

test('issueIdFor = hash(lowercased base name | size)', () => {
	assert.equal(issueIdFor({ name: 'Saga 001.CBZ', size: 1234 }), hash('saga 001.cbz|1234'));
});

test('issueIdFor ignores folders, case and unicode normalization form; size and name matter', () => {
	const id = issueIdFor({ name: 'Saga 001.cbz', size: 1234 });
	assert.equal(issueIdFor({ name: 'Marvel/X-Men/SAGA 001.cbz', size: 1234 }), id);
	assert.equal(issueIdFor({ name: 'C:\\comics\\saga 001.cbz', size: 1234 }), id);
	assert.notEqual(issueIdFor({ name: 'Saga 001.cbz', size: 1235 }), id);
	assert.notEqual(issueIdFor({ name: 'Saga 002.cbz', size: 1234 }), id);
	const nfc = 'Älgjakt 1.cbz'.normalize('NFC');
	assert.equal(issueIdFor({ name: nfc.normalize('NFD'), size: 9 }), issueIdFor({ name: nfc, size: 9 }));
});

// ───────────────────────── scanFile: field priority ─────────────────────────

test('scanFile without ComicInfo: series, number, year, publisher from path and file name', async () => {
	const { issue, cover } = await scanOne('Serier/Marvel/X-Men/X-Men 020 (1991).cbz');
	assert.equal(issue.id, issueIdFor({ name: 'X-Men 020 (1991).cbz', size: 100 }));
	assert.equal(issue.fileName, 'X-Men 020 (1991).cbz');
	assert.equal(issue.relPath, 'Serier/Marvel/X-Men/X-Men 020 (1991).cbz');
	assert.equal(issue.size, 100);
	assert.equal(issue.lastModified, MODIFIED);
	assert.equal(issue.addedAt, NOW);
	assert.equal(issue.format, 'cbz');
	assert.equal(issue.seriesName, 'X-Men');
	assert.equal(issue.seriesId, seriesKey('X-Men'));
	assert.equal(issue.number, 20);
	assert.equal(issue.numberLabel, '020');
	assert.equal(issue.year, 1991);
	assert.equal(issue.publisher, normalizePublisher('Marvel'));
	assert.equal(issue.rtl, false);
	assert.equal(issue.writers, undefined);
	assert.equal(issue.wide, undefined);
	assert.equal(issue.unsupported, undefined);
	assert.equal(issue.persisted, undefined);
	assert.ok(cover);
});

test('ComicInfo beats path and file name (series, number, year, publisher, title)', async () => {
	const xml = comicInfo(
		'<Series>Saga</Series><Number>12</Number><Title>Twelve</Title><Year>2014</Year><Publisher>Image Comics</Publisher><Imprint>Skybound</Imprint>'
	);
	const { issue } = await scanOne('Serier/Marvel/X-Men/X-Men 020 (1991).cbz', fakeArchive({ xml }));
	assert.equal(issue.seriesName, 'Saga');
	assert.equal(issue.seriesId, seriesKey('Saga'));
	assert.equal(issue.number, 12);
	assert.equal(issue.numberLabel, '12');
	assert.equal(issue.title, 'Twelve');
	assert.equal(issue.year, 2014);
	assert.equal(issue.publisher, normalizePublisher('Image Comics'));
	assert.notEqual(issue.publisher, normalizePublisher('Marvel'));
	assert.equal(issue.imprint, 'Skybound');
});

test('partial ComicInfo: missing fields fall back to path/file name', async () => {
	const xml = comicInfo('<Series>Uncanny</Series><Summary>Mutants.</Summary>');
	const { issue } = await scanOne('Serier/Marvel/X-Men/X-Men 020 (1991).cbz', fakeArchive({ xml }));
	assert.equal(issue.seriesName, 'Uncanny');
	assert.equal(issue.number, 20);
	assert.equal(issue.year, 1991);
	assert.equal(issue.publisher, normalizePublisher('Marvel'));
	assert.equal(issue.summary, 'Mutants.');
});

test('series folder beats a file name without series; volumeYear comes from the folder', async () => {
	const { issue } = await scanOne('Serier/Saga (2012)/001.cbz');
	assert.equal(issue.seriesName, 'Saga');
	assert.equal(issue.volumeYear, 2012);
	assert.equal(issue.seriesId, seriesKey('Saga', undefined, 2012));
});

test('ComicInfo number: decimals, zero and non-numeric', async () => {
	const num = async (n: string) => (await scanOne('Saga 007.cbz', fakeArchive({ xml: comicInfo(`<Number>${n}</Number>`) }))).issue;
	assert.deepEqual([(await num('1.5')).number, (await num('1.5')).numberLabel], [1.5, '1.5']);
	assert.deepEqual([(await num('0')).number, (await num('0')).numberLabel], [0, '0']); // 0 is a number, not "missing"
	// not parseable → file name wins, label stays consistent with the number
	assert.deepEqual([(await num('Annual')).number, (await num('Annual')).numberLabel], [7, '007']);
});

test('ComicInfo volume: a plain number is the volume, a year-like one is the volume year', async () => {
	const vol = async (v: string) => (await scanOne('Batman 001.cbz', fakeArchive({ xml: comicInfo(`<Series>Batman</Series><Volume>${v}</Volume>`) }))).issue;
	const three = await vol('3');
	assert.equal(three.volume, 3);
	assert.equal(three.volumeYear, undefined);
	assert.equal(three.seriesId, seriesKey('Batman', 3, undefined));
	const year = await vol('2016');
	assert.equal(year.volume, undefined);
	assert.equal(year.volumeYear, 2016);
	assert.equal(year.seriesId, seriesKey('Batman', undefined, 2016));
});

test('ComicInfo "unset" placeholders (-1) do not override the file name', async () => {
	const xml = comicInfo('<Series>Saga</Series><Year>-1</Year><Volume>-1</Volume>');
	const { issue } = await scanOne('Saga 001 (2012).cbz', fakeArchive({ xml }));
	assert.equal(issue.year, 2012);
	assert.equal(issue.volume, undefined);
	assert.equal(issue.volumeYear, undefined);
});

test('creators, genres, tags, characters, summary, language, age rating, manga flag', async () => {
	const xml = comicInfo(`
		<Series>Saga</Series>
		<Writer>Brian K. Vaughan</Writer>
		<Penciller>Fiona Staples</Penciller><Inker>Fiona Staples</Inker><CoverArtist>Jane Doe</CoverArtist>
		<Colorist>Color Person</Colorist><Letterer>Letter Person</Letterer>
		<Genre>Sci-Fi</Genre><Tags>space</Tags><Characters>Alana</Characters>
		<Summary>  A summary.  </Summary><LanguageISO>en</LanguageISO><AgeRating>Mature 17+</AgeRating>
		<Manga>YesAndRightToLeft</Manga>`);
	const { issue } = await scanOne('Saga 001.cbz', fakeArchive({ xml }));
	assert.deepEqual(issue.writers, ['Brian K. Vaughan']);
	assert.deepEqual(issue.artists, ['Fiona Staples', 'Jane Doe']); // unique; colorist/letterer excluded
	assert.deepEqual(issue.genres, ['Sci-Fi']);
	assert.deepEqual(issue.tags, ['space']);
	assert.deepEqual(issue.characters, ['Alana']);
	assert.equal(issue.summary, 'A summary.');
	assert.equal(issue.language, 'en');
	assert.equal(issue.ageRating, 'Mature 17+');
	assert.equal(issue.rtl, true);
});

test('only Manga=YesAndRightToLeft means rtl', async () => {
	for (const m of ['Yes', 'No', 'Unknown']) {
		const { issue } = await scanOne('Saga 001.cbz', fakeArchive({ xml: comicInfo(`<Manga>${m}</Manga>`) }));
		assert.equal(issue.rtl, false, m);
	}
});

test('format comes from the file extension, not from the archive content', async () => {
	const fmt = async (name: string) => (await scanOne(name, fakeArchive({ format: 'zip' }))).issue.format;
	assert.deepEqual(
		[await fmt('a.cbz'), await fmt('a.CBR'), await fmt('a.zip'), await fmt('a.Rar')],
		['cbz', 'cbr', 'zip', 'rar']
	);
});

// ───────────────────────── scanFile: pages and cover ─────────────────────────

test('pageCount = archive pages; cover is made from page 0 by default', async () => {
	const { issue, cover, archive, covers } = await scanOne('Saga 001.cbz', fakeArchive({ pages: 5 }));
	assert.equal(issue.pageCount, 5);
	assert.equal(issue.coverIndex, 0);
	assert.equal(covers.seen.length, 1);
	assert.equal(covers.seen[0], archive.blobs[0]);
	assert.equal(cover, COVER);
	assert.equal(issue.hasCover, true);
	assert.equal(issue.color, COVER.color);
	assert.equal(issue.coverW, COVER.width);
	assert.equal(issue.coverH, COVER.height);
});

test('cover page = ComicInfo FrontCover; clamped into range', async () => {
	const pages = (xml: string) => comicInfo(`<Pages>${xml}</Pages>`);
	const front = await scanOne(
		'Saga 001.cbz',
		fakeArchive({ pages: 5, xml: pages('<Page Image="0"/><Page Image="3" Type="FrontCover"/>') })
	);
	assert.equal(front.issue.coverIndex, 3);
	assert.equal(front.covers.seen[0], front.archive.blobs[3]);

	const far = await scanOne('Saga 001.cbz', fakeArchive({ pages: 5, xml: pages('<Page Image="99" Type="FrontCover"/>') }));
	assert.equal(far.issue.coverIndex, 4);

	const none = await scanOne('Saga 001.cbz', fakeArchive({ pages: 5, xml: pages('<Page Image="2" Type="Story"/>') }));
	assert.equal(none.issue.coverIndex, 0);
});

test('wide = ComicInfo DoublePage pages that exist', async () => {
	const xml = comicInfo(
		'<Pages><Page Image="1" DoublePage="true"/><Page Image="2"/><Page Image="4" DoublePage="true"/><Page Image="99" DoublePage="true"/></Pages>'
	);
	const { issue } = await scanOne('Saga 001.cbz', fakeArchive({ pages: 5, xml }));
	assert.deepEqual(issue.wide, [1, 4]);
});

test('cover failure (decode or read) keeps the issue without a cover', async () => {
	const decode = await scanOne('Saga 001.cbz', fakeArchive(), fakeCovers(true));
	assert.equal(decode.issue.hasCover, false);
	assert.equal(decode.cover, undefined);
	assert.equal(decode.issue.color, undefined);
	assert.equal(decode.issue.coverW, undefined);
	assert.equal(decode.issue.pageCount, 3);
	assert.equal(decode.archive.closed, 1);

	const read = await scanOne('Saga 001.cbz', fakeArchive({ pageError: true }));
	assert.equal(read.issue.hasCover, false);
	assert.equal(read.cover, undefined);
	assert.equal(read.covers.seen.length, 0);
	assert.equal(read.archive.closed, 1);
});

test('unreadable ComicInfo falls back to the file name', async () => {
	const { issue, archive } = await scanOne('Saga 003.cbz', fakeArchive({ textError: true }));
	assert.equal(issue.seriesName, 'Saga');
	assert.equal(issue.number, 3);
	assert.equal(issue.hasCover, true);
	assert.equal(archive.closed, 1);
});

test('archive is closed exactly once, also when scanning fails', async () => {
	const ok = await scanOne('Saga 001.cbz');
	assert.equal(ok.archive.closed, 1);

	const empty = fakeArchive({ pages: 0 });
	await assert.rejects(scanOne('Saga 001.cbz', empty), /sidor/);
	assert.equal(empty.closed, 1);
});

// ───────────────────────── scanFile: unopenable archives ─────────────────────────

const failOpen = (error: Error) => ({ openArchive: async (): Promise<ComicArchive> => { throw error; } });

test('RAR that cannot be opened → filename-only issue, unsupported "rar"', async () => {
	const inp = input('Serier/Marvel/X-Men/X-Men 020 (1991).cbr', 500, RAR);
	const { issue, cover } = await scanFile(inp, NOW, failOpen(new Error('RAR/CBR stöds inte än')));
	assert.equal(issue.unsupported, 'rar');
	assert.equal(cover, undefined);
	assert.equal(issue.pageCount, 0);
	assert.equal(issue.hasCover, false);
	assert.equal(issue.coverIndex, 0);
	assert.equal(issue.format, 'cbr');
	assert.equal(issue.id, issueIdFor(inp.file));
	assert.equal(issue.size, 500);
	assert.equal(issue.addedAt, NOW);
	// series info still comes from the path
	assert.equal(issue.seriesName, 'X-Men');
	assert.equal(issue.number, 20);
	assert.equal(issue.year, 1991);
	assert.equal(issue.publisher, normalizePublisher('Marvel'));
});

test('encrypted and corrupt archives → filename-only issue with the reason', async () => {
	const why = async (bytes: Uint8Array, message: string) =>
		(await scanFile(input('Saga 001.cbz', 100, bytes), NOW, failOpen(new Error(message)))).issue.unsupported;
	assert.equal(await why(ZIP, 'Krypterad arkiv stöds inte'), 'encrypted');
	assert.equal(await why(ZIP, 'Skadad zip-fil (ingen slutpost hittades)'), 'corrupt');
	assert.equal(await why(ZIP, 'something unexpected'), 'corrupt');
	assert.equal(await why(RAR, 'RAR-filen är lösenordsskyddad'), 'encrypted');
	assert.equal(await why(RAR, 'RAR-filen är skadad'), 'corrupt');
	assert.equal(await why(RAR, 'Filen är inte ett giltigt RAR-arkiv'), 'corrupt');
	assert.equal(await why(RAR, 'Kunde inte ladda RAR-stödet'), 'rar'); // support missing / unreadable
});

test('not an archive (no zip/rar signature) → scanFile throws the open error', async () => {
	const text = new TextEncoder().encode('this is not an archive');
	await assert.rejects(scanFile(input('Saga 001.cbz', 0, text), NOW, failOpen(new Error('Okänt arkivformat'))), /Okänt arkivformat/);
	await assert.rejects(scanFile(input('Saga 001.cbz', 0, new Uint8Array(0)), NOW, failOpen(new Error('Okänt arkivformat'))), /Okänt/);
});

// ───────────────────────── scanFiles ─────────────────────────

test('scanFiles adds new files, reports cover, ignores non-comic files', async () => {
	const { deps, opened } = depsFor();
	const c = collector();
	const res = await scanFiles(
		[input('Saga 001.cbz'), input('notes.txt'), input('Marvel/X-Men 001.CBR'), input('cover.jpg'), input('Saga 002.zip')],
		c.opts,
		deps
	);
	assert.deepEqual(res, { added: 3, skipped: 0, failed: [] });
	assert.deepEqual(opened.sort(), ['Saga 001.cbz', 'Saga 002.zip', 'X-Men 001.CBR']);
	assert.equal(c.issues.length, 3);
	assert.ok(c.covers.every((cv) => cv === COVER));
	assert.equal(c.known.length, 0);
});

test('known ids are skipped without opening the archive, and reported through onKnown', async () => {
	const { deps, opened } = depsFor();
	const c = collector();
	const known = new Set([issueIdFor({ name: 'Saga 001.cbz', size: 100 })]);
	const res = await scanFiles([input('A/Saga 001.cbz'), input('Saga 002.cbz')], { ...c.opts, known }, deps);
	assert.deepEqual(res, { added: 1, skipped: 1, failed: [] });
	assert.deepEqual(opened, ['Saga 002.cbz']);
	assert.deepEqual(c.known, [{ id: issueIdFor({ name: 'Saga 001.cbz', size: 100 }), path: 'A/Saga 001.cbz' }]);
	assert.deepEqual(c.issues.map((i) => i.fileName), ['Saga 002.cbz']);
});

test('onKnown is optional', async () => {
	const { deps } = depsFor();
	const c = collector();
	const known = new Set([issueIdFor({ name: 'Saga 001.cbz', size: 100 })]);
	const { onKnown: _drop, ...opts } = c.opts;
	const res = await scanFiles([input('Saga 001.cbz')], { ...opts, known }, deps);
	assert.deepEqual(res, { added: 0, skipped: 1, failed: [] });
});

test('identical files within one batch are scanned once; same name with another size is a different file', async () => {
	const { deps, opened } = depsFor();
	const c = collector();
	const res = await scanFiles(
		[input('A/Saga 001.cbz', 100), input('B/Saga 001.cbz', 100), input('C/saga 001.CBZ'.replace('CBZ', 'cbz'), 100), input('D/Saga 001.cbz', 101)],
		c.opts,
		deps
	);
	assert.deepEqual(res, { added: 2, skipped: 2, failed: [] });
	assert.equal(opened.length, 2);
	assert.equal(new Set(c.issues.map((i) => i.id)).size, 2);
	assert.equal(c.issues.find((i) => i.size === 100)?.relPath, 'A/Saga 001.cbz'); // first occurrence wins
});

test('duplicates of a known id are all reported through onKnown', async () => {
	const { deps, opened } = depsFor();
	const c = collector();
	const known = new Set([issueIdFor({ name: 'Saga 001.cbz', size: 100 })]);
	const res = await scanFiles([input('A/Saga 001.cbz'), input('B/Saga 001.cbz')], { ...c.opts, known }, deps);
	assert.deepEqual(res, { added: 0, skipped: 2, failed: [] });
	assert.deepEqual(c.known.map((k) => k.path), ['A/Saga 001.cbz', 'B/Saga 001.cbz']);
	assert.equal(opened.length, 0);
});

test('unsupported archives are added to the shelf (no cover), not failed', async () => {
	const { deps } = depsFor((name) => (name.endsWith('.cbr') ? new Error('RAR/CBR stöds inte än') : fakeArchive()));
	const c = collector();
	const res = await scanFiles(
		[input('Saga 001.cbz'), input('Saga 002.cbr', 50, RAR), input('Saga 003.cbz', 50, ZIP)],
		c.opts,
		{ ...deps, openArchive: async (f) => (f.name === 'Saga 003.cbz' ? Promise.reject(new Error('Skadad zip-fil (x)')) : deps.openArchive!(f)) }
	);
	assert.deepEqual(res, { added: 3, skipped: 0, failed: [] });
	const byName = new Map(c.issues.map((i) => [i.fileName, i]));
	assert.equal(byName.get('Saga 001.cbz')?.unsupported, undefined);
	assert.equal(byName.get('Saga 002.cbr')?.unsupported, 'rar');
	assert.equal(byName.get('Saga 003.cbz')?.unsupported, 'corrupt');
	assert.equal(c.covers[c.issues.findIndex((i) => i.unsupported)], undefined);
});

test('a file that is not an archive goes to failed; scanFiles never throws', async () => {
	const { deps } = depsFor((name) => (name.startsWith('Bad') ? new Error('Okänt arkivformat') : fakeArchive()));
	const c = collector();
	const res = await scanFiles([input('Dir/Bad 001.cbz', 10, new TextEncoder().encode('hello')), input('Good 001.cbz')], c.opts, deps);
	assert.equal(res.added, 1);
	assert.equal(res.skipped, 0);
	assert.deepEqual(res.failed, [{ path: 'Dir/Bad 001.cbz', error: 'Okänt arkivformat' }]);
	assert.deepEqual(c.issues.map((i) => i.fileName), ['Good 001.cbz']);
});

test('errors thrown by onIssue count as failed; the scan continues', async () => {
	const { deps } = depsFor();
	const c = collector({
		onIssue: (issue) => {
			if (issue.fileName === 'Saga 002.cbz') throw new Error('disk full');
		}
	});
	const res = await scanFiles([input('Saga 001.cbz'), input('x/Saga 002.cbz'), input('Saga 003.cbz')], c.opts, deps);
	assert.equal(res.added, 2);
	assert.deepEqual(res.failed, [{ path: 'x/Saga 002.cbz', error: 'disk full' }]);
	assert.deepEqual(c.issues.map((i) => i.fileName).sort(), ['Saga 001.cbz', 'Saga 003.cbz']);
});

test('onProgress: one call per scanned file (done 1..n of n), skipped files excluded', async () => {
	const { deps } = depsFor((name) => (name.startsWith('Bad') ? new Error('Okänt arkivformat') : fakeArchive()));
	const c = collector();
	const known = new Set([issueIdFor({ name: 'Old 001.cbz', size: 100 })]);
	await scanFiles(
		[input('Old 001.cbz'), input('A 001.cbz'), input('Bad 001.cbz'), input('B 001.cbz'), input('A 001.cbz'), input('C 001.cbz'), input('readme.md')],
		{ ...c.opts, known, concurrency: 2 },
		deps
	);
	assert.deepEqual(
		c.progress.map(([done, total]) => [done, total]),
		[[1, 4], [2, 4], [3, 4], [4, 4]]
	);
	assert.deepEqual(c.progress.map((p) => p[2]).sort(), ['A 001.cbz', 'B 001.cbz', 'Bad 001.cbz', 'C 001.cbz']); // file names
});

test('nothing to scan → no progress calls, empty result', async () => {
	const c = collector();
	assert.deepEqual(await scanFiles([], c.opts, depsFor().deps), { added: 0, skipped: 0, failed: [] });
	assert.deepEqual(await scanFiles([input('readme.md')], c.opts, depsFor().deps), { added: 0, skipped: 0, failed: [] });
	assert.equal(c.progress.length, 0);
});

test('concurrency: default 3, honours opts.concurrency', async () => {
	const peak = async (concurrency?: number) => {
		let inFlight = 0;
		let max = 0;
		const base = depsFor().deps;
		const deps: ScanDeps = {
			...base,
			openArchive: async (f) => {
				inFlight++;
				max = Math.max(max, inFlight);
				await sleep(5);
				return base.openArchive!(f);
			}
		};
		const c = collector({
			onIssue: async () => {
				await sleep(1);
				inFlight--;
			}
		});
		const inputs = Array.from({ length: 9 }, (_, i) => input(`Saga ${i + 1}.cbz`));
		const res = await scanFiles(inputs, { ...c.opts, concurrency }, deps);
		assert.equal(res.added, 9);
		return max;
	};
	assert.equal(await peak(), 3);
	assert.equal(await peak(1), 1);
	assert.equal(await peak(5), 5);
});

test('abort stops picking up new files; in-flight work finishes; no throw', async () => {
	const { deps, opened } = depsFor();
	const ac = new AbortController();
	const c = collector({ onIssue: () => ac.abort() });
	const inputs = Array.from({ length: 5 }, (_, i) => input(`Saga ${i + 1}.cbz`));
	const res = await scanFiles(inputs, { ...c.opts, concurrency: 1, signal: ac.signal }, deps);
	assert.deepEqual(res, { added: 1, skipped: 0, failed: [] });
	assert.equal(opened.length, 1);
	assert.deepEqual(c.progress, [[1, 5, 'Saga 1.cbz']]);
});

test('already aborted: nothing is scanned (known files are still reported)', async () => {
	const { deps, opened } = depsFor();
	const c = collector();
	const known = new Set([issueIdFor({ name: 'Saga 001.cbz', size: 100 })]);
	const res = await scanFiles([input('Saga 001.cbz'), input('Saga 002.cbz')], { ...c.opts, known, signal: AbortSignal.abort() }, deps);
	assert.deepEqual(res, { added: 0, skipped: 1, failed: [] });
	assert.equal(opened.length, 0);
	assert.equal(c.known.length, 1);
	assert.equal(c.progress.length, 0);
});

test('issues are stamped with the time they were scanned', async () => {
	const { deps } = depsFor();
	const c = collector();
	const before = Date.now();
	await scanFiles([input('Saga 001.cbz')], c.opts, deps);
	assert.ok(c.issues[0].addedAt >= before && c.issues[0].addedAt <= Date.now());
});

// ───────────────────────── integration (real archive + real parsers) ─────────────────────────

test('integration: scans apps/tools/converter/test_jpg_comic.cbz (cover maker stubbed)', async () => {
	const url = new URL('../../../tools/converter/test_jpg_comic.cbz', import.meta.url);
	const cbz = new File([await openAsBlob(url)], 'test_jpg_comic.cbz', { lastModified: MODIFIED });
	const covers = fakeCovers();
	const c = collector();
	const res = await scanFiles([{ file: cbz, path: 'Tester/test_jpg_comic.cbz' }], c.opts, { makeCover: covers.makeCover });

	assert.deepEqual(res, { added: 1, skipped: 0, failed: [] });
	const [issue] = c.issues;
	assert.equal(issue.id, issueIdFor(cbz));
	assert.equal(issue.format, 'cbz');
	assert.equal(issue.pageCount, 5);
	assert.equal(issue.coverIndex, 0);
	assert.equal(issue.unsupported, undefined);
	assert.equal(issue.hasCover, true);
	assert.equal(c.covers[0], COVER);
	// the cover maker got page 1, inflated from the zip: a real JPEG
	const page = covers.seen[0];
	assert.equal(page.type, 'image/jpeg');
	assert.equal(page.size, 16830);
	assert.deepEqual([...new Uint8Array(await page.slice(0, 2).arrayBuffer())], [0xff, 0xd8]);
});
