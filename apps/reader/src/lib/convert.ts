import { Zip, ZipPassThrough } from 'fflate';
import { openArchive } from './archive.ts';

/** Defaults chosen for a good screen-reading size/quality trade-off. */
export const DEFAULT_CONVERT_OPTIONS = {
	quality: 45,
	maxWidth: 1600
} as const;

export type ConvertPhase = 'opening' | 'encoding' | 'packaging';

export interface ConvertProgress {
	phase: ConvertPhase;
	/** Number of pages completed. During opening this is always zero. */
	completed: number;
	total: number;
	/** 0..1; packaging is reported as 1 only when the ZIP is complete. */
	ratio: number;
	page?: number;
	name?: string;
}

/** Object callback is preferred; the `(completed, total)` form keeps UI adapters small. */
export type ConvertProgressCallback =
	| ((progress: ConvertProgress) => void)
	| ((completed: number, total: number) => void);

export interface AvifConvertOptions {
	/** AVIF quality, 0..100. Defaults to 45. */
	quality?: number;
	/** Maximum output width in pixels. Set to undefined to keep source width. */
	maxWidth?: number;
	lossless?: boolean;
	signal?: AbortSignal;
	onProgress?: ConvertProgressCallback;
	/** Optional encoder, useful for tests and alternate AVIF implementations. */
	encoder?: AvifEncoder;
}

export interface AvifEncoderOptions {
	quality: number;
	lossless: boolean;
}

export type AvifEncoder = (
	image: ImageData,
	options: AvifEncoderOptions
) => Promise<ArrayBuffer | Uint8Array>;

export interface AvifCbzResult {
	blob: Blob;
	fileName: string;
	pageCount: number;
	bytes: number;
	hasComicInfo: boolean;
}

const MAX_WIDTH = 32768;

/** Abort error that is also usable in runtimes without DOMException. */
export function conversionAbortError(): Error {
	try {
		return new DOMException('Konverteringen avbröts', 'AbortError');
	} catch {
		const error = new Error('Konverteringen avbröts');
		error.name = 'AbortError';
		return error;
	}
}

function checkAbort(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? conversionAbortError();
}

/** Keep the useful part of nested browser/WASM errors when reporting a page failure. */
export function conversionErrorMessage(error: unknown): string {
	if (typeof error === 'string') return error;
	if (!(error instanceof Error)) return 'Okänt fel';
	const message = error.message || error.name;
	const cause = (error as Error & { cause?: unknown }).cause;
	if (cause === undefined || cause === error) return message;
	const detail = conversionErrorMessage(cause);
	return detail && detail !== message ? `${message}: ${detail}` : message;
}

function numberOption(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Ogiltigt värde: ${value}`);
	return Math.round(value);
}

export function normaliseConvertOptions(options: AvifConvertOptions = {}): Pick<Required<AvifConvertOptions>, 'quality' | 'lossless'> & { maxWidth?: number } {
	return {
		quality: numberOption(options.quality, DEFAULT_CONVERT_OPTIONS.quality, 0, 100),
		// 0 is an explicit no-resize value (useful for a UI "original size" option).
		maxWidth: options.maxWidth === undefined ? DEFAULT_CONVERT_OPTIONS.maxWidth : options.maxWidth === 0 ? undefined : numberOption(options.maxWidth, DEFAULT_CONVERT_OPTIONS.maxWidth, 1, MAX_WIDTH),
		lossless: options.lossless === true
	};
}

/** Make an output name without allowing traversal paths into the generated ZIP. */
export function avifPageName(name: string, used = new Set<string>()): string {
	const clean = name.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
	const stem = clean.replace(/\.[^./]*$/, '') || 'page';
	const base = `${stem}.avif`;
	let candidate = base;
	let suffix = 2;
	while (used.has(candidate.toLowerCase())) {
		candidate = `${stem}-${suffix++}.avif`;
	}
	used.add(candidate.toLowerCase());
	return candidate;
}

function outputFileName(input: Blob & { name?: string }): string {
	const original = input.name?.split(/[\\/]/).pop() || 'comic.cbz';
	const stem = original.replace(/\.(?:cbz|cbr|zip|rar)$/i, '') || 'comic';
	return `${stem}.avif.cbz`;
}

type Bitmap = ImageBitmap | HTMLImageElement;
type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** JPEG dimensions are in a small header before the compressed payload. */
async function jpegWidth(blob: Blob): Promise<number | undefined> {
	const bytes = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	for (let offset = 2; offset + 8 < bytes.length;) {
		if (bytes[offset++] !== 0xff) continue;
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
		if (offset + 2 > bytes.length) return undefined;
		const length = (bytes[offset] << 8) | bytes[offset + 1];
		if (length < 2 || offset + length > bytes.length) return undefined;
		// SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15.
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
			return (bytes[offset + 5] << 8) | bytes[offset + 6];
		}
		offset += length;
	}
	return undefined;
}

async function loadBitmap(blob: Blob, maxWidth?: number, signal?: AbortSignal): Promise<Bitmap> {
	checkAbort(signal);
	if (typeof createImageBitmap === 'function') {
		try {
			// Avoid allocating a full-size bitmap for large JPEG pages. Only request a
			// resize when the header proves this is a downscale; resizeWidth otherwise
			// enlarges small pages on Chrome.
			const width = maxWidth ? await jpegWidth(blob) : undefined;
			if (width && width > maxWidth!) return await createImageBitmap(blob, { resizeWidth: maxWidth, resizeQuality: 'high' });
			return await createImageBitmap(blob);
		} catch {
			// Fall through to <img>; some browsers expose createImageBitmap but cannot decode every image type.
		}
	}
	if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
		throw new Error('Bildavkodning stöds inte i den här miljön');
	}
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.decoding = 'async';
		const loaded = new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Bilden kunde inte avkodas'));
		});
		image.src = url;
		if (typeof image.decode === 'function') await image.decode().catch(() => loaded);
		else await loaded;
		checkAbort(signal);
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function canvasSurface(width: number, height: number): { ctx: CanvasContext; release: () => void } {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error('Canvas 2D stöds inte i den här miljön');
		return { ctx, release: () => {} };
	}
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error('Canvas 2D stöds inte i den här miljön');
		return { ctx, release: () => { canvas.width = 1; canvas.height = 1; } };
	}
	throw new Error('Bildkonvertering kräver en webbläsare');
}

async function imageData(blob: Blob, maxWidth: number | undefined, signal?: AbortSignal): Promise<ImageData> {
	const bitmap = await loadBitmap(blob, maxWidth, signal);
	try {
		checkAbort(signal);
		const sourceWidth = bitmap.width;
		const sourceHeight = bitmap.height;
		if (!sourceWidth || !sourceHeight) throw new Error('Bilden har ogiltig storlek');
		const width = maxWidth ? Math.min(sourceWidth, maxWidth) : sourceWidth;
		const height = Math.max(1, Math.round(sourceHeight * width / sourceWidth));
		const surface = canvasSurface(width, height);
		try {
			surface.ctx.imageSmoothingEnabled = true;
			surface.ctx.imageSmoothingQuality = 'high';
			surface.ctx.drawImage(bitmap, 0, 0, width, height);
			return surface.ctx.getImageData(0, 0, width, height);
		} finally {
			surface.release();
		}
	} finally {
		if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
	}
}

async function directEncoder(image: ImageData, options: AvifEncoderOptions): Promise<ArrayBuffer> {
	const { encode } = await import('@jsquash/avif');
	return encode(image, options);
}

interface WorkerReply {
	id: number;
	output?: ArrayBuffer;
	error?: string;
}

interface PendingEncode {
	resolve: (value: ArrayBuffer) => void;
	reject: (reason?: unknown) => void;
}

let encoderWorker: Worker | undefined;
let encoderWorkerId = 0;
const pendingEncodes = new Map<number, PendingEncode>();

function failWorker(error: unknown): void {
	const worker = encoderWorker;
	encoderWorker = undefined;
	worker?.terminate();
	for (const pending of pendingEncodes.values()) pending.reject(error);
	pendingEncodes.clear();
}

function getEncoderWorker(): Worker {
	if (encoderWorker) return encoderWorker;
	if (typeof Worker === 'undefined') throw new Error('Web Worker stöds inte i den här miljön');
	const worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
	worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
		const pending = pendingEncodes.get(data.id);
		if (!pending) return;
		pendingEncodes.delete(data.id);
		if (data.error) {
			const error = new Error(data.error);
			// A WASM init/encode error can leave the module worker unusable. Drop it
			// so the next page gets a fresh worker (and can use the fallback below).
			failWorker(error);
			pending.reject(error);
		}
		else if (data.output) pending.resolve(data.output);
		else pending.reject(new Error('AVIF-workern gav inget resultat'));
	};
	worker.onerror = (event) => failWorker(new Error(event.message || 'AVIF-workern avslutades'));
	encoderWorker = worker;
	return worker;
}

/** Encode off-main-thread when workers are available, reusing one WASM instance per session. */
async function workerEncoder(image: ImageData, options: AvifEncoderOptions, signal?: AbortSignal): Promise<ArrayBuffer> {
	if (typeof Worker === 'undefined') return directEncoder(image, options);
	let worker: Worker;
	try {
		worker = getEncoderWorker();
	} catch {
		// CSPs or older browsers may expose Worker but reject module worker construction.
		return directEncoder(image, options);
	}
	const id = ++encoderWorkerId;
	// Transfer detaches the source ImageData. Keep a copy so a worker/WASM load
	// failure can fall back to the main-thread encoder (notably offline Android).
	const fallbackImage = { data: image.data.slice(), width: image.width, height: image.height } as ImageData;
	return new Promise<ArrayBuffer>((resolve, reject) => {
		const abort = () => {
			failWorker(signal?.reason ?? conversionAbortError());
		};
		if (signal?.aborted) {
			abort();
			return;
		}
		const cleanup = () => signal?.removeEventListener('abort', abort);
		pendingEncodes.set(id, {
			resolve: (value) => { cleanup(); resolve(value); },
			reject: (reason) => { cleanup(); reject(reason); }
		});
		signal?.addEventListener('abort', abort, { once: true });
		try {
			worker.postMessage(
				{ id, data: image.data.buffer, width: image.width, height: image.height, quality: options.quality, lossless: options.lossless },
				[image.data.buffer]
			);
		} catch (error) {
			pendingEncodes.delete(id);
			cleanup();
			reject(error);
		}
	}).catch(async (error) => {
		if (signal?.aborted) throw signal.reason ?? conversionAbortError();
		try {
			return await directEncoder(fallbackImage, options);
		} catch (fallbackError) {
			throw new Error(`AVIF-worker misslyckades (${conversionErrorMessage(error)})`, { cause: fallbackError });
		}
	});
}

let encoderSupport: Promise<boolean> | undefined;

/** Check actual AVIF encoding, not merely the browser's image MIME list. Result is cached. */
export function canEncodeAvif(): Promise<boolean> {
	return (encoderSupport ??= (async () => {
		if (typeof ImageData === 'undefined') return false;
		try {
			const pixels = new Uint8ClampedArray([255, 255, 255, 255]);
			const image = new ImageData(pixels, 1, 1);
			const output = await workerEncoder(image, { quality: 45, lossless: false });
			return new Uint8Array(output).byteLength > 0;
		} catch {
			return false;
		}
	})());
}

/** Alias with an explicit name for callers doing feature detection before showing a conversion action. */
export const isAvifEncodingSupported = canEncodeAvif;

function report(onProgress: AvifConvertOptions['onProgress'], progress: ConvertProgress): void {
	if (!onProgress) return;
	if (onProgress.length >= 2) (onProgress as (completed: number, total: number) => void)(progress.completed, progress.total);
	else (onProgress as (value: ConvertProgress) => void)(progress);
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Package without DEFLATE: AVIF is already compressed, so compression wastes CPU and blocks the UI. */
async function packageZip(entries: Record<string, Uint8Array>, signal?: AbortSignal): Promise<Blob> {
	const chunks: Uint8Array[] = [];
	let failure: Error | undefined;
	const zip = new Zip((error, chunk) => {
		if (error) failure = error;
		else if (chunk) chunks.push(chunk);
	});
	try {
		for (const name of Object.keys(entries)) {
			checkAbort(signal);
			// Yield to a macrotask so UI abort events can run before the next copy.
			await yieldToEventLoop();
			const data = entries[name];
			if (!data) continue;
			const file = new ZipPassThrough(name);
			zip.add(file);
			file.push(data, true);
			delete entries[name];
		}
		checkAbort(signal);
		zip.end();
		if (failure) throw failure;
		return new Blob(chunks as BlobPart[], { type: 'application/zip' });
	} catch (error) {
		zip.terminate();
		throw error;
	}
}

/** Convert a CBZ/CBR (or ZIP/RAR) comic to an AVIF-only CBZ in the browser. */
export async function convertToAvifCbz(input: Blob & { name?: string }, options: AvifConvertOptions = {}): Promise<AvifCbzResult> {
	const config = normaliseConvertOptions(options);
	checkAbort(options.signal);
	const encode = options.encoder ?? ((image: ImageData, encoderOptions: AvifEncoderOptions) => workerEncoder(image, encoderOptions, options.signal));
	report(options.onProgress, { phase: 'opening', completed: 0, total: 0, ratio: 0 });
	const archive = await openArchive(input);
	try {
		checkAbort(options.signal);
		const total = archive.pages.length;
		if (!total) throw new Error('Arkivet innehåller inga bilder');
		// Input pages are decoded/encoded strictly one at a time. The final Blob still
		// retains the encoded output, but AVIF is stored without redundant ZIP compression.
		const entries: Record<string, Uint8Array> = {};
		const used = new Set<string>();
		const comicInfo = await archive.readText('ComicInfo.xml');
		if (comicInfo !== undefined) entries['ComicInfo.xml'] = new TextEncoder().encode(comicInfo);
		for (let index = 0; index < total; index++) {
			checkAbort(options.signal);
			const page = archive.pages[index];
			report(options.onProgress, { phase: 'encoding', completed: index, total, ratio: index / total, page: index, name: page.name });
			try {
				const pixels = await imageData(await archive.readPage(index), config.maxWidth, options.signal);
				checkAbort(options.signal);
				const encoded = await encode(pixels, { quality: config.lossless ? 100 : config.quality, lossless: config.lossless });
				entries[avifPageName(page.name, used)] = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
			} catch (error) {
				if (options.signal?.aborted) throw options.signal.reason ?? conversionAbortError();
				throw new Error(`Sidan kunde inte konverteras: ${page.name} – ${conversionErrorMessage(error)}`, { cause: error });
			}
			report(options.onProgress, { phase: 'encoding', completed: index + 1, total, ratio: (index + 1) / total, page: index, name: page.name });
		}
		checkAbort(options.signal);
		report(options.onProgress, { phase: 'packaging', completed: total, total, ratio: 0 });
		const blob = await packageZip(entries, options.signal);
		checkAbort(options.signal);
		report(options.onProgress, { phase: 'packaging', completed: total, total, ratio: 1 });
		return { blob, fileName: outputFileName(input), pageCount: total, bytes: blob.size, hasComicInfo: comicInfo !== undefined };
	} finally {
		archive.close();
	}
}

/** Descriptive alias for code that handles several archive conversion formats. */
export const convertArchiveToAvifCbz = convertToAvifCbz;

/** Short alias used by the reader's conversion action. */
export const convertCbz = convertToAvifCbz;

