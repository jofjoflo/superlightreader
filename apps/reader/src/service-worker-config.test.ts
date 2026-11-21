import assert from 'node:assert/strict';
import test from 'node:test';
import { offlineFallback, workerAssetsManifest } from './service-worker-config.ts';

test('offline navigation fallback points to the static root document', () => {
	assert.equal(offlineFallback, '/');
});

test('worker asset manifest has a stable build output path', () => {
	assert.equal(workerAssetsManifest, '_app/worker-assets.json');
});
