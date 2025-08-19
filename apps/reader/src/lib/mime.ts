/**
 * Get MIME type for image based on file extension
 */
export function mimeFor(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	
	const mimeMap: Record<string, string> = {
		avif: 'image/avif',
		webp: 'image/webp',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		bmp: 'image/bmp',
		gif: 'image/gif'
	};

	return mimeMap[ext || 'jpg'] || 'image/jpeg';
}
