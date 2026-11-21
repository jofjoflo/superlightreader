/** Small helpers shared by the source modules. Pure. */
import { isKnownPublisher } from '../parse/publishers.ts';
import type { MetaQuery } from '../types.ts';
import type { Raw } from './match.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;
/** A source resolves to raw (unscored) candidates, or throws (NetError etc.) when it could not be reached. */
export type Source = (q: MetaQuery, signal?: AbortSignal) => Promise<Raw[]>;

export const qs = (o: Record<string, string>): string => new URLSearchParams(o).toString();
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : []);

const JUNK_PUBLISHER = /independent|createspace|\blulu\b|self[- ]?publish|amazon|kindle|turtleback|perfection learning|\bs\.?\s?n\.?\b|unknown/i;
const LEGAL_SUFFIX = /[,\s]+(?:llc|inc\.?|ltd\.?|gmbh|s\.?a\.?|ab|as|co\.?)$/i;
/** Most common sensible publisher: known brands first ("Viz Media, LLC" counts as VIZ Media), self-publishing and library-rebinder noise ignored. */
export function pickPublisher(values: string[]): string | undefined {
	const common = top(values.filter((v) => !JUNK_PUBLISHER.test(v)), 8);
	const known = common.find((v) => isKnownPublisher(v.replace(LEGAL_SUFFIX, '')));
	return known ? known.replace(LEGAL_SUFFIX, '') : common[0];
}

/** Four-digit year at the start of a date-ish value ("2012-10-10", 2012, "+1939-00-00T00:00:00Z"), 1800..2100. */
export function yearOf(v: unknown): number | undefined {
	const m = /^\s*\+?(\d{4})/.exec(String(v ?? ''));
	const n = m ? +m[1] : NaN;
	return n >= 1800 && n <= 2100 ? n : undefined;
}
export const minOf = (a: Array<number | undefined>): number | undefined => {
	const n = a.filter((x): x is number => typeof x === 'number');
	return n.length ? Math.min(...n) : undefined;
};
export const maxOf = (a: Array<number | undefined>): number | undefined => {
	const n = a.filter((x): x is number => typeof x === 'number');
	return n.length ? Math.max(...n) : undefined;
};

/** Distinct values, most frequent first (ties keep first-seen order), case-insensitive, at most `max`. */
export function top(values: string[], max: number): string[] {
	const seen = new Map<string, { v: string; n: number }>();
	for (const v of values) {
		const k = v.toLowerCase();
		const e = seen.get(k);
		if (e) e.n++;
		else seen.set(k, { v, n: 1 });
	}
	return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, max).map((e) => e.v);
}
