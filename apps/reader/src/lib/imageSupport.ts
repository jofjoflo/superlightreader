/**
 * Real image-format detection: decode tiny data-URI images through <img> and see whether the browser accepts them.
 * The result is cached for the session (one probe, shared by every caller).
 */

// 2×2 AVIF (the Modernizr/libavif feature-test image) and a 1×1 lossy WebP.
const AVIF =
	'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEAwgMg8f8D///8WfhwB8+ErK42A=';
const WEBP = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

export interface ImageSupport {
	avif: boolean;
	webp: boolean;
	jpeg: true;
	png: true;
}

function canDecode(src: string): Promise<boolean> {
	if (typeof Image === 'undefined') return Promise.resolve(false);
	return new Promise((resolve) => {
		const img = new Image();
		const finish = (ok: boolean) => {
			clearTimeout(timer);
			img.onload = null;
			img.onerror = null;
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), 3000);
		img.onload = () => finish(img.width > 0 && img.height > 0);
		img.onerror = () => finish(false);
		img.src = src;
	});
}

let probe: Promise<ImageSupport> | undefined;

/** Which image formats this browser can show. JPEG and PNG are always supported. */
export function checkImageSupport(): Promise<ImageSupport> {
	probe ??= Promise.all([canDecode(AVIF), canDecode(WEBP)]).then(([avif, webp]) => ({ avif, webp, jpeg: true as const, png: true as const }));
	return probe;
}
