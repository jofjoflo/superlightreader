/**
 * Pure pan/zoom + layout maths for the reader. No imports, only erasable TS (tested with `node --test`).
 *
 * Model: the shown pages are laid out into one `content` box (px) by `layoutPages`. The box is drawn with
 * `translate(x, y) scale(s)` and transform-origin 0 0, so (x, y) is where its top-left corner lands in the
 * viewport and `s` is the user zoom on top of the fit (1 = as fitted).
 */

export interface Size {
	w: number;
	h: number;
}
export interface View {
	s: number;
	x: number;
	y: number;
}
export type Fit = 'screen' | 'width' | 'height';

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2.5;
const FALLBACK_RATIO = 2 / 3;

/** Above this the user counts as zoomed (tap zones and swiping are off). */
export const isZoomed = (v: View): boolean => v.s > 1.02;

export interface PageLayout {
	content: Size;
	/** Width of each page, same order as the ratios passed in. */
	widths: number[];
	/** Shared height of every page. */
	height: number;
}

/**
 * Lay pages (width/height ratios, left → right) side by side at one shared height.
 * screen: whole spread fits the viewport; width: spread spans the viewport width (may be taller);
 * height: spread is as tall as the viewport (may be wider). Unknown ratios fall back to 2:3.
 */
export function layoutPages(ratios: number[], viewport: Size, fit: Fit): PageLayout {
	const r = ratios.map((x) => (x > 0 && Number.isFinite(x) ? x : FALLBACK_RATIO));
	const total = r.reduce((a, b) => a + b, 0);
	if (!total || viewport.w <= 0 || viewport.h <= 0) return { content: { w: 0, h: 0 }, widths: r.map(() => 0), height: 0 };
	const byWidth = viewport.w / total;
	const height = Math.max(1, Math.round(fit === 'width' ? byWidth : fit === 'height' ? viewport.h : Math.min(viewport.h, byWidth)));
	const widths = r.map((x) => Math.max(1, Math.round(height * x)));
	return { content: { w: widths.reduce((a, b) => a + b, 0), h: height }, widths, height };
}

/** Content smaller than the viewport is centred; larger content may not leave a gap at either edge. */
export function clampAxis(pos: number, content: number, viewport: number): number {
	if (content <= viewport) return (viewport - content) / 2;
	return Math.min(0, Math.max(viewport - content, pos));
}

export function clampView(v: View, content: Size, viewport: Size): View {
	const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
	return { s, x: clampAxis(v.x, content.w * s, viewport.w), y: clampAxis(v.y, content.h * s, viewport.h) };
}

/** Scale to `s` about the viewport point (px, py): the content point under it stays put. */
export function zoomAt(v: View, s: number, px: number, py: number, content: Size, viewport: Size): View {
	const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
	const k = next / v.s;
	return clampView({ s: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, content, viewport);
}

/**
 * Two-finger gesture: `start` is the view when the pinch began, (c0, d0) its centre and finger distance,
 * (c, d) the same now. The content point under the first centre follows the current centre (zoom + pan).
 */
export function pinchView(
	start: View,
	c0: { x: number; y: number },
	d0: number,
	c: { x: number; y: number },
	d: number,
	content: Size,
	viewport: Size
): View {
	const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.s * (d / d0)));
	const k = s / start.s;
	return clampView({ s, x: c.x - (c0.x - start.x) * k, y: c.y - (c0.y - start.y) * k }, content, viewport);
}

/** Pan by (dx, dy); `overX/overY` is the part that did not fit (used to detect "swiped past the edge"). */
export function panBy(v: View, dx: number, dy: number, content: Size, viewport: Size): { view: View; overX: number; overY: number } {
	const x = clampAxis(v.x + dx, content.w * v.s, viewport.w);
	const y = clampAxis(v.y + dy, content.h * v.s, viewport.h);
	return { view: { s: v.s, x, y }, overX: dx - (x - v.x), overY: dy - (y - v.y) };
}

/** Unzoomed view where reading starts: top of a tall page, the reading-start edge of a wide one, else centred. */
export function anchorView(content: Size, viewport: Size, rtl: boolean): View {
	return clampView({ s: 1, x: rtl ? -Infinity : 0, y: 0 }, content, viewport);
}
