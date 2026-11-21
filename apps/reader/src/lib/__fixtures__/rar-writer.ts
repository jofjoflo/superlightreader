import { crc32 } from 'node:zlib';

/** Minimal RAR 3/4 writer (stored entries only) so tests can build archives without the `rar` tool. */
export interface RarEntry {
	name: string; // '/'-separated, ASCII
	data?: Uint8Array;
	dir?: boolean;
	/** Marks the entry as password-protected (data is NOT actually encrypted; only listing is meaningful). */
	encrypted?: boolean;
}

const u16 = (n: number) => [n & 255, (n >> 8) & 255];
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** Block = CRC16 + type + flags + size + body; the CRC covers everything after itself. */
function block(type: number, flags: number, body: number[]): number[] {
	const rest = [type, ...u16(flags), ...u16(7 + body.length), ...body];
	return [...u16(crc32(Uint8Array.from(rest)) & 0xffff), ...rest];
}

export function buildRar(entries: RarEntry[], opts: { solid?: boolean } = {}): Uint8Array {
	const out: number[] = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]; // marker
	out.push(...block(0x73, opts.solid ? 0x0008 : 0, [0, 0, 0, 0, 0, 0])); // main header
	entries.forEach((e, i) => {
		const data = e.data ?? new Uint8Array();
		const name = [...new TextEncoder().encode(e.name)];
		let flags = 0x8000; // packed data follows the header
		if (e.dir) flags |= 0x00e0;
		if (e.encrypted) flags |= 0x0004 | 0x0400; // password + salt
		if (opts.solid && i > 0) flags |= 0x0010;
		const body = [
			...u32(data.length), // packed size
			...u32(data.length), // unpacked size
			3, // host OS: unix
			...u32(crc32(data)),
			...u32(0x5a8f2000), // DOS time
			29, // needs unrar 2.9
			0x30, // method: store
			...u16(name.length),
			...u32(e.dir ? 0x41ed : 0x81a4), // unix mode
			...name,
			...(e.encrypted ? [1, 2, 3, 4, 5, 6, 7, 8] : []) // salt
		];
		out.push(...block(0x74, flags, body), ...data);
	});
	out.push(0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00); // end of archive
	return Uint8Array.from(out);
}
