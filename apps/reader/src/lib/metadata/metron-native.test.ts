import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeMetronResponse } from './metron-native.ts';

test('parseNativeMetronResponse parses the native JSON envelope', () => {
	assert.deepEqual(parseNativeMetronResponse({ data: '{"results":[{"id":1}]}' }), { results: [{ id: 1 }] });
});

test('parseNativeMetronResponse rejects empty or malformed native data', () => {
	assert.throws(() => parseNativeMetronResponse({ data: '' }), /empty response/i);
	assert.throws(() => parseNativeMetronResponse({ data: '{broken' }), SyntaxError);
});
