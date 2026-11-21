import type { Extractor } from 'node-unrar-js';
import { mimeFor } from './mime.ts';
import type { ArchivePage, ComicArchive } from './types.ts';
import { naturalCompare } from './util.ts';

const IMAGE = /\.(avif|webp|jpe?g|png|gif|bmp)$/i;
const JUNK = /(^|\/)(__MACOSX\/|\._)/;

const LOCKED = 'RAR-filen är lösenordsskyddad';
const BROKEN = 'RAR-filen är skadad eller ofullständig'; // also what non-RAR data looks like to unrar (ERAR_EREAD)
const MESSAGES: Record<string, string> = {
	ERAR_MISSING_PASSWORD: LOCKED,
	ERAR_BAD_PASSWORD: LOCKED,
	ERAR_BAD_ARCHIVE: BROKEN,
	ERAR_BAD_DATA: BROKEN,
	ERAR_EREAD: BROKEN,
	ERAR_UNKNOWN_FORMAT: 'RAR-formatet stöds inte',
	ERAR_NO_MEMORY: 'För lite minne för att läsa RAR-filen'
};
/** node-unrar-js errors carry a `reason` code; show a Swedish message for it. */
const swedish = (e: unknown) =>
	new Error(MESSAGES[(e as { reason?: string } | null)?.reason ?? ''] ?? 'Kunde inte läsa RAR-filen');

type Create = (data: ArrayBuffer) => Promise<Extractor<Uint8Array>>;
let loading: Promise<Create> | undefined;

/** The wasm is passed in explicitly: a Vite asset URL in the browser, read from disk in Node (tests). */
async function loadWasm(): Promise<ArrayBuffer> {
	if (typeof window !== 'undefined') {
		const { default: url } = await import('node-unrar-js/esm/js/unrar.wasm?url');
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.arrayBuffer();
	}
	const fs = 'node:fs/promises'; // through a variable so Vite never tries to bundle it
	const { readFile } = await import(/* @vite-ignore */ fs);
	const bytes = await readFile(new URL(import.meta.resolve('node-unrar-js/esm/js/unrar.wasm')));
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function load(): Promise<Create> {
	return (loading ??= (async () => {
		const [{ createExtractorFromData }, wasmBinary] = await Promise.all([import('node-unrar-js'), loadWasm()]);
		return (data: ArrayBuffer) => createExtractorFromData({ data, wasmBinary });
	})().catch(() => {
		loading = undefined; // allow a retry, e.g. the wasm fetch failed while offline
		throw new Error('Kunde inte ladda RAR-stödet');
	}));
}

// node-unrar-js routes every wasm callback to ONE global "current" extractor (set whenever an extractor is
// created), so operations on different archives must never interleave.
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
	const run = lock.then(fn);
	lock = run.catch(() => {});
	return run;
}

/** RAR/CBR backend (lazy-loaded by archive.ts via dynamic import). The whole file is held in memory. */
export async function openRar(file: Blob): Promise<ComicArchive> {
	const create = await load();
	let data: ArrayBuffer | undefined;
	try {
		data = await file.arrayBuffer();
	} catch {
		throw new Error('RAR-filen är för stor för att läsas in');
	}

	/** Run `fn` on a fresh extractor (cheap, and its extracted data is freed afterwards). `fn` must be synchronous. */
	const run = <T>(fn: (ex: Extractor<Uint8Array>) => T): Promise<T> =>
		exclusive(async () => {
			if (!data) throw new Error('Arkivet är stängt');
			try {
				return fn(await create(data));
			} catch (e) {
				throw swedish(e);
			}
		});

	// Generators must be exhausted, otherwise the native archive object leaks.
	const extract = async (name: string) => {
		const [file] = await run((ex) => [...ex.extract({ files: [name] }).files]);
		if (!file?.extraction) throw new Error('Filen finns inte i arkivet');
		return file.extraction;
	};

	const headers = await run((ex) => [...ex.getFileList().fileHeaders]);
	const entries = headers
		.filter((h) => !h.flags.directory && IMAGE.test(h.name) && !JUNK.test(h.name))
		.sort((a, b) => naturalCompare(a.name, b.name));
	if (entries.some((h) => h.flags.encrypted)) throw new Error(LOCKED);
	const pages: ArchivePage[] = entries.map((h, index) => ({ index, name: h.name, size: h.unpSize, mime: mimeFor(h.name) }));

	return {
		format: 'rar',
		pages,
		async readPage(index) {
			const page = pages[index];
			if (!page) throw new RangeError('Sidan finns inte');
			return new Blob([(await extract(page.name)) as Uint8Array<ArrayBuffer>], { type: page.mime });
		},
		async readText(name) {
			const want = name.toLowerCase();
			const h = headers.find((x) => !x.flags.directory && x.name.slice(x.name.lastIndexOf('/') + 1).toLowerCase() === want);
			return h && new TextDecoder().decode(await extract(h.name)); // decode() drops a leading BOM
		},
		close() {
			data = undefined;
			// The library keeps its last extractor (and so the whole file) referenced until the next one is created.
			exclusive(() => create(new ArrayBuffer(0))).catch(() => {});
		}
	};
}
