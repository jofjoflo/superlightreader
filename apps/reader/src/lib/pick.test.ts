import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { inputsFromDrop, inputsFromFiles } from './pick.ts';
import { NativePickedFileHandle } from './pick-native.ts';

const fakeFile = (name: string, webkitRelativePath = '') => ({ name, size: 1, webkitRelativePath }) as unknown as File;

test('inputsFromFiles keeps only comic files, case-insensitively', () => {
	const names = ['a.cbz', 'B.CBR', 'c.Zip', 'd.rar', 'e.pdf', 'f.cbz.txt', 'cbz', 'g.jpg', 'notes.nfo'];
	const out = inputsFromFiles(names.map((n) => fakeFile(n)));
	assert.deepEqual(
		out.map((i) => i.path),
		['a.cbz', 'B.CBR', 'c.Zip', 'd.rar']
	);
});

test('inputsFromFiles uses webkitRelativePath when set, else the file name', () => {
	const nested = fakeFile('X-Men 001.cbz', 'Serier/Marvel/X-Men 001.cbz');
	const flat = fakeFile('Saga 001.cbr');
	const out = inputsFromFiles([nested, flat]);
	assert.deepEqual(
		out.map((i) => i.path),
		['Serier/Marvel/X-Men 001.cbz', 'Saga 001.cbr']
	);
	assert.equal(out[0].file, nested);
	assert.equal(out[1].file, flat);
});

test('inputsFromFiles on an empty list', () => {
	assert.deepEqual(inputsFromFiles([]), []);
});

test('native picked file reads only requested ranges and clamps slices', async () => {
	const source = new TextEncoder().encode('0123456789');
	const reads: [number, number][] = [];
	const file = new NativePickedFileHandle(
		{ name: 'a.cbz', path: 'Serier/a.cbz', size: source.length, lastModified: 0, uri: 'content://a' },
		async (offset, length) => {
			reads.push([offset, length]);
			return source.slice(offset, offset + length);
		}
	);
	const bytes = await file.slice(-4, 999).arrayBuffer();
	assert.equal(new TextDecoder().decode(bytes), '6789');
	assert.deepEqual(reads, [[6, 4]]);
});

test('native picked file chunks large slices instead of requesting an oversized bridge message', async () => {
	const source = new Uint8Array(2 * 1024 * 1024);
	for (let i = 0; i < source.length; i++) source[i] = i & 255;
	const requests: number[] = [];
	const file = new NativePickedFileHandle(
		{ name: 'large.cbz', path: 'large.cbz', size: source.length, lastModified: 0, uri: 'content://large' },
		async (offset, length) => {
			requests.push(length);
			return source.slice(offset, offset + length);
		}
	);
	const result = new Uint8Array(await file.slice(0, source.length).arrayBuffer());
	assert.deepEqual(result, source);
	assert.equal(requests.length, 8);
	assert.ok(requests.every((length) => length <= 256 * 1024));
});

// ── drag & drop: fake FileSystemEntry trees ──

const fileEntry = (path: string, fails = false) => {
	const file = fakeFile(path.split('/').pop()!);
	return {
		isFile: true,
		isDirectory: false,
		name: file.name,
		fullPath: '/' + path,
		file: (ok: (f: File) => void, fail: (e: Error) => void) => (fails ? fail(new Error('unreadable')) : ok(file)),
		fakeFile: file
	};
};

/** Directory whose reader hands out `children` `batch` entries at a time, then an empty batch. */
const dirEntry = (path: string, children: object[], batch = 2) => ({
	isFile: false,
	isDirectory: true,
	name: path.split('/').pop()!,
	fullPath: '/' + path,
	createReader() {
		let next = 0;
		return {
			readEntries(ok: (entries: object[]) => void) {
				ok(children.slice(next, next + batch));
				next += batch;
			}
		};
	}
});

const dropOf = (...entries: object[]) =>
	({ items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })), files: [] }) as unknown as DataTransfer;

test('inputsFromDrop walks directories recursively, reading every batch', async () => {
	const first = fileEntry('Serier/Marvel/X-Men 001.cbz');
	const tree = dirEntry('Serier', [
		dirEntry('Serier/Marvel', [
			first,
			fileEntry('Serier/Marvel/X-Men 002.cbz'),
			fileEntry('Serier/Marvel/cover.jpg'),
			fileEntry('Serier/Marvel/notes.txt'),
			fileEntry('Serier/Marvel/X-Men 003.CBR')
		]),
		fileEntry('Serier/Saga 001.zip'),
		dirEntry('Serier/Tom', [])
	]);
	const out = await inputsFromDrop(dropOf(tree));
	assert.deepEqual(
		out.map((i) => i.path),
		['Serier/Marvel/X-Men 001.cbz', 'Serier/Marvel/X-Men 002.cbz', 'Serier/Marvel/X-Men 003.CBR', 'Serier/Saga 001.zip']
	);
	assert.equal(out[0].file, first.fakeFile);
});

test('inputsFromDrop gives a dropped file its bare name and handles several roots', async () => {
	const manga = dirEntry('Manga', [fileEntry('Manga/Akira 01.cbr')]);
	const out = await inputsFromDrop(dropOf(fileEntry('Saga 001.cbz'), manga, fileEntry('readme.txt')));
	assert.deepEqual(
		out.map((i) => i.path),
		['Saga 001.cbz', 'Manga/Akira 01.cbr']
	);
});

test('inputsFromDrop skips unreadable files and keeps the rest', async () => {
	const warn = mock.method(console, 'warn', () => {});
	try {
		const out = await inputsFromDrop(dropOf(dirEntry('D', [fileEntry('D/a.cbz', true), fileEntry('D/b.cbz')])));
		assert.deepEqual(
			out.map((i) => i.path),
			['D/b.cbz']
		);
		assert.equal(warn.mock.callCount(), 1);
	} finally {
		warn.mock.restore();
	}
});

test('inputsFromDrop falls back to dt.files without the entries API', async () => {
	const dt = {
		items: [{ kind: 'file' }, { kind: 'file' }, { kind: 'string' }],
		files: [fakeFile('a.cbz'), fakeFile('b.txt'), fakeFile('c.RAR', 'Root/c.RAR')]
	} as unknown as DataTransfer;
	const out = await inputsFromDrop(dt);
	assert.deepEqual(
		out.map((i) => i.path),
		['a.cbz', 'Root/c.RAR']
	);
});
