import { get, set } from 'idb-keyval';

export interface ReaderSettings {
	pageZoom: number;
	fitMode: 'width' | 'height' | 'both' | 'none';
	doublePageMode: boolean;
	backgroundColor: string;
	maxPrefetchPages: number;
}

const defaultSettings: ReaderSettings = {
	pageZoom: 1.0,
	fitMode: 'width',
	doublePageMode: false,
	backgroundColor: '#1a1a1a',
	maxPrefetchPages: 3
};

/**
 * Load reader settings from storage
 */
export async function loadSettings(): Promise<ReaderSettings> {
	try {
		const stored = await get('reader-settings');
		return { ...defaultSettings, ...stored };
	} catch (error) {
		console.warn('Failed to load settings, using defaults:', error);
		return defaultSettings;
	}
}

/**
 * Save reader settings to storage
 */
export async function saveSettings(settings: ReaderSettings): Promise<void> {
	try {
		await set('reader-settings', settings);
	} catch (error) {
		console.warn('Failed to save settings:', error);
	}
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<ReaderSettings> {
	await saveSettings(defaultSettings);
	return defaultSettings;
}
