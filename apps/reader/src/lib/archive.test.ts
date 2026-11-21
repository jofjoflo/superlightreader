import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { isComicFileName, openArchive } from './archive.ts';
import { mimeFor } from './mime.ts';

// ───────────────────────── helpers ─────────────────────────

const text = new TextEncoder();
const blobOf = (u8: Uint8Array) => new Blob([u8 as Uint8Array<ArrayBuffer>]);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(b);
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** Deterministic, practically incompressible bytes. */
function noise(n: number, seed: number): Uint8Array {
	const out = new Uint8Array(n);
	let x = seed | 1;
	for (let i = 0; i < n; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		out[i] = x & 255;
	}
	return out;
}

/** Wraps a Blob and counts the bytes actually read through arrayBuffer(); slices share the counter. */
class Counting {
	inner: Blob;
	stats: { bytes: number };
	constructor(inner: Blob, stats = { bytes: 0 }) {
		this.inner = inner;
		this.stats = stats;
	}
	get size() {
		return this.inner.size;
	}
	get type() {
		return this.inner.type;
	}
	slice(start?: number, end?: number, type?: string): Counting {
		return new Counting(this.inner.slice(start, end, type), this.stats);
	}
	async arrayBuffer() {
		this.stats.bytes += this.inner.size;
		return this.inner.arrayBuffer();
	}
}

// ───────────────────────── small pure helpers ─────────────────────────

test('archive: isComicFileName', () => {
	for (const ok of ['a.cbz', 'A.CBZ', 'x/y/z.Cbr', 'b.zip', 'c.RAR', 'd.rar', 'Saga 001 (2012).cbz', 'a.b.cbz']) {
		assert.equal(isComicFileName(ok), true, ok);
	}
	for (const no of ['a.pdf', 'a.cb7', 'a.7z', 'cbz', 'a.cbz.txt', 'a.cbzz', 'ComicInfo.xml', '', 'a.zip.bak']) {
		assert.equal(isComicFileName(no), false, no);
	}
});

test('archive: mimeFor covers every page extension', () => {
	const expected: Record<string, string> = {
		'a.avif': 'image/avif',
		'a.webp': 'image/webp',
		'a.jpg': 'image/jpeg',
		'a.jpeg': 'image/jpeg',
		'a.JPG': 'image/jpeg',
		'a.png': 'image/png',
		'a.PNG': 'image/png',
		'a.gif': 'image/gif',
		'a.bmp': 'image/bmp',
		'dir.v2/a.b.Webp': 'image/webp'
	};
	for (const [name, mime] of Object.entries(expected)) assert.equal(mimeFor(name), mime, name);
});

// ───────────────────────── (a) real fixtures ─────────────────────────

const FIXTURE_DIR = new URL('../../../tools/converter/', import.meta.url);
const pad = (n: number) => String(n).padStart(3, '0');
// Names and sizes as printed by `python3 -m zipfile -l`.
const FIXTURES = [
	{
		file: 'demo_comic.cbz',
		name: (n: number) => `${pad(n)}.avif`,
		mime: 'image/avif',
		sizes: [2303, 2303, 2316, 2316, 2704, 2704, 3101, 3101, 2323, 2323]
	},
	{
		file: 'test_avif_comic.cbz',
		name: (n: number) => `${pad(n)}.avif`,
		mime: 'image/avif',
		sizes: [2644, 2341, 2968, 3301, 2518]
	},
	{
		file: 'test_jpg_comic.cbz',
		name: (n: number) => `${pad(n)}_page.jpg`,
		mime: 'image/jpeg',
		sizes: [16830, 16817, 17589, 18623, 17703]
	},
	{ file: 'from_directory.cbz', name: (n: number) => `${pad(n)}.avif`, mime: 'image/avif', sizes: [361, 362, 360] }
];

for (const fx of FIXTURES) {
	test(`archive: fixture ${fx.file}`, async () => {
		const blob = await openAsBlob(new URL(fx.file, FIXTURE_DIR));
		const file = new File([blob], fx.file); // what the file picker hands us
		const archive = await openArchive(file);
		assert.equal(archive.format, 'zip');
		assert.deepEqual(
			archive.pages,
			fx.sizes.map((size, i) => ({ index: i, name: fx.name(i + 1), size, mime: fx.mime }))
		);

		const reference = unzipSync(new Uint8Array(await blob.arrayBuffer())); // independent whole-file inflate
		for (const page of archive.pages) {
			const b = await archive.readPage(page.index);
			assert.equal(b.type, page.mime);
			assert.equal(b.size, page.size);
			assert.ok(same(await bytesOf(b), reference[page.name]), page.name);
		}
		assert.equal(await archive.readText('ComicInfo.xml'), undefined);
		archive.close();
	});
}

// ───────────────────────── (b) synthetic archives ─────────────────────────

const COMIC_INFO = '<?xml version="1.0"?>\n<ComicInfo><Series>Älvor &amp; Åskor</Series><Number>7</Number></ComicInfo>';

test('archive: pages are image entries only, in natural order of the full path', async () => {
	const img = (seed: number) => noise(120, seed);
	const files: Record<string, Uint8Array> = {
		'Ch 10/p1.png': img(1),
		'Ch 2/p1.png': img(2),
		'Ch 1/p10.png': img(3),
		'Ch 1/p2.png': img(4),
		'cover.jpg': img(5),
		'Ch 3/page.PNG': img(6),
		'x.GIF': img(7),
		'y.Bmp': img(8),
		'z.webp': img(9),
		'w.avif': img(10),
		'v.jpeg': img(11),
		// not pages:
		'__MACOSX/Ch 1/._p2.png': img(12),
		'__MACOSX/._cover.jpg': img(13),
		'__MACOSX/page99.jpg': img(14),
		'Ch 1/._p3.png': img(15),
		'._root.jpg': img(16),
		'Thumbs.db': img(17),
		'.DS_Store': img(18),
		'ComicInfo.xml': text.encode(COMIC_INFO),
		'readme.txt': text.encode('hej'),
		'scan.tiff': img(19),
		'page.jpg.bak': img(20),
		'Ch 4/': new Uint8Array(0) // directory entry
	};
	for (const level of [0, 6] as const) {
		const archive = await openArchive(blobOf(zipSync(files, { level })));
		assert.deepEqual(
			archive.pages.map((p) => p.name),
			[
				'Ch 1/p2.png',
				'Ch 1/p10.png',
				'Ch 2/p1.png',
				'Ch 3/page.PNG',
				'Ch 10/p1.png',
				'cover.jpg',
				'v.jpeg',
				'w.avif',
				'x.GIF',
				'y.Bmp',
				'z.webp'
			]
		);
		assert.deepEqual(
			archive.pages.map((p) => p.mime),
			[
				'image/png',
				'image/png',
				'image/png',
				'image/png',
				'image/png',
				'image/jpeg',
				'image/jpeg',
				'image/avif',
				'image/gif',
				'image/bmp',
				'image/webp'
			]
		);
		assert.deepEqual(
			archive.pages.map((p) => p.index),
			archive.pages.map((_, i) => i)
		);
		for (const page of archive.pages) {
			assert.equal(page.size, files[page.name].length);
			const b = await archive.readPage(page.index);
			assert.equal(b.type, page.mime);
			assert.ok(same(await bytesOf(b), files[page.name]), page.name);
		}
	}
});

test('archive: natural order of 3000 pages stored in reverse (page2 before page10)', async () => {
	const files: Record<string, Uint8Array> = {};
	for (let i = 3000; i >= 1; i--) files[`page${i}.jpg`] = new Uint8Array([i & 255, i >> 8]);
	const archive = await openArchive(blobOf(zipSync(files, { level: 0 })));
	assert.equal(archive.pages.length, 3000);
	assert.ok(archive.pages.every((p, i) => p.name === `page${i + 1}.jpg`));
	assert.deepEqual(await bytesOf(await archive.readPage(1)), new Uint8Array([2, 0]));
	assert.deepEqual(await bytesOf(await archive.readPage(2999)), new Uint8Array([3000 & 255, 3000 >> 8]));
});

test('archive: unicode names and unusual paths', async () => {
	const files: Record<string, Uint8Array> = {
		'Kapitel åäö/Sida 2.jpg': noise(50, 1),
		'Kapitel åäö/Sida 10.jpg': noise(60, 2),
		'日本語/第1話/002.png': noise(70, 3),
		'日本語/第1話/001.png': noise(80, 4)
	};
	const archive = await openArchive(blobOf(zipSync(files)));
	assert.equal(archive.pages.length, 4);
	for (const page of archive.pages) assert.ok(same(await bytesOf(await archive.readPage(page.index)), files[page.name]));
	const names = archive.pages.map((p) => p.name);
	assert.ok(names.indexOf('日本語/第1話/001.png') < names.indexOf('日本語/第1話/002.png'));
	assert.ok(names.indexOf('Kapitel åäö/Sida 2.jpg') < names.indexOf('Kapitel åäö/Sida 10.jpg'));
});

test('archive: readText — basename, case-insensitive, any folder, BOM stripped, utf-8', async () => {
	const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
	const withBom = new Uint8Array([...bom, ...text.encode(COMIC_INFO)]);
	for (const level of [0, 6] as const) {
		const archive = await openArchive(
			blobOf(
				zipSync(
					{
						'__MACOSX/Vol 1/._ComicInfo.xml': text.encode('junk'),
						'Vol 1/comicinfo.XML': withBom,
						'Vol 1/001.jpg': noise(40, 1),
						'notes/Readme.TXT': text.encode('Läs mig')
					},
					{ level }
				)
			)
		);
		const xml = await archive.readText('ComicInfo.xml');
		assert.equal(xml, COMIC_INFO);
		assert.equal(await archive.readText('COMICINFO.XML'), COMIC_INFO);
		assert.equal(await archive.readText('readme.txt'), 'Läs mig');
		assert.equal(await archive.readText('Missing.xml'), undefined);
		assert.equal(await archive.readText('Vol 1'), undefined); // directory entries are not files
		assert.equal(archive.pages.length, 1);
	}
});

test('archive: readText returns undefined for archives without it, empty-file edge', async () => {
	const archive = await openArchive(blobOf(zipSync({ '001.jpg': noise(10, 1), 'ComicInfo.xml': new Uint8Array(0) })));
	assert.equal(await archive.readText('ComicInfo.xml'), '');
	assert.equal(await archive.readText('other.xml'), undefined);
});

// ───────────────────────── format sniffing ─────────────────────────

test('archive: sniffs magic bytes, not the extension', async () => {
	const zip = zipSync({ '001.jpg': noise(30, 1) });
	for (const name of ['a.cbr', 'a.rar', 'a.cbz', 'noext']) {
		const archive = await openArchive(new File([blobOf(zip)], name));
		assert.equal(archive.format, 'zip', name);
		assert.equal(archive.pages.length, 1);
	}
	// empty zip starts with the end-of-directory signature PK\x05\x06
	const empty = zipSync({});
	assert.deepEqual([...empty.subarray(0, 4)], [0x50, 0x4b, 5, 6]);
	assert.deepEqual((await openArchive(blobOf(empty))).pages, []);
});

test('archive: unknown / damaged input', async () => {
	await assert.rejects(openArchive(blobOf(noise(500, 1))), { message: 'Okänt arkivformat' });
	await assert.rejects(openArchive(new Blob([])), { message: 'Okänt arkivformat' });
	await assert.rejects(openArchive(new Blob(['%PDF-1.7 ...'])), { message: 'Okänt arkivformat' });
	await assert.rejects(openArchive(new Blob(['7z\xbc\xaf\x27\x1c'])), { message: 'Okänt arkivformat' });
	// zip magic but no central directory (truncated download)
	const zip = zipSync({ '001.jpg': noise(3000, 1) });
	await assert.rejects(openArchive(blobOf(zip.subarray(0, zip.length - 30))), { message: /^Skadad zip-fil/ });
	await assert.rejects(openArchive(new Blob(['PK\x03\x04 not really a zip'])), { message: /^Skadad zip-fil/ });
});

test('archive: Rar! magic is routed to rar.ts (never treated as zip)', { timeout: 5000 }, async () => {
	const rar = new Blob([new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 1, 2, 3, 4, 5, 6, 7, 8])]);
	const outcome = await openArchive(rar).then(
		() => 'opened',
		(e: Error) => e.message
	);
	assert.doesNotMatch(outcome, /Okänt arkivformat|Skadad zip-fil/);
});

test('archive: close() drops the archive; later reads fail clearly', async () => {
	const archive = await openArchive(blobOf(zipSync({ '001.jpg': noise(30, 1), 'ComicInfo.xml': text.encode('<a/>') })));
	assert.equal((await archive.readPage(0)).size, 30);
	archive.close();
	await assert.rejects(archive.readPage(0), { message: 'Arkivet är stängt' });
	await assert.rejects(archive.readText('ComicInfo.xml'), { message: 'Arkivet är stängt' });
	archive.close(); // idempotent
});

test('archive: readPage rejects for an index that is not a page', async () => {
	const archive = await openArchive(blobOf(zipSync({ '001.jpg': noise(30, 1) })));
	await assert.rejects(archive.readPage(1), RangeError);
	await assert.rejects(archive.readPage(-1), RangeError);
});

// ───────────────────────── (c) random access: how many bytes are touched ─────────────────────────

test('archive: opening a ~50 MB stored CBZ and reading page 0 touches a tiny fraction of it', async () => {
	const MIB = 1 << 20;
	const page = noise(MIB, 7);
	const files: Record<string, Uint8Array> = { 'ComicInfo.xml': text.encode(COMIC_INFO) };
	for (let i = 0; i < 50; i++) files[`page${String(i).padStart(2, '0')}.jpg`] = page;
	const zip = zipSync(files, { level: 0 });
	assert.ok(zip.length > 50 * MIB);

	const counting = new Counting(blobOf(zip));
	const archive = await openArchive(counting as unknown as Blob);
	assert.equal(archive.pages.length, 50);
	const page0 = await archive.readPage(0);
	assert.equal(page0.type, 'image/jpeg');
	assert.equal(page0.size, MIB);
	assert.ok((page0 as unknown) instanceof Counting); // zero-copy: a slice of the source, not a copy
	// 4 magic bytes + archive tail (<= 64 KiB) + central directory + 30-byte local header
	const opened = counting.stats.bytes;
	assert.ok(opened < 70_000, `open + readPage(0) read ${opened} bytes of ${zip.length}`);

	assert.equal(await archive.readText('comicinfo.xml'), COMIC_INFO); // reads only that small entry
	assert.ok(counting.stats.bytes - opened < 500);

	const before = counting.stats.bytes;
	assert.ok(same(await bytesOf(page0), page)); // consuming the page reads exactly that page
	assert.equal(counting.stats.bytes - before, MIB);
	assert.ok(counting.stats.bytes < zip.length / 20, `${counting.stats.bytes} of ${zip.length} bytes read`);
});
