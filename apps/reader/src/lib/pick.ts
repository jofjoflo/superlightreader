import type { ScanInput } from './types.ts';

// Filter by extension in JS only: never set `accept` on the input (Android greys out .cbz).
const COMIC = /\.(cbz|cbr|zip|rar)$/i;

/** Keep only comic files (.cbz .zip .cbr .rar), path = webkitRelativePath || name. */
export function inputsFromFiles(files: FileList | File[]): ScanInput[] {
	const out: ScanInput[] = [];
	for (const file of files) {
		if (COMIC.test(file.name)) out.push({ file, path: file.webkitRelativePath || file.name });
	}
	return out;
}

/** Open the native picker. MUST be called synchronously inside a click handler. Resolves [] on cancel. */
export function pickFiles(opts: { directory?: boolean } = {}): Promise<ScanInput[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		if (opts.directory) input.webkitdirectory = true;
		input.style.display = 'none';
		const finish = (files: FileList | null) => {
			input.remove();
			resolve(files ? inputsFromFiles(files) : []);
		};
		input.addEventListener('change', () => finish(input.files));
		input.addEventListener('cancel', () => finish(null));
		document.body.append(input); // some Android browsers only open the picker for attached inputs
		input.click();
	});
}

/** Comic files below `entry` (a file or directory), in traversal order. Unreadable entries are skipped. */
async function walk(entry: FileSystemEntry): Promise<ScanInput[]> {
	try {
		if (entry.isFile) {
			if (!COMIC.test(entry.name)) return [];
			const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
			return [{ file, path: entry.fullPath.replace(/^\//, '') }];
		}
		const reader = (entry as FileSystemDirectoryEntry).createReader();
		const out: ScanInput[] = [];
		for (;;) {
			// readEntries yields a limited batch (100 in Chrome) per call: repeat until it returns nothing
			const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
			if (!batch.length) return out;
			for (const found of await Promise.all(batch.map(walk))) for (const input of found) out.push(input);
		}
	} catch (e) {
		console.warn('Skipped unreadable drop entry', entry.fullPath, e);
		return [];
	}
}

/**
 * Drag & drop (desktop): walk dropped directories via webkitGetAsEntry.
 * Call it straight from the drop handler: `dt` is emptied once the handler returns, so it is read before any await.
 */
export async function inputsFromDrop(dt: DataTransfer): Promise<ScanInput[]> {
	const roots: FileSystemEntry[] = [];
	for (const item of Array.from(dt.items ?? [])) {
		const entry = item.kind === 'file' ? item.webkitGetAsEntry?.() : null;
		if (entry) roots.push(entry);
	}
	if (!roots.length) return inputsFromFiles(dt.files); // no entries API: plain files only
	return (await Promise.all(roots.map(walk))).flat();
}
