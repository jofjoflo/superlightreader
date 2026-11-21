import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectWorkerAssetsFromDirectory } from './precache-workers.ts';

test('collectWorkerAssetsFromDirectory lists nested hashed worker outputs', () => {
	const output = mkdtempSync(path.join(tmpdir(), 'superlight-workers-'));
	const workers = path.join(output, '_app/immutable/workers');
	try {
		mkdirSync(path.join(workers, 'chunks'), { recursive: true });
		writeFileSync(path.join(workers, 'convert.worker-abc.js'), '');
		writeFileSync(path.join(workers, 'chunks', 'encoder-def.js'), '');
		assert.deepEqual(collectWorkerAssetsFromDirectory(output), [
			'_app/immutable/workers/chunks/encoder-def.js',
			'_app/immutable/workers/convert.worker-abc.js'
		]);
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
});

test('collectWorkerAssetsFromDirectory returns no entries when workers are absent', () => {
	const output = mkdtempSync(path.join(tmpdir(), 'superlight-workers-'));
	try {
		assert.deepEqual(collectWorkerAssetsFromDirectory(output), []);
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
});
