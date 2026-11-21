import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { inputsFromDrop, inputsFromFiles } from './pick.ts';

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
