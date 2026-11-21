/** OPFS (origin private file system) copies of comic files so the library survives reloads without re-picking. */

const DIR = 'comics'; // sub-directory under the OPFS root
const EXT = '.bin'; // stored file name = issue id + EXT

export function opfsAvailable(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		!!globalThis.isSecureContext &&
		'storage' in navigator &&
		typeof navigator.storage.getDirectory === 'function'
	);
}

/** Run an OPFS call, mapping "entry does not exist" (NotFoundError) to undefined. Other errors propagate. */
async function orMissing<T>(run: () => Promise<T>): Promise<T | undefined> {
	try {
		return await run();
	} catch (e) {
		if ((e as { name?: string } | null)?.name === 'NotFoundError') return undefined;
		throw e;
	}
}

/** The comics directory; undefined if OPFS is unsupported or (unless `create`) nothing was stored yet. */
async function comics(create = false): Promise<FileSystemDirectoryHandle | undefined> {
	if (!opfsAvailable()) return undefined;
	const root = await navigator.storage.getDirectory();
	return orMissing(() => root.getDirectoryHandle(DIR, { create }));
}

/** Stream-copy `file` into OPFS under `id`; native SAF handles provide ranged arrayBuffer() reads. */
export async function opfsPut(id: string, file: File): Promise<File> {
	const dir = await comics(true);
	if (!dir) throw new Error('OPFS is not available');
	const name = id + EXT;
	const existed = !!(await orMissing(() => dir.getFileHandle(name)));
	const handle = await dir.getFileHandle(name, { create: true });
	try {
		const out = await handle.createWritable();
		try {
			if (file instanceof Blob) {
				await out.write(file); // the browser streams the Blob to disk
			} else {
				// Android SAF's File-like handle is deliberately not a Blob: copy bounded ranges
				// instead of asking the bridge for the complete archive.
				const ranged = file as unknown as { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } };
				const chunk = 256 * 1024;
				for (let offset = 0; offset < ranged.size; offset += chunk) {
					const bytes = await ranged.slice(offset, Math.min(offset + chunk, ranged.size)).arrayBuffer();
					if (!bytes.byteLength) throw new Error('Filen tog slut oväntat.');
					await out.write(bytes);
				}
			}
			await out.close();
		} catch (e) {
			await out.abort().catch(() => {});
			throw e;
		}
		return await handle.getFile();
	} catch (e) {
		// Keep a previous copy intact. `abort()` discards an in-flight replacement;
		// remove only a newly-created entry left behind by a failed write.
		if (!existed) await dir.removeEntry(name).catch(() => {});
		throw e;
	}
}

export async function opfsGet(id: string): Promise<File | undefined> {
	const dir = await comics();
	if (!dir) return undefined;
	return orMissing(async () => (await dir.getFileHandle(id + EXT)).getFile());
}

export async function opfsDelete(id: string): Promise<void> {
	const dir = await comics();
	if (dir) await orMissing(() => dir.removeEntry(id + EXT));
}

/** Ids that currently have a stored copy. */
export async function opfsList(): Promise<Set<string>> {
	const ids = new Set<string>();
	const dir = await comics();
	if (!dir) return ids;
	// keys() is missing from the DOM typings unless the DOM.AsyncIterable lib is enabled
	for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
		if (name.endsWith(EXT)) ids.add(name.slice(0, -EXT.length));
	}
	return ids;
}

export async function opfsClear(): Promise<void> {
	if (!opfsAvailable()) return;
	const root = await navigator.storage.getDirectory();
	await orMissing(() => root.removeEntry(DIR, { recursive: true }));
}

/** navigator.storage.estimate() → bytes; {usage:0,quota:0} when unsupported. */
export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
	try {
		const { usage = 0, quota = 0 } = await navigator.storage.estimate();
		return { usage, quota };
	} catch {
		return { usage: 0, quota: 0 };
	}
}

/** navigator.storage.persist() — ask browser not to evict. Returns granted flag. */
export async function requestPersist(): Promise<boolean> {
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}
