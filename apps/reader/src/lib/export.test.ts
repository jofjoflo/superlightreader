import assert from 'node:assert/strict';
import test from 'node:test';
import { saveBlob, saveNativeBlob, saveObjectUrl, type NativeFileExportPlugin } from './export.ts';

test('browser blob export starts a download with a sanitized name', async () => {
	const previous = globalThis.document;
	let clicked = false;
	const anchor = {
		href: '', download: '', rel: '', style: { display: '' },
		click() { clicked = true; }, remove() {}
	};
	globalThis.document = {
		createElement: () => anchor,
		body: { appendChild() {} }
	} as unknown as Document;
	try {
		const result = await saveBlob(new Blob(['{}'], { type: 'application/json' }), { fileName: '../backup.json' });
		assert.equal(result.platform, 'browser');
		assert.equal(result.fileName, '.._backup.json');
		assert.equal(anchor.download, '.._backup.json');
		assert.equal(clicked, true);
	} finally {
		globalThis.document = previous;
	}
});

test('object URL export preserves URL in browser mode', async () => {
	const previous = globalThis.document;
	let clicked = false;
	const anchor = {
		href: '', download: '', rel: '',
		click() { clicked = true; }, remove() {}
	};
	globalThis.document = { createElement: () => anchor } as unknown as Document;
	try {
		const result = await saveObjectUrl('blob:test', { fileName: 'converted.cbz' });
		assert.equal(result.platform, 'browser');
		assert.equal(anchor.href, 'blob:test');
		assert.equal(clicked, true);
	} finally {
		globalThis.document = previous;
	}
});

test('export rejects empty file names', async () => {
	await assert.rejects(saveBlob(new Blob(['x']), { fileName: '   ' }), /giltigt filnamn/);
});

test('native export sends bounded base64 chunks and reconstructs the file', async () => {
	const input = new Uint8Array(600_000);
	for (let i = 0; i < input.length; i++) input[i] = i % 251;
	const writes: string[] = [];
	let started: { fileName: string; mimeType: string; size: number } | undefined;
	let finished = false;
	const plugin: NativeFileExportPlugin = {
		async start(options) { started = options; },
		async write(options) { writes.push(options.data); },
		async finish() { finished = true; return { saved: true }; },
		async abort() { throw new Error('abort should not be called'); }
	};
	const result = await saveNativeBlob(new Blob([input], { type: 'application/zip' }), { fileName: 'out.cbz' }, plugin);
	assert.deepEqual(started, { fileName: 'out.cbz', mimeType: 'application/zip', size: input.byteLength });
	assert.equal(writes.length, 3);
	assert.equal(finished, true);
	assert.deepEqual(Buffer.concat(writes.map((chunk) => Buffer.from(chunk, 'base64'))), Buffer.from(input));
	assert.equal(result.platform, 'native');
});

test('native export aborts an incomplete stream and reports the cause', async () => {
	let aborted = false;
	const plugin: NativeFileExportPlugin = {
		async start() {},
		async write() { throw new Error('disk full'); },
		async finish() { return { saved: true }; },
		async abort() { aborted = true; }
	};
	await assert.rejects(saveNativeBlob(new Blob(['x']), { fileName: 'out.cbz' }, plugin), /disk full/);
	assert.equal(aborted, true);
});
