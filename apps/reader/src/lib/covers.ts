import type { CoverResult } from './types.ts';

/** Browser only (createImageBitmap + canvas). */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface Surface {
	ctx: Ctx;
	encode(type: string, quality: number): Promise<Blob | null>;
}

const SWATCH = 24; // px; the colour is sampled from a SWATCH×SWATCH downscale

function surface(w: number, h: number): Surface {
	if (typeof OffscreenCanvas !== 'undefined') {
		const c = new OffscreenCanvas(w, h);
		return { ctx: c.getContext('2d')!, encode: (type, quality) => c.convertToBlob({ type, quality }) };
	}
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return { ctx: c.getContext('2d')!, encode: (type, quality) => new Promise((res) => c.toBlob(res, type, quality)) };
}

/** Opaque white backdrop (jpeg has no alpha), then the image scaled to w×h. */
function paint(ctx: Ctx, bmp: ImageBitmap, w: number, h: number): void {
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, w, h);
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bmp, 0, 0, w, h);
}

/** Resize while decoding so huge AVIF/JPEG pages need not be held at full size; plain decode if the options are unsupported. */
async function decode(image: Blob, maxWidth: number): Promise<ImageBitmap> {
	try {
		return await createImageBitmap(image, { resizeWidth: maxWidth, resizeQuality: 'high' });
	} catch {
		return createImageBitmap(image); // rejects again if the image really is undecodable
	}
}

/**
 * Saturation-weighted mean of RGBA pixels, ignoring near-black and near-white ones.
 * Falls back to the plain mean when nothing is coloured (black & white covers).
 */
export function dominantColor(rgba: ArrayLike<number>): string {
	let r = 0, g = 0, b = 0, w = 0; // saturation-weighted sums
	let sr = 0, sg = 0, sb = 0; // plain sums
	for (let i = 0; i < rgba.length; i += 4) {
		const pr = rgba[i], pg = rgba[i + 1], pb = rgba[i + 2];
		sr += pr;
		sg += pg;
		sb += pb;
		const max = Math.max(pr, pg, pb);
		const min = Math.min(pr, pg, pb);
		if (max < 30 || min > 225) continue;
		const sat = (max - min) / max;
		r += pr * sat;
		g += pg * sat;
		b += pb * sat;
		w += sat;
	}
	const n = rgba.length / 4 || 1;
	const rgb = w > 0 ? [r / w, g / w, b / w] : [sr / n, sg / n, sb / n];
	return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Decode `image`, downscale to maxWidth (default 400), encode webp (fallback jpeg), compute dominant color. */
export async function makeCover(image: Blob, maxWidth = 400): Promise<CoverResult> {
	const bmp = await decode(image, maxWidth);
	try {
		const width = Math.min(bmp.width, maxWidth);
		const height = Math.max(1, Math.round((bmp.height * width) / bmp.width));
		const cover = surface(width, height);
		paint(cover.ctx, bmp, width, height);
		let blob = await cover.encode('image/webp', 0.82);
		if (blob?.type !== 'image/webp') blob = await cover.encode('image/jpeg', 0.85); // webp encoding unsupported
		if (!blob) throw new Error('Kunde inte koda omslaget');

		const swatch = surface(SWATCH, SWATCH);
		paint(swatch.ctx, bmp, SWATCH, SWATCH);
		const color = dominantColor(swatch.ctx.getImageData(0, 0, SWATCH, SWATCH).data);
		return { blob, width, height, color };
	} finally {
		bmp.close();
	}
}
