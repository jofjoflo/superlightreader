import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DEFAULT_CONVERT_OPTIONS,
	avifPageName,
	canEncodeAvif,
	conversionAbortError,
	conversionErrorMessage,
	normaliseConvertOptions
} from './convert.ts';

test('convert: defaults are bounded and suitable for reading', () => {
	assert.deepEqual(normaliseConvertOptions(), { quality: 45, maxWidth: 1600, lossless: false });
	assert.deepEqual(DEFAULT_CONVERT_OPTIONS, { quality: 45, maxWidth: 1600 });
});

test('convert: quality and width are rounded and validated', () => {
	assert.deepEqual(normaliseConvertOptions({ quality: 50.4, maxWidth: 1200.7, lossless: true }), {
		quality: 50,
		maxWidth: 1201,
		lossless: true
	});
	assert.deepEqual(normaliseConvertOptions({ maxWidth: 0 }).maxWidth, undefined);
	assert.throws(() => normaliseConvertOptions({ quality: -1 }), RangeError);
	assert.throws(() => normaliseConvertOptions({ quality: 101 }), RangeError);
	assert.throws(() => normaliseConvertOptions({ maxWidth: Infinity }), RangeError);
});

test('convert: output names preserve folders but prevent traversal and collisions', () => {
	const used = new Set<string>();
	assert.equal(avifPageName('../pages\\001.JPG', used), 'pages/001.avif');
	assert.equal(avifPageName('pages/001.png', used), 'pages/001-2.avif');
	assert.equal(avifPageName('..', used), 'page.avif');
});

test('convert: abort error has AbortError semantics', () => {
	const error = conversionAbortError();
	assert.equal(error.name, 'AbortError');
});

test('convert: nested worker/WASM errors remain visible to the caller', () => {
	const wasm = new Error('failed to load wasm binary');
	const worker = new Error('AVIF-worker misslyckades', { cause: wasm });
	assert.equal(conversionErrorMessage(worker), 'AVIF-worker misslyckades: failed to load wasm binary');
	assert.equal(conversionErrorMessage('ImageDecoder failed'), 'ImageDecoder failed');
});

test('convert: encoder detection is safe outside a browser', async () => {
	assert.equal(await canEncodeAvif(), false);
});

