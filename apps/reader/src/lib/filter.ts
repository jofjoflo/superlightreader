import type { Facet, Facets, Filters, Series, SortKey } from './types.ts';
import { naturalCompare, uniq } from './util.ts';

export const defaultFilters: Filters = {
	q: '',
	creator: '',
	publishers: [],
	genres: [],
	decades: [],
	status: 'all',
	kind: 'all',
	sort: 'name',
	desc: false
};

const STATUS: Record<Filters['status'], (s: Series) => boolean> = {
	all: () => true,
	unread: (s) => s.state === 'unread',
	reading: (s) => s.state === 'reading',
	done: (s) => s.state === 'done',
	favorites: (s) => s.favorite
};

const KIND: Record<Filters['kind'], (s: Series) => boolean> = {
	all: () => true,
	series: (s) => !s.oneShot,
	oneshot: (s) => s.oneShot,
	manga: (s) => s.rtl,
	complete: (s) => s.complete
};

/** Numeric sort keys (ascending order); `undefined` = missing, always sorted last. `name` is handled separately. */
const SORT_VALUE: Record<Exclude<SortKey, 'name'>, (s: Series) => number | undefined> = {
	added: (s) => s.addedAt,
	read: (s) => s.lastReadAt,
	year: (s) => s.startYear,
	issues: (s) => s.issueCount,
	rating: (s) => s.rating,
	progress: (s) => s.progress
};

const STATUSES = Object.keys(STATUS) as Filters['status'][];
const KINDS = Object.keys(KIND) as Filters['kind'][];
const SORTS = ['name', ...Object.keys(SORT_VALUE)] as SortKey[];

/** Lowercase, accents stripped ("Åke" → "ake"). */
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const decadeOf = (year: number): number => Math.floor(year / 10) * 10;

/** Alphabetical by sortKey (sv collation), then id so the order is total. */
const byName = (a: Series, b: Series): number =>
	naturalCompare(a.sortKey, b.sortKey) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Series.creators is intentionally capped for card display; filters still search every issue-level Metron creator. */
const creatorsOf = (s: Series): string[] => [...s.creators, ...s.issues.flatMap((i) => i.metron?.creators ?? [])];

/**
 * Filter + sort. Pure; does not mutate input.
 * `q`: every whitespace-separated word must occur in name/publisher/genres/creators (case + accent insensitive).
 * Sort is ascending unless `desc`; series missing the sort value always come last; ties fall back to name.
 */
export function applyFilters(series: Series[], f: Filters): Series[] {
	const words = fold(f.q).split(/\s+/).filter(Boolean);
	const creator = fold(f.creator.trim());
	const publishers = new Set(f.publishers);
	const genres = new Set(f.genres);
	const decades = new Set(f.decades);
	const status = STATUS[f.status];
	const kind = KIND[f.kind];

	const out = series.filter((s) => {
		const creators = creatorsOf(s);
		if (!status(s) || !kind(s)) return false;
		if (creator && !creators.some((c) => fold(c.trim()) === creator)) return false;
		if (publishers.size && !publishers.has(s.publisher)) return false;
		if (genres.size && !s.genres.some((g) => genres.has(g))) return false;
		if (decades.size && (s.startYear === undefined || !decades.has(decadeOf(s.startYear)))) return false;
		if (words.length) {
			const hay = fold([s.name, s.publisher, ...s.genres, ...creators].join('\n'));
			if (!words.every((w) => hay.includes(w))) return false;
		}
		return true;
	});

	const dir = f.desc ? -1 : 1;
	if (f.sort === 'name') return out.sort((a, b) => dir * naturalCompare(a.sortKey, b.sortKey) || byName(a, b));
	const value = SORT_VALUE[f.sort];
	return out.sort((a, b) => {
		const x = value(a);
		const y = value(b);
		if (x === undefined || y === undefined) return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) || byName(a, b);
		return dir * (x - y) || byName(a, b);
	});
}

function facets<T>(counts: Map<T, number>, compare: (a: T, b: T) => number): Facet<T>[] {
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || compare(a.value, b.value));
}

/** Facet counts computed over `series` (caller passes the full or already-filtered list). Sorted by count desc, then name. */
export function computeFacets(series: Series[]): Facets {
	const publishers = new Map<string, number>();
	const genres = new Map<string, number>();
	const decades = new Map<number, number>();
	const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
	for (const s of series) {
		bump(publishers, s.publisher);
		for (const g of s.genres) bump(genres, g);
		if (s.startYear !== undefined) bump(decades, decadeOf(s.startYear));
	}
	return {
		publishers: facets(publishers, naturalCompare),
		genres: facets(genres, naturalCompare),
		decades: facets(decades, (a, b) => a - b)
	};
}

/** Number of non-default filter fields (q, creator, publishers, genres, decades, status, kind). Sort is not counted. */
export function countActiveFilters(f: Filters): number {
	return [
		f.q.trim() !== '',
		f.creator.trim() !== '',
		f.publishers.length > 0,
		f.genres.length > 0,
		f.decades.length > 0,
		f.status !== defaultFilters.status,
		f.kind !== defaultFilters.kind
	].filter(Boolean).length;
}

const pick = <T extends string>(allowed: readonly T[], v: string | null, fallback: T): T =>
	allowed.find((a) => a === v) ?? fallback;

/** URL ↔ Filters. Params: q, creator, publisher (repeatable), genre (repeatable), decade (repeatable), status, kind, sort, desc=1. Omit defaults. */
export function filtersFromParams(p: URLSearchParams): Filters {
	return {
		q: p.get('q') ?? '', // not trimmed: the search box may sync through the URL while the user types a space
		creator: p.get('creator') ?? '',
		publishers: uniq(p.getAll('publisher').filter(Boolean)),
		genres: uniq(p.getAll('genre').filter(Boolean)),
		decades: uniq(p.getAll('decade').filter((v) => /^\d{4}$/.test(v) && Number(v) % 10 === 0).map(Number)),
		status: pick(STATUSES, p.get('status'), defaultFilters.status),
		kind: pick(KINDS, p.get('kind'), defaultFilters.kind),
		sort: pick(SORTS, p.get('sort'), defaultFilters.sort),
		desc: p.get('desc') === '1'
	};
}

export function filtersToParams(f: Filters): URLSearchParams {
	const p = new URLSearchParams();
	if (f.q) p.set('q', f.q);
	if (f.creator) p.set('creator', f.creator);
	for (const v of f.publishers) p.append('publisher', v);
	for (const v of f.genres) p.append('genre', v);
	for (const v of f.decades) p.append('decade', String(v));
	if (f.status !== defaultFilters.status) p.set('status', f.status);
	if (f.kind !== defaultFilters.kind) p.set('kind', f.kind);
	if (f.sort !== defaultFilters.sort) p.set('sort', f.sort);
	if (f.desc) p.set('desc', '1');
	return p;
}
