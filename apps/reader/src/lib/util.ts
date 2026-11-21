/** Tiny shared helpers. Pure, no browser APIs at import time. */

/** cyrb53 hash → short base36 string. Deterministic, not cryptographic. */
export function hash(s: string): string {
	let h1 = 0xdeadbeef,
		h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** ASCII url-safe slug. å/ä→a, ö→o, diacritics stripped. May return '' for non-latin input. */
export function slugify(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const collator = new Intl.Collator('sv', { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

export const uniq = <T>(a: T[]): T[] => [...new Set(a)];
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with at most `limit` in flight. Errors from fn must be handled by fn. */
export async function runPool<T>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<void>,
	signal?: AbortSignal
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length && !signal?.aborted) {
			const i = next++;
			await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
