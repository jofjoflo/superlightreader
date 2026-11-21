/**
 * Random-access ZIP reader over a Blob/File. Never loads the whole archive: `openZip` reads only the
 * archive tail (EOCD) and the central directory; entries are then read one at a time with Blob.slice.
 * Supports ZIP64, stored (0) and deflate (8). Pure module: no DOM access at import time.
 */
import { inflateSync } from 'fflate';

export interface ZipEntry {
	name: string; // '/'-separated path; directories end with '/'
	size: number; // uncompressed bytes
	csize: number; // compressed bytes
	method: number; // 0 = stored, 8 = deflate
	offset: number; // local header offset
	flags: number; // general-purpose bit flags
	isDir: boolean;
}

export interface ZipFile {
	entries: ZipEntry[];
	/** Uncompressed bytes of an entry. */
	read(entry: ZipEntry): Promise<Uint8Array>;
	/** Uncompressed entry as a Blob. Stored entries are a zero-copy Blob.slice. */
	blob(entry: ZipEntry, mime?: string): Promise<Blob>;
}

const SIG_LOCAL = 0x04034b50; // local file header
const SIG_CENTRAL = 0x02014b50; // central directory file header
const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_EOCD64 = 0x06064b50; // ZIP64 end of central directory record
const SIG_LOC64 = 0x07064b50; // ZIP64 end of central directory locator
const EOCD_SIZE = 22;
const EOCD64_SIZE = 56;
const LOC64_SIZE = 20;
const MAX_COMMENT = 0xffff;
const MAX32 = 0xffffffff;
const isNativeRange = (value: unknown): boolean =>
	!!value && typeof value === 'object' && (value as { __nativeRange?: unknown }).__nativeRange === true;

const bad = (why: string) => new Error(`Skadad zip-fil (${why})`);
const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);
const u64 = (d: DataView, o: number) => u32(d, o) + u32(d, o + 4) * 2 ** 32;
const view = async (src: Blob, start: number, end: number) =>
	new DataView(await src.slice(start, end).arrayBuffer());

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('windows-1252');
/** UTF-8 (flagged or not, as most modern writers emit it); legacy 8-bit names fall back to windows-1252. */
function decodeName(b: Uint8Array): string {
	try {
		return utf8.decode(b);
	} catch {
		return latin1.decode(b);
	}
}

async function readEntries(src: Blob): Promise<ZipEntry[]> {
	const total = src.size;
	// The EOCD sits within the last 22 + 65535 bytes; take 20 more for the ZIP64 locator right before it.
	const tailLen = Math.min(total, EOCD_SIZE + MAX_COMMENT + LOC64_SIZE);
	const tail = await view(src, total - tailLen, total);

	// Scan backwards: prefer an EOCD whose comment ends exactly at EOF, else tolerate trailing junk.
	let eocd = -1;
	for (let p = tailLen - EOCD_SIZE; p >= 0; p--) {
		if (u32(tail, p) !== SIG_EOCD) continue;
		const end = p + EOCD_SIZE + u16(tail, p + 20);
		if (end === tailLen) {
			eocd = p;
			break;
		}
		if (end < tailLen && eocd < 0) eocd = p;
	}
	if (eocd < 0) throw bad('ingen slutpost hittades');

	let count = u16(tail, eocd + 10);
	let cdSize = u32(tail, eocd + 12);
	let cdOffset = u32(tail, eocd + 16);
	if (eocd >= LOC64_SIZE && u32(tail, eocd - LOC64_SIZE) === SIG_LOC64) {
		const at = u64(tail, eocd - 12); // locator: offset of the ZIP64 EOCD record
		const rec = await view(src, at, at + EOCD64_SIZE);
		if (rec.byteLength < EOCD64_SIZE || u32(rec, 0) !== SIG_EOCD64) throw bad('ogiltig ZIP64-slutpost');
		count = u64(rec, 32);
		cdSize = u64(rec, 40);
		cdOffset = u64(rec, 48);
	}
	if (cdOffset + cdSize > total) throw bad('centralkatalogen ligger utanför filen');

	const cd = await view(src, cdOffset, cdOffset + cdSize);
	const entries: ZipEntry[] = [];
	let p = 0;
	for (let i = 0; i < count; i++) {
		if (p + 46 > cd.byteLength || u32(cd, p) !== SIG_CENTRAL) throw bad('ogiltig centralkatalog');
		const flags = u16(cd, p + 8);
		if (flags & 1) throw new Error('Krypterad arkiv stöds inte');
		let csize = u32(cd, p + 20);
		let size = u32(cd, p + 24);
		let offset = u32(cd, p + 42);
		const nameLen = u16(cd, p + 28);
		const extraAt = p + 46 + nameLen;
		const extraEnd = extraAt + u16(cd, p + 30);
		const next = extraEnd + u16(cd, p + 32); // + comment
		if (next > cd.byteLength) throw bad('ogiltig centralkatalog');
		// ZIP64 extra field (id 1) holds, in this order, only those values that are 0xFFFFFFFF in the fixed header.
		for (let q = extraAt; q + 4 <= extraEnd; q += 4 + u16(cd, q + 2)) {
			if (u16(cd, q) !== 1) continue;
			let r = q + 4;
			if (size === MAX32) {
				size = u64(cd, r);
				r += 8;
			}
			if (csize === MAX32) {
				csize = u64(cd, r);
				r += 8;
			}
			if (offset === MAX32) offset = u64(cd, r);
			break;
		}
		// Backslashes: written by some Windows tools (e.g. PowerShell 5.1 Compress-Archive).
		const name = decodeName(new Uint8Array(cd.buffer, p + 46, nameLen)).replace(/\\/g, '/');
		entries.push({ name, size, csize, method: u16(cd, p + 10), offset, flags, isDir: name.endsWith('/') });
		p = next;
	}
	return entries;
}

/** Parse the central directory of `blob`. Throws Error with a Swedish message if it is not a readable zip. */
export async function openZip(blob: Blob): Promise<ZipFile> {
	let entries: ZipEntry[];
	try {
		entries = await readEntries(blob);
	} catch (e) {
		throw e instanceof RangeError ? bad('trunkerad centralkatalog') : e;
	}

	/** The entry's raw bytes (compressed, for deflate), located through its local header. */
	async function raw(e: ZipEntry, mime?: string): Promise<Blob> {
		if (e.method !== 0 && e.method !== 8) throw new Error(`Komprimeringsmetod ${e.method} stöds inte`);
		const head = await view(blob, e.offset, e.offset + 30);
		if (head.byteLength < 30 || u32(head, 0) !== SIG_LOCAL) throw bad('ogiltig lokal header');
		// The local name/extra lengths may differ from the central directory's: they decide where the data starts.
		const start = e.offset + 30 + u16(head, 26) + u16(head, 28);
		if (start + e.csize > blob.size) throw bad('posten är avkortad');
		return blob.slice(start, start + e.csize, mime);
	}

	async function inflate(compressed: Blob, e: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
		const packed = new Uint8Array(await compressed.arrayBuffer());
		const out = new Uint8Array(e.size); // exact size: no regrowth, and a size mismatch is caught below
		let n = -1;
		try {
			n = inflateSync(packed, { out }).length;
		} catch {
			// corrupt deflate stream
		}
		if (n !== e.size) throw bad(`kunde inte packa upp ${e.name}`);
		return out;
	}

	return {
		entries,
		async read(e) {
			const data = await raw(e);
			return e.method === 0 ? new Uint8Array(await data.arrayBuffer()) : inflate(data, e);
		},
		async blob(e, mime) {
			const data = await raw(e, mime);
			// Native SAF files use a range-backed Blob-like value. Materialize only the requested
			// page so browser image decoders receive a real Blob; the archive itself stays ranged.
			if (e.method === 0 && !isNativeRange(data)) return data;
			return new Blob([await (e.method === 0 ? data.arrayBuffer() : inflate(data, e))], { type: mime });
		}
	};
}
