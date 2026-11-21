import { get, set } from 'idb-keyval';
import type { Settings } from './types.ts';

export const defaultSettings: Settings = {
	persistFiles: true,
	autoMetadata: true,
	cardSize: 170,
	reader: {
		fit: 'screen',
		spread: 'auto',
		direction: 'auto',
		background: '#000000',
		tapZones: true,
		keepAwake: true,
		preload: 2
	}
};

const KEY = 'slr-settings';

export async function loadSettings(): Promise<Settings> {
	try {
		const s = (await get(KEY)) as Partial<Settings> | undefined;
		return { ...defaultSettings, ...s, reader: { ...defaultSettings.reader, ...s?.reader } };
	} catch {
		return structuredClone(defaultSettings);
	}
}

export async function saveSettings(s: Settings): Promise<void> {
	try {
		await saveSettingsStrict(s);
	} catch (e) {
		console.warn('saveSettings failed', e);
	}
}

export async function saveSettingsStrict(s: Settings): Promise<void> {
	await set(KEY, JSON.parse(JSON.stringify(s))); // strips Svelte proxies
}
