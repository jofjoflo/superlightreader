import assert from 'node:assert/strict';
import test from 'node:test';
import config from './capacitor.config.ts';

test('Capacitor packages the adapter-static output with a stable app identity', () => {
	assert.equal(config.appId, 'com.superlight.reader');
	assert.equal(config.appName, 'SuperLight Reader');
	assert.equal(config.webDir, 'build');
});

test('Capacitor Android WebView keeps production transport and logging locked down', () => {
	assert.equal(config.server?.androidScheme, 'https');
	assert.equal(config.server?.cleartext, false);
	assert.equal(config.android?.allowMixedContent, false);
	assert.equal(config.android?.webContentsDebuggingEnabled, false);
	assert.equal(config.loggingBehavior, 'none');
	assert.equal(config.android?.loggingBehavior, 'none');
});
