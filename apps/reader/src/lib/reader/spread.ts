/**
 * Pure reader logic: which pages share a screen, where a tap/swipe leads, what to keep preloaded.
 * No imports and only erasable TS, so `node --test` can run it.
 *
 * Pages are 0-based indices. A "spread" is the list of page indices shown together (ascending, i.e. reading
 * order); `visualOrder` flips it for right-to-left so it can be laid out left → right.
 */

export type Zone = 'left' | 'center' | 'right';
/** True when the page must be shown alone (flagged double-page in ComicInfo, or wider than tall). */
export type WideFn = (index: number) => boolean;

export function resolveRtl(setting: 'auto' | 'ltr' | 'rtl', issueRtl?: boolean, seriesRtl?: boolean): boolean {
	return setting === 'auto' ? !!(issueRtl || seriesRtl) : setting === 'rtl';
}

/** `auto` = two pages when the window is landscape. */
export function wantsSpread(setting: 'auto' | 'single' | 'double', width: number, height: number): boolean {
	return setting === 'double' || (setting === 'auto' && width > height * 1.1);
}

/**
 * The spread that starts at `start`. The cover (page 0) and wide pages are always alone, and a page is alone
 * when the next one is wide. Single mode: every page alone.
 */
export function spreadFrom(start: number, count: number, paired: boolean, wide: WideFn): number[] {
	if (start < 0 || start >= count) return [];
	if (!paired || start === 0 || wide(start) || start + 1 >= count || wide(start + 1)) return [start];
	return [start, start + 1];
}

/**
 * Start of the spread that contains `index`, using the canonical partition walked from page 0
 * (cover | 1 2 | 3 4 | …, restarting after every wide page).
 */
export function spreadStartOf(index: number, count: number, paired: boolean, wide: WideFn): number {
	if (count <= 0) return 0;
	const target = Math.min(Math.max(0, Math.trunc(index) || 0), count - 1);
	if (!paired) return target;
	let start = 0;
	while (start <= target) {
		const length = spreadFrom(start, count, paired, wide).length;
		if (target < start + length) return start;
		start += length;
	}
	return target;
}

/** Start of the spread after the one starting at `start`; undefined past the end. */
export function nextStart(start: number, count: number, paired: boolean, wide: WideFn): number | undefined {
	const next = start + Math.max(1, spreadFrom(start, count, paired, wide).length);
	return next < count ? next : undefined;
}

/** Start of the spread before the one starting at `start`; undefined before the first page. */
export function prevStart(start: number, count: number, paired: boolean, wide: WideFn): number | undefined {
	return start <= 0 ? undefined : spreadStartOf(start - 1, count, paired, wide);
}

export function lastStart(count: number, paired: boolean, wide: WideFn): number {
	return spreadStartOf(count - 1, count, paired, wide);
}

/** Left → right order on screen. */
export function visualOrder(pages: number[], rtl: boolean): number[] {
	return rtl ? [...pages].reverse() : [...pages];
}

/** Screen thirds: 30 % / 40 % / 30 % of the width. `ratio` = x / width. */
export function tapZone(ratio: number): Zone {
	return ratio < 0.3 ? 'left' : ratio > 0.7 ? 'right' : 'center';
}

/** +1 forward, -1 back, 0 none (centre). Right-to-left swaps the sides. */
export function zoneDirection(zone: Zone, rtl: boolean): -1 | 0 | 1 {
	if (zone === 'center') return 0;
	return (zone === 'right') !== rtl ? 1 : -1;
}

/** `dx` < 0 = the finger moved left. */
export function swipeDirection(dx: number, rtl: boolean): -1 | 1 {
	return dx < 0 !== rtl ? 1 : -1;
}

/**
 * Pages to keep decoded, most urgent first: the shown ones, then ahead in reading order, then behind.
 * Single page: [current−1 … current+preload+1]; two-page spread: one extra page on each side.
 */
export function preloadOrder(shown: number[], count: number, preload: number, paired: boolean): number[] {
	if (!shown.length) return [];
	const first = shown[0];
	const last = shown[shown.length - 1];
	const per = paired ? 2 : 1;
	const ahead = (Number.isFinite(preload) ? Math.max(0, Math.floor(preload)) : 2) + per;
	const out = [...shown];
	for (let i = last + 1; i <= Math.min(count - 1, last + ahead); i++) out.push(i);
	for (let i = first - 1; i >= Math.max(0, first - per); i--) out.push(i);
	return out;
}

/** "7 / 32", or "6–7 / 32" for a spread. */
export function pageLabel(shown: number[], count: number): string {
	if (!shown.length) return '';
	const a = shown[0] + 1;
	const b = shown[shown.length - 1] + 1;
	return `${a === b ? a : `${a}–${b}`} / ${count}`;
}
