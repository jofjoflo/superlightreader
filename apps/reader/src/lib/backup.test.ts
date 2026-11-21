import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBackup } from './backup.ts';

const settings = {
	persistFiles: true,
	autoMetadata: false,
	cardSize: 170,
	reader: { fit: 'screen', spread: 'auto', direction: 'auto', background: '#000000', tapZones: true, keepAwake: true, preload: 2 }
} as const;
const issue = { id: 'issue-1', fileName: 'Saga 001.cbz', relPath: 'Saga 001.cbz', size: 1, lastModified: 1, addedAt: 1, format: 'cbz', seriesId: 'saga', seriesName: 'Saga', pageCount: 10, coverIndex: 0, hasCover: true, persisted: true };

function backup(overrides: Record<string, unknown> = {}) {
	return {
		format: 'superlight-reader-backup', version: 1, exportedAt: new Date().toISOString(),
		issues: [issue], progress: [{ issueId: 'issue-1', page: 2, pageCount: 10, completed: false, updatedAt: 1 }],
		seriesMeta: [{ seriesId: 'saga', description: 'Line one\nLine two', source: 'user' }], seriesUser: [], settings, readingOrders: [], ...overrides
	};
}

test('backup validation is round-trip safe and clears persisted linkage', () => {
	const result = parseBackup(JSON.stringify(backup()));
	assert.equal(result.errors.length, 0);
	assert.equal(result.backup?.issues[0].id, 'issue-1');
	assert.equal(result.backup?.issues[0].persisted, false);
	assert.equal(result.backup?.seriesMeta[0].description, 'Line one\nLine two');
});

test('backup validation rejects duplicate IDs and orphan progress atomically', () => {
	assert.match(parseBackup(backup({ issues: [issue, { ...issue, id: 'issue-1' }] })).errors.join(' '), /dubbla nummer-id/);
	assert.match(parseBackup(backup({ progress: [{ issueId: 'missing', page: 0, pageCount: 1, completed: false, updatedAt: 1 }] })).errors.join(' '), /saknas/);
});

test('backup validation rejects hostile issue fields and oversized input', () => {
	assert.ok(parseBackup(backup({ issues: [{ ...issue, metron: { source: 'metron', id: 1, sourceUrl: 'javascript:alert(1)', characters: [], creators: [] } }] })).errors.length > 0);
	assert.ok(parseBackup(backup({ settings: { ...settings, reader: { ...settings.reader, background: 'url(javascript:alert(1))' } } })).errors.length > 0);
	assert.match(parseBackup('x'.repeat(10_000_001)).errors.join(' '), /för stor/);
});
