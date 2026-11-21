import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildRar } from './__fixtures__/rar-writer.ts';
import { openRar } from './rar.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const open = (rar: Uint8Array) => openRar(new Blob([rar as BlobPart]));

const entries = [
	{ name: 'c/p10.jpg', data: bytes('ten') },
	{ name: 'c/p2.JPG', data: bytes('two') },
	{ name: 'c', dir: true },
	{ name: 'c/p1.png', data: bytes('one') },
	{ name: '__MACOSX/c/._p1.png', data: bytes('junk') },
	{ name: 'c/notes.txt', data: bytes('not a page') },
	{ name: 'c/Meta/ComicInfo.XML', data: new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('<ComicInfo/>')]) },
	{ name: 'c/sub/p3.webp', data: bytes('three') }
];

for (const solid of [false, true]) {
	test(`lists, natural-sorts and reads pages (solid=${solid})`, async () => {
		const a = await open(buildRar(entries, { solid }));
		assert.equal(a.format, 'rar');
		assert.deepEqual(
			a.pages.map((p) => [p.index, p.name, p.size, p.mime]),
			[
				[0, 'c/p1.png', 3, 'image/png'],
				[1, 'c/p2.JPG', 3, 'image/jpeg'],
				[2, 'c/p10.jpg', 3, 'image/jpeg'],
				[3, 'c/sub/p3.webp', 5, 'image/webp']
			]
		);
		for (const i of [3, 0, 2, 1]) {
			// out of order: later pages must still be reachable after skipping/reading others
			const blob = await a.readPage(i);
			assert.equal(blob.type, a.pages[i].mime);
			assert.equal(await blob.text(), ['one', 'two', 'ten', 'three'][i]);
		}
		assert.equal(await a.readText('comicinfo.xml'), '<ComicInfo/>'); // basename, case-insensitive, BOM stripped
		assert.equal(await a.readText('missing.xml'), undefined);
		await assert.rejects(a.readPage(9), RangeError);
		a.close();
		await assert.rejects(a.readPage(0), /stängt/);
	});
}

// testFiles/FolderTest.rar from YuJianrong/node-unrar.js (MIT): real compressed data + unicode names, no images.
test('real compressed RAR', async () => {
	const a = await open(await readFile(new URL('./__fixtures__/folder-test.rar', import.meta.url)));
	assert.equal(a.pages.length, 0);
	assert.equal((await a.readText('LONG.TXT'))?.length, 1049076);
	assert.equal(await a.readText('2中文.txt'), '中文中文');
});

test('operations on different open archives can interleave', async () => {
	const [a, b] = await Promise.all([
		open(buildRar([{ name: 'a1.jpg', data: bytes('A1') }, { name: 'a2.jpg', data: bytes('A2') }])),
		open(buildRar([{ name: 'b1.jpg', data: bytes('B1') }, { name: 'b2.jpg', data: bytes('B2') }]))
	]);
	const blobs = await Promise.all([a.readPage(0), b.readPage(0), a.readPage(1), b.readPage(1)]);
	assert.deepEqual(await Promise.all(blobs.map((x) => x.text())), ['A1', 'B1', 'A2', 'B2']);
});

test('garbage and password-protected archives fail with a Swedish message', async () => {
	await assert.rejects(open(new Uint8Array(64)), /skadad/);
	await assert.rejects(open(buildRar([{ name: 'a.jpg', data: bytes('xx'), encrypted: true }])), /lösenordsskyddad/);
});
