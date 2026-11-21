import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeFileExportPlugin {
	start(options: { fileName: string; mimeType: string; size: number }): Promise<void>;
	write(options: { data: string }): Promise<void>;
	finish(): Promise<{ saved?: boolean }>;
	abort(): Promise<void>;
}

/** Native bridge implemented by Android shell. No credentials or remote service involved. */
export const fileExport = registerPlugin<NativeFileExportPlugin>('FileExport');

export interface SaveBlobOptions {
	fileName: string;
	mimeType?: string;
}

export interface SaveBlobResult {
	platform: 'browser' | 'native';
	fileName: string;
}

let nativeExportQueue: Promise<unknown> = Promise.resolve();

function safeFileName(fileName: string): string {
	const name = fileName.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
	if (!name || name === '.' || name === '..') throw new Error('Exportfilen saknar ett giltigt filnamn.');
	return name.slice(0, 240);
}

function base64(buffer: ArrayBuffer): string {
	let result = '';
	const bytes = new Uint8Array(buffer);
	// Keep each intermediate string small so each Capacitor bridge message stays bounded.
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		result += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
	}
	return btoa(result);
}

function browserDownload(blob: Blob, fileName: string): SaveBlobResult {
	if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
		throw new Error('Hämtning stöds inte i denna miljö.');
	}
	const url = URL.createObjectURL(blob);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		a.rel = 'noopener';
		a.style.display = 'none';
		document.body?.appendChild(a);
		a.click();
		a.remove();
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
	const revokeTimer = setTimeout(() => URL.revokeObjectURL(url), 60_000);
	// Node-based unit tests should not wait for a browser cleanup timer.
	if (typeof revokeTimer === 'object' && revokeTimer !== null && 'unref' in revokeTimer && typeof revokeTimer.unref === 'function') revokeTimer.unref();
	return { platform: 'browser', fileName };
}

/** Native-only writer, exported for focused tests and alternate native shells. */
export async function saveNativeBlob(blob: Blob, options: SaveBlobOptions, plugin: NativeFileExportPlugin = fileExport): Promise<SaveBlobResult> {
	const fileName = safeFileName(options.fileName);
	const mimeType = options.mimeType || blob.type || 'application/octet-stream';
	let started = false;
	let finished = false;
	try {
		await plugin.start({ fileName, mimeType, size: blob.size });
		started = true;
		for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
			const chunk = await blob.slice(offset, Math.min(offset + 256 * 1024, blob.size)).arrayBuffer();
			await plugin.write({ data: base64(chunk) });
		}
		const response = await plugin.finish();
		finished = true;
		if (response?.saved === false) throw new Error('Android avvisade filen.');
		return { platform: 'native', fileName };
	} catch (error) {
		if (started && !finished) await plugin.abort().catch(() => {});
		throw new Error(error instanceof Error ? `Android kunde inte spara filen: ${error.message}` : 'Android kunde inte spara filen.');
	}
}

/**
 * Save a generated file. Browser downloads keep the original Blob; native
 * exports cross Capacitor's JSON bridge in bounded chunks.
 */
export async function saveBlob(blob: Blob, options: SaveBlobOptions): Promise<SaveBlobResult> {
	if (!(blob instanceof Blob) || blob.size < 0) throw new Error('Exportfilen kunde inte läsas.');
	const fileName = safeFileName(options.fileName);
	const mimeType = options.mimeType || blob.type || 'application/octet-stream';
	if (Capacitor.isNativePlatform()) {
		const run = () => saveNativeBlob(blob, { fileName, mimeType });
		const queued = nativeExportQueue.then(run, run);
		nativeExportQueue = queued.then(() => undefined, () => undefined);
		return queued;
	}
	return browserDownload(blob, fileName);
}

/** Save a generated object URL without copying it in normal browser mode. */
export async function saveObjectUrl(url: string, options: SaveBlobOptions): Promise<SaveBlobResult> {
	if (!url || typeof url !== 'string') throw new Error('Exportfilen saknar en giltig källa.');
	if (!Capacitor.isNativePlatform()) {
		if (typeof document === 'undefined') throw new Error('Hämtning stöds inte i denna miljö.');
		const fileName = safeFileName(options.fileName);
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		a.rel = 'noopener';
		a.click();
		return { platform: 'browser', fileName };
	}
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Exportfilen kunde inte läsas (${response.status}).`);
	return saveBlob(await response.blob(), options);
}
