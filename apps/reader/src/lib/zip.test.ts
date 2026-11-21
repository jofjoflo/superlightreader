import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { deflateSync, unzipSync, zipSync } from 'fflate';
import { openZip } from './zip.ts';

// ───────────────────────── helpers ─────────────────────────

const text = new TextEncoder();
const none = new Uint8Array(0);
const blobOf = (u8: Uint8Array) => new Blob([u8 as Uint8Array<ArrayBuffer>]);
const hex = (n: number) => n.toString(16).padStart(8, '0');
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(b);

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
/** Deterministic, highly compressible bytes. */
const pattern = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i % 251) ^ seed);

const MAX32 = 0xffffffff;
const SIG = { local: 0x04034b50, central: 0x02014b50, eocd: 0x06054b50, eocd64: 0x06064b50, loc64: 0x07064b50 };

function le(n: number, width: 2 | 4 | 8): Uint8Array {
	const out = new Uint8Array(width);
	let v = BigInt(n);
	for (let i = 0; i < width; i++, v >>= 8n) out[i] = Number(v & 0xffn);
	return out;
}
function cat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
/** A well-formed extra field: id, length, payload. */
const field = (id: number, payload: Uint8Array) => cat(le(id, 2), le(payload.length, 2), payload);
/** ZIP64 extended-information extra field holding `values` (each 8 bytes). */
const zip64Field = (values: number[]) => field(1, cat(...values.map((v) => le(v, 8))));

// A tiny ZIP writer for what fflate cannot produce: ZIP64 fields, comments, odd flags, sparse >4 GiB layouts.
interface Spec {
	name: string | Uint8Array; // raw bytes allow non-UTF-8 names
	data: Uint8Array;
	method?: number; // 0 stored (default) | 8 deflate | anything else: data written as-is
	flags?: number;
	/** Put size/csize and/or the offset into a ZIP64 extra field (the 32-bit fields become 0xFFFFFFFF). */
	zip64?: 'all' | 'sizes' | 'offset';
	localExtra?: Uint8Array; // extra bytes in the local header only
	centralExtra?: Uint8Array; // extra fields in front of the ZIP64 field in the central directory
}
interface BuildOptions {
	gap?: number; // virtual bytes before the first local header
	zip64Eocd?: boolean; // ZIP64 EOCD record + locator, 0xFFFF/0xFFFFFFFF in the plain EOCD
	comment?: Uint8Array;
	junk?: Uint8Array; // appended after the EOCD
}
interface Part {
	at: number;
	bytes: Uint8Array;
}
interface Built {
	parts: Part[];
	size: number;
}

function build(specs: Spec[], o: BuildOptions = {}): Built {
	const parts: Part[] = [];
	const central: Uint8Array[] = [];
	let pos = o.gap ?? 0;
	for (const s of specs) {
		const name = typeof s.name === 'string' ? text.encode(s.name) : s.name;
		const method = s.method ?? 0;
		const body = method === 8 ? deflateSync(s.data) : s.data;
		const satSizes = s.zip64 === 'all' || s.zip64 === 'sizes';
		const satOffset = s.zip64 === 'all' || s.zip64 === 'offset';
		assert.ok(satOffset || pos <= MAX32, 'offset beyond 4 GiB needs a ZIP64 field');
		const sizes = [s.data.length, body.length]; // ZIP64 order: size, then csize
		const csize32 = satSizes ? MAX32 : body.length;
		const size32 = satSizes ? MAX32 : s.data.length;

		const localExtra = cat(s.localExtra ?? none, satSizes ? zip64Field(sizes) : none);
		const local = cat(
			...[le(SIG.local, 4), le(satSizes ? 45 : 20, 2), le(s.flags ?? 0, 2), le(method, 2), le(0, 2), le(0x21, 2)],
			...[le(crc32(s.data), 4), le(csize32, 4), le(size32, 4), le(name.length, 2), le(localExtra.length, 2)],
			name,
			localExtra
		);
		const zip64Values = [...(satSizes ? sizes : []), ...(satOffset ? [pos] : [])];
		const centralExtra = cat(s.centralExtra ?? none, s.zip64 ? zip64Field(zip64Values) : none);
		central.push(
			cat(
				...[le(SIG.central, 4), le(45, 2), le(s.zip64 ? 45 : 20, 2), le(s.flags ?? 0, 2), le(method, 2)],
				...[le(0, 2), le(0x21, 2), le(crc32(s.data), 4), le(csize32, 4), le(size32, 4)],
				...[le(name.length, 2), le(centralExtra.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4)],
				le(satOffset ? MAX32 : pos, 4),
				name,
				centralExtra
			)
		);
		parts.push({ at: pos, bytes: local }, { at: pos + local.length, bytes: body });
		pos += local.length + body.length;
	}

	const cd = cat(...central);
	const cdAt = pos;
	parts.push({ at: cdAt, bytes: cd });
	pos += cd.length;
	const comment = o.comment ?? none;
	const n = specs.length;
	let eocd: Uint8Array;
	if (o.zip64Eocd) {
		const rec = cat(
			...[le(SIG.eocd64, 4), le(44, 8), le(45, 2), le(45, 2), le(0, 4), le(0, 4)],
			...[le(n, 8), le(n, 8), le(cd.length, 8), le(cdAt, 8)]
		);
		const loc = cat(le(SIG.loc64, 4), le(0, 4), le(pos, 8), le(1, 4));
		parts.push({ at: pos, bytes: cat(rec, loc) });
		pos += rec.length + loc.length;
		eocd = cat(le(SIG.eocd, 4), le(0, 2), le(0, 2), le(0xffff, 2), le(0xffff, 2), le(MAX32, 4), le(MAX32, 4));
	} else {
		eocd = cat(le(SIG.eocd, 4), le(0, 2), le(0, 2), le(n, 2), le(n, 2), le(cd.length, 4), le(cdAt, 4));
	}
	eocd = cat(eocd, le(comment.length, 2), comment);
	parts.push({ at: pos, bytes: eocd });
	pos += eocd.length;
	if (o.junk) {
		parts.push({ at: pos, bytes: o.junk });
		pos += o.junk.length;
	}
	return { parts, size: pos };
}

const flatten = ({ parts, size }: Built): Uint8Array => {
	const out = new Uint8Array(size);
	for (const p of parts) out.set(p.bytes, p.at);
	return out;
};
const zipBlob = (specs: Spec[], o?: BuildOptions) => blobOf(flatten(build(specs, o)));

/** The slice of the Blob API that zip.ts relies on. */
interface BlobLike {
	size: number;
	type: string;
	slice(start?: number, end?: number, type?: string): BlobLike;
	arrayBuffer(): Promise<ArrayBuffer>;
}
const asBlob = (b: BlobLike) => b as unknown as Blob;

/** Stand-in for a huge, mostly empty file: only `parts` hold data, everything else reads as zeros. */
class Sparse implements BlobLike {
	parts: Part[];
	start: number;
	end: number;
	type: string;
	constructor(parts: Part[], start: number, end: number, type = '') {
		this.parts = parts;
		this.start = start;
		this.end = end;
		this.type = type;
	}
	get size() {
		return this.end - this.start;
	}
	slice(start = 0, end = this.size, type = '') {
		const clamp = (v: number) => Math.min(Math.max(v, 0), this.size);
		const from = clamp(start);
		return new Sparse(this.parts, this.start + from, this.start + Math.max(from, clamp(end)), type);
	}
	async arrayBuffer() {
		assert.ok(this.size <= 1e8, 'refusing to materialise a huge slice');
		const out = new Uint8Array(this.size);
		for (const p of this.parts) {
			const from = Math.max(p.at, this.start);
			const to = Math.min(p.at + p.bytes.length, this.end);
			if (from < to) out.set(p.bytes.subarray(from - p.at, to - p.at), from - this.start);
		}
		return out.buffer;
	}
}

/** Wraps a Blob and counts the bytes actually read through arrayBuffer(); slices share the counter. */
class Counting implements BlobLike {
	inner: Blob;
	stats: { bytes: number; reads: number };
	constructor(inner: Blob, stats = { bytes: 0, reads: 0 }) {
		this.inner = inner;
		this.stats = stats;
	}
	get size() {
		return this.inner.size;
	}
	get type() {
		return this.inner.type;
	}
	slice(start?: number, end?: number, type?: string) {
		return new Counting(this.inner.slice(start, end, type), this.stats);
	}
	async arrayBuffer() {
		this.stats.bytes += this.inner.size;
		this.stats.reads++;
		return this.inner.arrayBuffer();
	}
}

// ───────────────────────── (a) real fixtures, cross-checked against Python's zipfile ─────────────────────────

const FIXTURE_DIR = new URL('../../../tools/converter/', import.meta.url);
/** name size csize crc32 — as printed by Python's zipfile (ZipInfo.file_size / compress_size / CRC). */
const FIXTURES: Record<string, string> = {
	'demo_comic.cbz': `
		001.avif 2303 2197 cd21f7b3
		002.avif 2303 2197 cd21f7b3
		003.avif 2316 2214 af7896b3
		004.avif 2316 2214 af7896b3
		005.avif 2704 2602 a4828ea9
		006.avif 2704 2602 a4828ea9
		007.avif 3101 2999 e5fa29ef
		008.avif 3101 2999 e5fa29ef
		009.avif 2323 2217 8ecfc3f7
		010.avif 2323 2217 8ecfc3f7`,
	'test_avif_comic.cbz': `
		001.avif 2644 2587 27916887
		002.avif 2341 2288 82c4e25b
		003.avif 2968 2911 594b2e27
		004.avif 3301 3248 903ef38d
		005.avif 2518 2465 c97c4b96`,
	'test_jpg_comic.cbz': `
		001_page.jpg 16830 9462 8216d6dd
		002_page.jpg 16817 9463 81c18a77
		003_page.jpg 17589 10224 40b964cf
		004_page.jpg 18623 11278 2d5e03f5
		005_page.jpg 17703 10365 e8895d3a`,
	'from_directory.cbz': `
		001.avif 361 282 3e3965a4
		002.avif 362 284 301feeba
		003.avif 360 282 b10cc34a`
};

for (const [file, table] of Object.entries(FIXTURES)) {
	test(`zip: fixture ${file} matches Python zipfile`, async () => {
		const rows = table
			.trim()
			.split('\n')
			.map((line) => line.trim().split(/\s+/));
		const file$ = await openAsBlob(new URL(file, FIXTURE_DIR)); // disk-backed, lazily read
		const zip = await openZip(file$);
		assert.deepEqual(
			zip.entries.map((e) => [e.name, e.size, e.csize]),
			rows.map(([name, size, csize]) => [name, Number(size), Number(csize)])
		);
		assert.ok(zip.entries.every((e) => e.method === 8 && e.flags === 0 && !e.isDir));

		const reference = unzipSync(new Uint8Array(await file$.arrayBuffer())); // independent whole-file inflate
		for (let i = 0; i < rows.length; i++) {
			const e = zip.entries[i];
			const data = await zip.read(e);
			assert.equal(data.length, e.size);
			assert.equal(hex(crc32(data)), rows[i][3]);
			assert.ok(same(data, reference[e.name]));
			const b = await zip.blob(e, 'image/avif');
			assert.equal(b.type, 'image/avif');
			assert.equal(b.size, e.size);
			assert.ok(same(new Uint8Array(await b.arrayBuffer()), data));
		}
	});
}

// ───────────────────────── (b) synthetic archives ─────────────────────────

test('zip: fflate archives, stored and deflated, nested folders + unicode names', async () => {
	const files = {
		'cover.jpg': pattern(4000, 1),
		'Kapitel 1': { '001.jpg': noise(3000, 2), '002.jpg': pattern(2500, 3) },
		'Kapitel åäö/Sida 01 – ☃ 😀.png': pattern(1000, 4),
		'empty.txt': new Uint8Array(0)
	};
	const original = new Map([
		['cover.jpg', files['cover.jpg']],
		['Kapitel 1/001.jpg', files['Kapitel 1']['001.jpg']],
		['Kapitel 1/002.jpg', files['Kapitel 1']['002.jpg']],
		['Kapitel åäö/Sida 01 – ☃ 😀.png', files['Kapitel åäö/Sida 01 – ☃ 😀.png']],
		['empty.txt', files['empty.txt']]
	]);
	for (const level of [0, 6] as const) {
		const zip = await openZip(blobOf(zipSync(files, { level })));
		assert.deepEqual(zip.entries.map((e) => e.name).sort(), [...original.keys(), 'Kapitel 1/'].sort());
		for (const e of zip.entries) {
			assert.equal(e.isDir, e.name === 'Kapitel 1/');
			assert.equal(e.method, level === 0 ? 0 : 8);
			const data = await zip.read(e);
			assert.ok(same(data, original.get(e.name) ?? none), e.name);
			assert.equal(e.size, data.length);
			const blob = await zip.blob(e, 'image/x-test');
			assert.equal(blob.type, 'image/x-test');
			assert.ok(same(new Uint8Array(await blob.arrayBuffer()), data), e.name);
		}
		const uni = zip.entries.find((e) => e.name.startsWith('Kapitel å'));
		assert.equal((uni?.flags ?? 0) & 0x800, 0x800); // fflate flags non-ASCII names as UTF-8
		if (level === 6) assert.ok(zip.entries.some((e) => e.csize < e.size)); // really deflated
	}
});

test('zip: concurrent reads', async () => {
	const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}.bin`, noise(500 + i * 37, i)]));
	const zip = await openZip(blobOf(zipSync(files, { level: 1 })));
	const all = await Promise.all(zip.entries.map((e) => zip.read(e)));
	zip.entries.forEach((e, i) => assert.ok(same(all[i], files[e.name]), e.name));
});

test('zip: empty archive (EOCD only)', async () => {
	assert.deepEqual((await openZip(zipBlob([]))).entries, []);
});

test('zip: archive comments (max length, fake EOCD signature inside) and trailing junk', async () => {
	const specs: Spec[] = [
		{ name: 'a.jpg', data: pattern(800, 1), method: 8 },
		{ name: 'b.jpg', data: noise(300, 2) }
	];
	const check = async (blob: Blob) => {
		const zip = await openZip(blob);
		assert.deepEqual(
			zip.entries.map((e) => e.name),
			['a.jpg', 'b.jpg']
		);
		assert.ok(same(await zip.read(zip.entries[0]), specs[0].data));
		assert.ok(same(await zip.read(zip.entries[1]), specs[1].data));
	};
	await check(zipBlob(specs, { comment: new Uint8Array(0xffff).fill(0x41) })); // longest possible comment
	await check(zipBlob(specs, { comment: text.encode('x'.repeat(100) + 'PK\x05\x06' + 'y'.repeat(30)) }));
	await check(zipBlob(specs, { comment: text.encode('Skapad med ❤ i Göteborg') }));
	await check(zipBlob(specs, { junk: text.encode('trailing junk') })); // some writers pad the file
	await check(zipBlob(specs, { comment: text.encode('hej'), junk: new Uint8Array(500) }));
});

test('zip: not a zip / truncated / damaged archives reject with a clear message', async () => {
	const good = flatten(build([{ name: 'a.jpg', data: pattern(2000, 1), method: 8 }, { name: 'b.jpg', data: noise(50, 2) }]));
	const skadad = { message: /^Skadad zip-fil/ };
	await assert.rejects(openZip(blobOf(noise(5000, 1))), skadad);
	await assert.rejects(openZip(blobOf(new Uint8Array(0))), skadad);
	await assert.rejects(openZip(blobOf(good.subarray(0, 21))), skadad);
	await assert.rejects(openZip(blobOf(good.subarray(0, good.length - 5))), skadad); // incomplete download
	await assert.rejects(openZip(blobOf(good.subarray(100))), skadad); // central directory ends beyond EOF
	const brokenCd = good.slice();
	const cdAt = new DataView(brokenCd.buffer).getUint32(brokenCd.length - 6, true);
	brokenCd[cdAt] ^= 0xff;
	await assert.rejects(openZip(blobOf(brokenCd)), skadad);
});

test('zip: encrypted entries are rejected on open', async () => {
	await assert.rejects(openZip(zipBlob([{ name: 'a.jpg', data: noise(10, 1), flags: 0x1 }])), {
		message: 'Krypterad arkiv stöds inte'
	});
});

test('zip: unsupported compression method fails on read, not on open', async () => {
	const zip = await openZip(zipBlob([{ name: 'a.jpg', data: noise(10, 1), method: 12 }]));
	assert.equal(zip.entries[0].method, 12);
	await assert.rejects(zip.read(zip.entries[0]), /Komprimeringsmetod 12/);
	await assert.rejects(zip.blob(zip.entries[0]), /Komprimeringsmetod 12/);
});

test('zip: damaged local header / truncated data fail on read', async () => {
	const specs: Spec[] = [{ name: 'a.jpg', data: pattern(3000, 1), method: 8 }];
	const bytes = flatten(build(specs));
	const zip = await openZip(blobOf(bytes));
	const badLocal = bytes.slice();
	badLocal[0] ^= 0xff; // local signature of entry 0
	const zip2 = await openZip(blobOf(badLocal));
	await assert.rejects(zip2.read(zip2.entries[0]), /ogiltig lokal header/);
	assert.equal((await zip.read(zip.entries[0])).length, 3000); // untouched archive still fine

	// claim a larger compressed size than the file holds
	const lying = zip.entries[0];
	await assert.rejects(zip.read({ ...lying, csize: bytes.length }), /avkortad/);
	// declared size does not match what the stream inflates to
	await assert.rejects(zip.read({ ...lying, size: lying.size + 1 }), /kunde inte packa upp/);
	// compressed data cut short
	await assert.rejects(zip.read({ ...lying, csize: 20 }), /kunde inte packa upp/);
	// noise instead of a deflate stream
	const raw = await openZip(zipBlob([{ name: 'g.jpg', data: noise(400, 1), method: 12 }]));
	await assert.rejects(raw.read({ ...raw.entries[0], method: 8 }), /kunde inte packa upp/);
});

test('zip: data start comes from the local header (its extra field may differ from the central one)', async () => {
	const specs: Spec[] = [
		{ name: 'a.jpg', data: noise(1500, 1), localExtra: field(0x7875, noise(33, 9)), centralExtra: field(0x5455, noise(1, 7)) },
		{ name: 'b.jpg', data: pattern(2500, 2), method: 8, localExtra: field(0xcafe, noise(7, 8)) },
		{ name: 'c.jpg', data: noise(900, 3), centralExtra: field(0xeeee, noise(56, 7)) }
	];
	const zip = await openZip(zipBlob(specs));
	for (let i = 0; i < specs.length; i++) {
		assert.ok(same(await zip.read(zip.entries[i]), specs[i].data), specs[i].name as string);
		const blob = await zip.blob(zip.entries[i]);
		assert.ok(same(new Uint8Array(await blob.arrayBuffer()), specs[i].data));
	}
});

test('zip: file names — UTF-8 without flag, legacy windows-1252, backslash separators', async () => {
	const d = noise(20, 1);
	const zip = await openZip(
		zipBlob([
			{ name: 'Sida åäö.jpg', data: d }, // UTF-8, flag 11 not set
			{ name: 'Sida åäö (flag).jpg', data: d, flags: 0x800 },
			{ name: new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x6a, 0x70, 0x67]), data: d }, // "café.jpg" in windows-1252
			{ name: 'Kapitel 2\\001.jpg', data: d }, // PowerShell 5.1 Compress-Archive style
			{ name: 'Kapitel 3\\', data: none }
		])
	);
	assert.deepEqual(
		zip.entries.map((e) => [e.name, e.isDir]),
		[
			['Sida åäö.jpg', false],
			['Sida åäö (flag).jpg', false],
			['café.jpg', false],
			['Kapitel 2/001.jpg', false],
			['Kapitel 3/', true]
		]
	);
});

// ───────────────────────── (c) random access: how many bytes are touched ─────────────────────────

const TAIL = 22 + 0xffff + 20; // the most open() ever reads from the end of a file

test('zip: deflated entry read touches only the tail, the central directory and that entry', async () => {
	const specs: Spec[] = Array.from({ length: 24 }, (_, i) => ({
		name: `page${String(i).padStart(3, '0')}.jpg`,
		data: noise(100_000, i + 1),
		method: 8
	}));
	const built = flatten(build(specs));
	const counting = new Counting(blobOf(built));
	const zip = await openZip(asBlob(counting));
	const opened = counting.stats.bytes;
	assert.ok(opened <= TAIL + 24 * 100, `open read ${opened} bytes`); // tail + central directory (~60 B per entry)
	const e = zip.entries[17];
	assert.ok(same(await zip.read(e), specs[17].data));
	assert.equal(counting.stats.bytes - opened, 30 + e.csize); // local header + exactly this entry's data
	assert.ok(counting.stats.bytes < built.length / 8);
});

test('zip: stored entries are returned as a zero-copy slice (no bytes read until consumed)', async () => {
	const specs: Spec[] = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}.png`, data: noise(50_000, i + 1) }));
	const counting = new Counting(blobOf(flatten(build(specs))));
	const zip = await openZip(asBlob(counting));
	const before = counting.stats.bytes;
	const blob = await zip.blob(zip.entries[3], 'image/png');
	assert.equal(counting.stats.bytes - before, 30); // just the local header
	assert.ok((blob as unknown) instanceof Counting); // a slice of the source, not a copy
	assert.equal(blob.size, 50_000);
	assert.equal(blob.type, 'image/png');
	assert.ok(same(new Uint8Array(await blob.arrayBuffer()), specs[3].data));
});

// ───────────────────────── (d) ZIP64 ─────────────────────────

test('zip: ZIP64 EOCD + extra fields (all combinations of saturated values)', async () => {
	const specs: Spec[] = [
		{ name: 'a.jpg', data: noise(700, 1), zip64: 'all' },
		{
			name: 'b.jpg',
			data: pattern(3000, 2),
			method: 8,
			zip64: 'all',
			centralExtra: cat(field(0x5455, noise(9, 5)), field(0x7875, noise(11, 6))), // skipped before the ZIP64 field
			localExtra: field(0x5455, noise(5, 4))
		},
		{ name: 'c.jpg', data: noise(400, 3), zip64: 'sizes' }, // offset still fits in 32 bits
		{ name: 'd.jpg', data: pattern(900, 4), method: 8, zip64: 'sizes' },
		{ name: 'e.jpg', data: noise(300, 5), zip64: 'offset' }, // only the offset is in the ZIP64 field
		{ name: 'f.jpg', data: noise(200, 6) }, // plain entry inside a ZIP64 archive
		{ name: 'g.jpg', data: pattern(500, 7), method: 8, zip64: 'offset' }
	];
	const built = build(specs, { zip64Eocd: true, comment: text.encode('zip64') });
	const zip = await openZip(blobOf(flatten(built)));
	assert.deepEqual(
		zip.entries.map((e) => e.name),
		specs.map((s) => s.name)
	);
	for (let i = 0; i < specs.length; i++) {
		const e = zip.entries[i];
		assert.equal(e.size, specs[i].data.length, e.name);
		assert.equal(e.method, specs[i].method ?? 0);
		assert.ok(same(await zip.read(e), specs[i].data), e.name);
	}
	// offsets decoded from the ZIP64 fields equal where the writer really put the local headers
	assert.deepEqual(
		zip.entries.map((e) => e.offset),
		specs.map((_, i) => built.parts[2 * i].at)
	);
	// the same archive without the ZIP64 EOCD but with per-entry fields also works
	const zip2 = await openZip(zipBlob(specs));
	assert.deepEqual(
		zip2.entries.map((e) => [e.size, e.csize, e.offset]),
		zip.entries.map((e) => [e.size, e.csize, e.offset])
	);
});

test('zip: ZIP64 EOCD record on a plain archive (writers that always emit it)', async () => {
	const specs: Spec[] = [{ name: 'a.jpg', data: noise(100, 1) }, { name: 'b.jpg', data: pattern(100, 2), method: 8 }];
	const zip = await openZip(zipBlob(specs, { zip64Eocd: true }));
	assert.equal(zip.entries.length, 2);
	assert.ok(same(await zip.read(zip.entries[1]), specs[1].data));
});

test('zip: ZIP64 archive whose entries and central directory live beyond 4 GiB', async () => {
	const gap = 5_000_000_000;
	const specs: Spec[] = [
		{ name: '001.jpg', data: noise(3000, 1), zip64: 'all' },
		{ name: '002.jpg', data: pattern(5000, 2), method: 8, zip64: 'all' },
		{ name: '003.jpg', data: noise(1000, 3), zip64: 'offset' },
		{ name: '004.jpg', data: pattern(700, 4), method: 8, zip64: 'offset' }
	];
	const built = build(specs, { gap, zip64Eocd: true, comment: text.encode('big') });
	assert.ok(built.size > 2 ** 32);
	const zip = await openZip(asBlob(new Sparse(built.parts, 0, built.size)));
	assert.equal(zip.entries.length, 4);
	for (let i = 0; i < specs.length; i++) {
		const e = zip.entries[i];
		assert.equal(e.offset, built.parts[2 * i].at, e.name);
		assert.ok(e.offset >= gap);
		assert.equal(e.size, specs[i].data.length);
		assert.ok(same(await zip.read(e), specs[i].data), e.name);
		if (e.method === 0) {
			const blob = await zip.blob(e, 'image/jpeg'); // zero-copy slice at an offset > 2^32
			assert.equal(blob.type, 'image/jpeg');
			assert.equal(blob.size, e.size);
			assert.ok(same(new Uint8Array(await blob.arrayBuffer()), specs[i].data));
		}
	}
});
