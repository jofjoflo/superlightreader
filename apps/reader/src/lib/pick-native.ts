import { registerPlugin } from '@capacitor/core';

export interface NativePickedFile {
	name: string;
	path: string;
	size: number;
	lastModified: number;
	/** Content URI retained by the Android picker plugin. Never expose its contents in the bridge. */
	uri: string;
}

export interface NativePickResult {
	files: NativePickedFile[];
	errors?: string[];
}

export interface NativeReadChunkResult {
	data: string;
	bytesRead: number;
	eof: boolean;
}

export interface NativePickerPlugin {
	pick(options: { directory: boolean }): Promise<NativePickResult>;
	readChunk(options: { uri: string; offset: number; length: number }): Promise<NativeReadChunkResult>;
}

/** Android SAF bridge. The browser does not load this plugin until pickFiles checks native support. */
export const nativePicker = registerPlugin<NativePickerPlugin>('NativePicker');

const CHUNK = 256 * 1024;

function decodeBase64(value: string): Uint8Array {
	if (typeof atob !== 'function') throw new Error('Android-läsning stöds inte i denna miljö.');
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

interface NativeBlobPartLike {
	readonly size: number;
	readonly type: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** Blob-like range that fetches only the requested bytes through Android. */
export class NativeBlobPart implements NativeBlobPartLike {
	readonly __nativeRange = true;
	readonly size: number;
	readonly type: string;
	private readonly read: (offset: number, length: number) => Promise<Uint8Array>;
	private readonly offset: number;

	constructor(
		read: (offset: number, length: number) => Promise<Uint8Array>,
		offset: number,
		size: number,
		type = ''
	) {
		this.read = read;
		this.offset = offset;
		this.size = Math.max(0, Math.trunc(size));
		this.type = type;
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		const result = new Uint8Array(this.size);
		for (let offset = 0; offset < this.size; offset += CHUNK) {
			const want = Math.min(CHUNK, this.size - offset);
			const bytes = await this.read(this.offset + offset, want);
			if (!bytes.length || bytes.length > want) throw new Error('Android-filen är avkortad.');
			result.set(bytes, offset);
			if (bytes.length !== want) throw new Error('Android-filen är avkortad.');
		}
		return result.buffer;
	}
}

/** File-like object backed by a SAF URI. Implements only APIs used by archive readers. */
export class NativePickedFileHandle {
	readonly name: string;
	readonly size: number;
	readonly lastModified: number;
	readonly type = 'application/octet-stream';
	readonly webkitRelativePath = '';
	private readonly read: (offset: number, length: number) => Promise<Uint8Array>;

	constructor(
		file: NativePickedFile,
		read: (offset: number, length: number) => Promise<Uint8Array>
	) {
		this.name = file.name;
		this.size = file.size;
		this.lastModified = file.lastModified;
		this.read = read;
	}

	slice(start = 0, end = this.size, contentType = ''): NativeBlobPart {
		const from = start < 0 ? Math.max(this.size + start, 0) : Math.min(Math.max(start, 0), this.size);
		const to = end < 0 ? Math.max(this.size + end, 0) : Math.min(Math.max(end, 0), this.size);
		return new NativeBlobPart(this.read, from, Math.max(0, to - from), contentType);
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		const result = new Uint8Array(this.size);
		for (let offset = 0; offset < this.size; offset += CHUNK) {
			const chunk = await this.read(offset, Math.min(CHUNK, this.size - offset));
			if (!chunk.length) throw new Error('Android-filen tog slut oväntat.');
			result.set(chunk, offset);
			if (chunk.length < Math.min(CHUNK, this.size - offset) && offset + chunk.length < this.size) {
				throw new Error('Android-filen är avkortad.');
			}
		}
		return result.buffer;
	}
}

export function nativeFileInput(file: NativePickedFile): { file: NativePickedFileHandle; path: string } {
	const read = async (offset: number, length: number): Promise<Uint8Array> => {
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > CHUNK) {
			throw new RangeError('Ogiltigt läsintervall.');
		}
		if (offset >= file.size || length === 0) return new Uint8Array();
		const want = Math.min(length, file.size - offset);
		const response = await nativePicker.readChunk({ uri: file.uri, offset, length: want });
		if (!response || typeof response.data !== 'string' || !Number.isSafeInteger(response.bytesRead)) {
			throw new Error('Android returnerade ogiltiga fildata.');
		}
		const bytes = decodeBase64(response.data);
		if (bytes.length !== response.bytesRead || bytes.length > want) throw new Error('Android returnerade fel filstorlek.');
		return bytes;
	};
	return { file: new NativePickedFileHandle(file, read), path: file.path || file.name };
}
