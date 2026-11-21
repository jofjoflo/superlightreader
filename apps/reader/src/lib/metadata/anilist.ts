// CORS verified: POST https://graphql.anilist.co with content-type: application/json → access-control-allow-origin: *; OPTIONS preflight (request-method POST, request-headers content-type) → 204, allow-methods GET, POST, OPTIONS, allow-headers incl. Content-Type.
import type { MetaQuery } from '../types.ts';
import { titleSimilarity, type Raw } from './match.ts';
import { NetError, fetchJson } from './net.ts';
import { str, strings, top, type Json } from './shared.ts';
import { cleanDescription } from './text.ts';

const QUERY =
	'query ($search: String) { Page(perPage: 8) { media(search: $search, type: MANGA, sort: SEARCH_MATCH) { format title { romaji english native } synonyms description genres startDate { year } endDate { year } status siteUrl staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } } recommendations(perPage: 6, sort: RATING_DESC) { nodes { mediaRecommendation { title { romaji english } } } } } } }';

export async function anilist(q: MetaQuery, signal?: AbortSignal): Promise<Raw[]> {
	const json = await fetchJson(
		'https://graphql.anilist.co',
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: QUERY, variables: { search: q.name } }) },
		signal
	);
	const media = json?.data?.Page?.media;
	if (!Array.isArray(media)) throw new NetError(`AniList: ${json?.errors?.[0]?.message ?? 'unexpected response'}`);
	const out: Raw[] = [];
	for (const m of media as Json[]) {
		const t: Json = m.title ?? {};
		const names = [str(t.english), str(t.romaji), str(t.native), ...strings(m.synonyms).slice(0, 8)].filter((x): x is string => !!x);
		if (!names.length) continue;
		// the title variant closest to what was asked for (english first on ties)
		const title = names.map((n) => ({ n, s: titleSimilarity(q.name, n) })).sort((a, b) => b.s - a.s)[0].n;
		const creators = top(
			((m.staff?.edges ?? []) as Json[])
				.filter((e) => /story|art|original|creator|author|illust/i.test(String(e?.role)) && !/assist|supervis/i.test(String(e?.role)))
				.map((e) => str(e?.node?.name?.full))
				.filter((x): x is string => !!x),
			4
		);
		const related = top(
			((m.recommendations?.nodes ?? []) as Json[])
				.map((n) => str(n?.mediaRecommendation?.title?.english) ?? str(n?.mediaRecommendation?.title?.romaji))
				.filter((x): x is string => !!x),
			6
		);
		const genres = strings(m.genres).slice(0, 6);
		out.push({
			source: 'anilist',
			title,
			kind: m.format === 'NOVEL' ? 'media' : 'series',
			url: str(m.siteUrl),
			description: cleanDescription(m.description),
			genres: genres.length ? genres : undefined,
			startYear: typeof m.startDate?.year === 'number' ? m.startDate.year : undefined,
			endYear: typeof m.endDate?.year === 'number' ? m.endDate.year : undefined,
			status: m.status === 'FINISHED' || m.status === 'CANCELLED' ? 'ended' : m.status ? 'ongoing' : undefined,
			creators: creators.length ? creators : undefined,
			related: related.length ? related : undefined
		});
	}
	return out;
}
