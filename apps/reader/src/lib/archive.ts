import { unzipSync } from 'fflate';

export interface ComicPage {
	name: string;
	data: Uint8Array;
}

/**
 * Read and extract pages from a CBZ or CBR file
 */
export async function readCbz(file: File): Promise<ComicPage[]> {
	const fileName = file.name.toLowerCase();
	
	if (fileName.endsWith('.cbr')) {
		throw new Error('CBR files are not supported in the web reader. Please convert to CBZ format first using the converter tool.');
	}
	
	if (!fileName.endsWith('.cbz')) {
		throw new Error('Only CBZ files are supported in the web reader.');
	}
	
	const buffer = new Uint8Array(await file.arrayBuffer());
	const entries = unzipSync(buffer);

	const pages = Object.keys(entries)
		.filter((name) => /\.(avif|webp|jpe?g|png|bmp)$/i.test(name))
		.sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare)
		.map((name) => ({
			name,
			data: entries[name]
		}));

	return pages;
}

/**
 * Create a blob URL for a page
 */
export function createPageUrl(page: ComicPage, mimeType: string): string {
	const blob = new Blob([page.data], { type: mimeType });
	return URL.createObjectURL(blob);
}

/**
 * Cleanup URLs by revoking them
 */
export function cleanupUrls(urls: string[]): void {
	urls.forEach((url) => URL.revokeObjectURL(url));
}
