import { mimeFor } from './mime.ts';
import type { ArchivePage, ComicArchive } from './types.ts';
import { naturalCompare } from './util.ts';
import { openZip } from './zip.ts';
import type { ZipEntry, ZipFile } from './zip.ts';

/** true for .cbz .zip .cbr .rar (case-insensitive) */
export function isComicFileName(name: string): boolean {
	return /\.(cbz|zip|cbr|rar)$/i.test(name);
}

const IMAGE = /\.(avif|webp|jpe?g|png|gif|bmp)$/i;
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Image entries, minus macOS resource forks (Thumbs.db and the like are not images anyway). */
const isPage = (e: ZipEntry) =>
	!e.isDir && IMAGE.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name) && !basename(e.name).startsWith('._');

/**
 * Open a comic archive with random access (never inflate the whole file).
 * Sniffs magic bytes (PK.. → zip, Rar! → rar) rather than trusting the extension (.cbr is often a zip).
 */
export async function openArchive(file: Blob & { name?: string }): Promise<ComicArchive> {
	const magic = String.fromCharCode(...new Uint8Array(await file.slice(0, 4).arrayBuffer()));
	if (magic === 'PK\x03\x04' || magic === 'PK\x05\x06') return openZipArchive(file);
	if (magic === 'Rar!') {
		const { openRar } = await import('./rar.ts');
		return openRar(file);
	}
	throw new Error('Okänt arkivformat');
}

async function openZipArchive(file: Blob): Promise<ComicArchive> {
	let zip: ZipFile | undefined = await openZip(file);
	const sorted = zip.entries.filter(isPage).sort((a, b) => naturalCompare(a.name, b.name));
	const pages: ArchivePage[] = sorted.map((e, index) => ({
		index,
		name: e.name,
		size: e.size,
		mime: mimeFor(e.name)
	}));
	const opened = () => {
		if (!zip) throw new Error('Arkivet är stängt');
		return zip;
	};

	return {
		format: 'zip',
		pages,
		async readPage(index) {
			const z = opened();
			const entry = sorted[index];
			if (!entry) throw new RangeError(`Sidan finns inte: ${index}`);
			return z.blob(entry, pages[index].mime);
		},
		async readText(name) {
			const z = opened();
			const want = name.toLowerCase();
			const entry = z.entries.find((e) => !e.isDir && basename(e.name).toLowerCase() === want);
			// TextDecoder strips a leading UTF-8 BOM.
			return entry ? new TextDecoder().decode(await z.read(entry)) : undefined;
		},
		close() {
			zip = undefined;
		}
	};
}
