/**
 * Online series metadata (docs/architecture.md → "Metadata"): Wikipedia/Wikidata, AniList (manga), Google Books, Open Library.
 * Keyless + CORS-enabled sources only; ≤ 2 requests in flight overall, 8 s timeout each (net.ts). Pure modules, runs in the browser.
 */
import { normalizePublisher } from '../parse/publishers.ts';
import type { MetaCandidate, MetaQuery, SeriesMeta } from '../types.ts';
import { anilist } from './anilist.ts';
import { googleBooks } from './googlebooks.ts';
import { choose, fillGaps, isComplete, rankCandidates, type Raw, type Scored } from './match.ts';
import { openLibrary } from './openlibrary.ts';
import type { Source } from './shared.ts';
import { cleanDescription } from './text.ts';
import { wikipedia } from './wikipedia.ts';

type Run = { raws: Raw[]; ok: boolean };

const safePublisher = (s?: string): string | undefined => {
	try {
		return normalizePublisher(s);
	} catch {
		return s?.trim() || undefined;
	}
};

/** Run sources concurrently (net.ts caps the requests in flight); a failing source yields ok:false instead of throwing. */
const run = (sources: Source[], q: MetaQuery, signal?: AbortSignal): Promise<Run[]> =>
	Promise.all(
		sources.map(async (fn): Promise<Run> => {
			try {
				return { raws: await fn(q, signal), ok: true };
			} catch {
				return { raws: [], ok: false };
			}
		})
	);

/** Public candidate: internal `kind` dropped, publisher normalised. */
const publish = (c: Scored): MetaCandidate => ({
	source: c.source, title: c.title, url: c.url, description: c.description, publisher: safePublisher(c.publisher), genres: c.genres,
	startYear: c.startYear, endYear: c.endYear, creators: c.creators, related: c.related, status: c.status, score: c.score
});

/** Best accepted candidate with its gaps filled from the other plausible ones. */
function resolve(q: MetaQuery, runs: Run[]): MetaCandidate | undefined {
	const pick = choose(q, rankCandidates(q, runs.flatMap((r) => r.raws)));
	return pick && fillGaps(publish(pick.best), pick.fill.map(publish));
}

/** Query all enabled online sources in parallel; return candidates best-first (score 0..1). Network errors per source are swallowed. */
export async function searchMeta(q: MetaQuery, signal?: AbortSignal): Promise<MetaCandidate[]> {
	const query = { ...q, name: q.name.trim() };
	if (signal?.aborted || !query.name) return [];
	const runs = await run([wikipedia, anilist, googleBooks, openLibrary], query, signal);
	return rankCandidates(query, runs.flatMap((r) => r.raws))
		.filter((c) => c.score > 0)
		.slice(0, 20)
		.map(publish);
}

/** Convert a chosen candidate into the persisted SeriesMeta (fetchedAt = now). */
export function candidateToMeta(seriesId: string, c: MetaCandidate, userEdited = false): SeriesMeta {
	const m: SeriesMeta = {
		seriesId, name: c.title, description: cleanDescription(c.description), publisher: safePublisher(c.publisher), startYear: c.startYear, endYear: c.endYear,
		genres: c.genres?.filter(Boolean), creators: c.creators?.filter(Boolean), related: c.related?.filter(Boolean), status: c.status,
		source: c.source, sourceUrl: c.url, matchedTitle: c.title, confidence: Math.max(0, Math.min(1, c.score)), fetchedAt: Date.now()
	};
	if (userEdited) m.userEdited = true;
	return m;
}

/**
 * Auto-match. Wikipedia (+ AniList for manga) first; Google Books / Open Library (and AniList when the series is not known to be manga,
 * but only if nothing matched yet) when nothing confident came back or the best hit still lacks publisher/year/genres/creators/description.
 * Nothing confident after the primary source(s) answered → notFound. A primary source failing (offline, 429 …) or an abort → undefined
 * (retry later; never notFound, a rate-limited Wikipedia must not mark a series as unknown).
 */
export async function fetchSeriesMeta(seriesId: string, q: MetaQuery, signal?: AbortSignal): Promise<SeriesMeta | undefined> {
	const query = { ...q, name: q.name.trim() };
	if (signal?.aborted) return undefined;
	if (!query.name) return { seriesId, notFound: true, fetchedAt: Date.now() };
	const runs = await run(query.manga ? [anilist, wikipedia] : [wikipedia], query, signal);
	const primaryOk = runs.every((r) => r.ok);
	let best = resolve(query, runs);
	if (!best || !isComplete(best)) {
		const fallbackAniList = query.manga === undefined && !best && primaryOk ? [anilist] : [];
		runs.push(...(await run([...fallbackAniList, googleBooks, openLibrary], query, signal)));
		best = resolve(query, runs);
	}
	if (signal?.aborted) return undefined;
	if (best) return candidateToMeta(seriesId, best);
	return primaryOk ? { seriesId, notFound: true, fetchedAt: Date.now() } : undefined;
}
