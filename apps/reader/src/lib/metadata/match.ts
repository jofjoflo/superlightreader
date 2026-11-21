/** Scoring, ranking and gap filling of metadata candidates. Pure (no I/O, no publisher normalisation: index.ts does that). */
import type { MetaCandidate, MetaQuery } from '../types.ts';

/** What a source says the hit *is*; hits that are not comics get a heavy penalty (films, TV, games, novels). */
export type Kind = 'series' | 'character' | 'media' | 'unknown';
export type Raw = Omit<MetaCandidate, 'score'> & { kind?: Kind };
export type Scored = MetaCandidate & { kind?: Kind };

/** Auto-accept threshold, and the lower bar for lending missing fields to the accepted candidate. */
export const ACCEPT = 0.72;
export const FILL = 0.6;

const STOP = new Set('the a an and of en ett och'.split(' '));
const VOLUME = /[\s,:;–—-]*\b(?:vol(?:ume)?s?|bk|book|part|issue|nr|no|del|band)\.?\s*#?\d+\b.*$/i;
const MEDIA_TITLE =
	/\((?:[^()]*\s)?(?:film|movie|tv|television|miniseries|video ?game|game|novel|anime|album|soundtrack|musical|play|podcast|radio)(?:\s[^()]*)?\)|:\s*the\s+(?:movie|film|video ?game)\b/i;
const COMMON = new Set(
	'the a an en ett long road way home life love story world night day last one man woman girl boy dark new old big little black white red blue'.split(' ')
);
const PUB_NOISE = /\b(?:comics?|entertainment|publishing|publications?|press|inc|llc|ltd|group|media|studios?|books?|forlag|forlaget|verlag|editions?)\b/g;
const KIND_RANK: Record<Kind, number> = { series: 0, character: 1, unknown: 2, media: 3 };

/** "The Walking Dead (comic book series)" / "Saga, Vol. 1" / "Déjà Vu 2012" → lowercase ASCII-ish words without article, volume, year, brackets. */
export function titleKey(s: string): string {
	const base = s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.replace(/&/g, ' and ')
		.replace(VOLUME, ' ');
	const plain = base.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	const noYear = plain.replace(/\b(?:1[89]|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
	return (noYear || plain).replace(/^(?:the|an?|en|ett)\s+/, '');
}

/** "Saga, Vol. 1: Part One" → "Saga". */
export const baseTitle = (s: string): string => s.replace(VOLUME, '').replace(/[\s,:;–—-]+$/, '').trim() || s.trim();

const tokens = (s: string): string[] => {
	const all = titleKey(s).split(' ').filter(Boolean);
	const t = all.filter((w) => !STOP.has(w));
	return t.length ? t : all;
};

/** 0..1: exact (after normalisation) = 1, same letters ignoring spaces ("Spider-Man"/"Spiderman") = .97, else token-Jaccard blended with a prefix bonus (max .9). */
export function titleSimilarity(a: string, b: string): number {
	const x = tokens(a), y = tokens(b);
	if (!x.length || !y.length) return 0;
	if (x.join(' ') === y.join(' ')) return 1;
	if (x.join('') === y.join('')) return 0.97;
	const sx = new Set(x), sy = new Set(y);
	let inter = 0;
	for (const t of sx) if (sy.has(t)) inter++;
	const jaccard = inter / (sx.size + sy.size - inter);
	const [s, l] = x.length <= y.length ? [x, y] : [y, x];
	const prefix = s.every((t, i) => l[i] === t) ? s.length / l.length : 0;
	return Math.min(0.9, 0.7 * jaccard + 0.3 * prefix);
}

const pubTokens = (s: string): string[] => titleKey(s).replace(PUB_NOISE, ' ').split(' ').filter(Boolean);
export function samePublisher(a?: string, b?: string): boolean {
	const x = a ? pubTokens(a) : [], y = b ? pubTokens(b) : [];
	if (!x.length || !y.length) return false;
	const [s, l] = x.length <= y.length ? [x, y] : [y, x];
	return s.every((t) => l.includes(t));
}

const sameName = (a: string, b: string): boolean => {
	const x = tokens(a), y = tokens(b);
	const [s, l] = x.length <= y.length ? [x, y] : [y, x];
	return s.length > 0 && s.some((t) => t.length >= 3) && s.every((t) => l.includes(t));
};
export const creatorMatch = (a?: string[], b?: string[]): boolean => !!a?.length && !!b?.length && a.some((x) => b.some((y) => sameName(x, y)));

/** Year (±1), publisher or creator agree with what the library knows about the series. */
export function hasContext(q: MetaQuery, c: Pick<MetaCandidate, 'startYear' | 'publisher' | 'creators'>): boolean {
	return (!!q.year && !!c.startYear && Math.abs(q.year - c.startYear) <= 1) || samePublisher(q.publisher, c.publisher) || creatorMatch(q.creators, c.creators);
}

/** Title similarity (+ a small year/publisher/creator bonus once the title is plausible) minus penalties: film/TV/game/novel hits heavily, unverified hits, characters and book catalogues slightly. 0..1. */
export function scoreCandidate(q: MetaQuery, c: Raw): number {
	let s = titleSimilarity(q.name, c.title);
	if (s >= 0.5) {
		let bonus = 0;
		if (q.year && c.startYear && Math.abs(q.year - c.startYear) <= 1) bonus += 0.04;
		if (samePublisher(q.publisher, c.publisher)) bonus += 0.04;
		if (creatorMatch(q.creators, c.creators)) bonus += 0.04;
		s += Math.min(bonus, 0.1);
	}
	if (c.kind === 'media' || MEDIA_TITLE.test(c.title)) s -= 0.5;
	else if (c.kind === 'unknown') s -= 0.08;
	else if (c.kind === 'character') s -= 0.01;
	if (c.source === 'googlebooks' || c.source === 'openlibrary') s -= 0.02; // catalogues: volumes/editions, noisier than Wikipedia/AniList
	return Math.max(0, Math.min(1, s));
}

const preference = (q: MetaQuery): string[] => (q.manga ? ['anilist', 'wikipedia', 'googlebooks', 'openlibrary'] : ['wikipedia', 'anilist', 'googlebooks', 'openlibrary']);

/** Score everything and sort best-first (ties: series before characters before unverified hits, then source preference; AniList first for manga). */
export function rankCandidates(q: MetaQuery, raws: Raw[]): Scored[] {
	const pref = preference(q);
	return raws
		.map((r) => ({ ...r, score: scoreCandidate(q, r) }))
		.sort((a, b) => b.score - a.score || KIND_RANK[a.kind ?? 'series'] - KIND_RANK[b.kind ?? 'series'] || pref.indexOf(a.source) - pref.indexOf(b.source));
}

/** Short generic titles ("The Long Road") match too many unrelated works to trust on title alone. */
export function isGeneric(name: string): boolean {
	const w = titleKey(name).split(' ').filter(Boolean);
	return w.length <= 3 && w.filter((x) => COMMON.has(x)).length >= 2;
}

/** Best candidate ≥ ACCEPT (generic titles also need year/publisher/creator corroboration or two agreeing sources) plus the ≥ FILL candidates that may lend missing fields. */
export function choose(q: MetaQuery, ranked: Scored[]): { best: Scored; fill: Scored[] } | undefined {
	const best = ranked.find((c) => c.score >= ACCEPT);
	if (!best) return undefined;
	if (isGeneric(best.title) && !hasContext(q, best)) {
		const key = titleKey(best.title);
		const agreeing = new Set(ranked.filter((c) => c.score >= ACCEPT && titleKey(c.title) === key).map((c) => c.source));
		if (agreeing.size < 2) return undefined;
	}
	// lenders in source order (Wikidata before book catalogues: its start year beats the first collected volume), then by score
	const pref = preference(q);
	const fill = ranked.filter((c) => c !== best && c.score >= FILL && c.kind !== 'media');
	return { best, fill: fill.sort((a, b) => pref.indexOf(a.source) - pref.indexOf(b.source) || b.score - a.score) };
}

const FIELDS = ['description', 'publisher', 'genres', 'startYear', 'endYear', 'creators', 'related', 'status'] as const;
const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '');

/** Copy of `best` with every missing field taken from the first filler that has it (an ongoing series never gets an end year). */
export function fillGaps<T extends MetaCandidate>(best: T, fill: MetaCandidate[]): T {
	const out: T = { ...best };
	for (const f of FIELDS) {
		if (has(out[f]) || (f === 'endYear' && out.status === 'ongoing')) continue;
		const src = fill.find((c) => has(c[f]));
		if (src) (out as Record<string, unknown>)[f] = src[f];
	}
	if (out.endYear && out.startYear && out.endYear < out.startYear) delete out.endYear;
	return out;
}

/** Nothing worth asking further sources for. */
export const isComplete = (c: MetaCandidate): boolean => !!(c.publisher && c.startYear && c.genres?.length && c.creators?.length && c.description);
