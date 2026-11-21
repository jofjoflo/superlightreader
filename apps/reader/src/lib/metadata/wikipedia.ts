// CORS verified (curl, Origin: https://example.com): `origin=*` → access-control-allow-origin: * on en/sv.wikipedia.org and www.wikidata.org (plain GET, no headers).
// Wikipedia generator=search (intro extract + wikibase_item + Wikidata description) → ONE wbgetentities for all candidate items (claims) → ONE batched labels lookup (cached; Wikidata cannot expand labels inside a claims call).
import type { MetaQuery } from '../types.ts';
import { titleSimilarity, type Kind, type Raw } from './match.ts';
import { fetchJson } from './net.ts';
import { maxOf, minOf, pickPublisher, qs, str, yearOf, type Json } from './shared.ts';
import { cleanDescription } from './text.ts';

const L = String.raw`(?<![\p{L}-])`, R = String.raw`(?![\p{L}])`;
const words = (alts: string) => new RegExp(`${L}(?:${alts})${R}`, 'iu');
export const COMIC_RE = words('comics?|manga|manhwa|manhua|web ?comics?|graphic novels?|serietidning(?:ar|en)?|seriealbum|serieroman|seriefigur(?:er)?|serier|tecknade? serie');
const MEDIA_RE = words('films?|movies?|television|tv|miniseries|video games?|novels?|novellas?|albums?|soundtracks?|musicals?|operas?|plays?|spelfilm|långfilm|datorspel|roman');
const CHARACTER_RE = /character|team|organi[sz]ation|universe|franchise|fictional|seriefigur|superhj/i;
const NOT_A_WORK = /wikimedia|disambiguation|list of|list article/i;
/** Max statements read per property (keeps the label batch ≤ 50 ids). */
const CAPS: Record<string, number> = { P31: 4, P123: 6, P136: 4, P50: 3, P170: 3, P110: 3 };

const labelCache = new Map<string, string>();
/** Forget cached Wikidata labels (tests). */
export const resetWikidataCache = (): void => labelCache.clear();

const claimIds = (e: Json | undefined, p: string): string[] =>
	((e?.claims?.[p] ?? []) as Json[]).map((c) => c?.mainsnak?.datavalue?.value?.id).filter((v): v is string => typeof v === 'string').slice(0, CAPS[p] ?? 4);
const claimYears = (e: Json | undefined, p: string): number[] =>
	((e?.claims?.[p] ?? []) as Json[]).map((c) => yearOf(c?.mainsnak?.datavalue?.value?.time)).filter((v): v is number => v !== undefined);
const labelsOf = (e: Json | undefined, p: string): string[] => [...new Set(claimIds(e, p).map((id) => labelCache.get(id)).filter((v): v is string => !!v))];

/** Comics-ish? P31 decides first (comic book series, manga series, comics character … vs film, TV series, novel …); then the Wikidata description, genres and finally the extract. */
export function classify(types: string[], wdDesc: string, genres: string[], extract: string): Kind | undefined {
	const t = types.join(' ; ');
	const comicTypes = types.filter((x) => COMIC_RE.test(x));
	if (comicTypes.length) return comicTypes.some((x) => !CHARACTER_RE.test(x)) ? 'series' : 'character';
	if (NOT_A_WORK.test(t) || MEDIA_RE.test(t)) return undefined;
	const hint = `${t} ${wdDesc}`;
	if (COMIC_RE.test(hint)) return CHARACTER_RE.test(hint) ? 'character' : 'series';
	if (MEDIA_RE.test(wdDesc)) return undefined;
	if (COMIC_RE.test(genres.join(' '))) return 'series';
	return COMIC_RE.test(extract.slice(0, 300)) ? (CHARACTER_RE.test(t) ? 'character' : 'unknown') : undefined;
}

async function lookup(lang: 'en' | 'sv', q: MetaQuery, signal?: AbortSignal): Promise<Raw[]> {
	const term = lang === 'sv' ? q.name : `${q.name} ${q.manga ? 'manga' : 'comic'}`;
	const res = await fetchJson(
		`https://${lang}.wikipedia.org/w/api.php?${qs({ action: 'query', format: 'json', formatversion: '2', origin: '*', generator: 'search', gsrsearch: term, gsrlimit: '6', prop: 'pageprops|pageterms|extracts', ppprop: 'wikibase_item', wbptterms: 'description', exintro: '1', explaintext: '1', exlimit: 'max', exchars: '1200' })}`,
		{},
		signal
	);
	const picked = ((res?.query?.pages ?? []) as Json[])
		.filter((p) => str(p?.title) && str(p?.pageprops?.wikibase_item))
		.map((p) => ({ p, sim: titleSimilarity(q.name, p.title), desc: String(p.terms?.description?.[0] ?? '') }))
		.filter((x) => x.sim >= 0.45 && !NOT_A_WORK.test(x.desc) && !(MEDIA_RE.test(x.desc) && !COMIC_RE.test(x.desc)))
		.sort((a, b) => b.sim - a.sim || a.p.index - b.p.index)
		.slice(0, 4);
	if (!picked.length) return [];

	const ids = picked.map((x) => x.p.pageprops.wikibase_item as string);
	const claims = await fetchJson(`https://www.wikidata.org/w/api.php?${qs({ action: 'wbgetentities', format: 'json', origin: '*', props: 'claims', ids: ids.join('|') })}`, {}, signal);
	const entities: Json = claims?.entities ?? {};
	const wanted = new Set<string>();
	for (const prop of Object.keys(CAPS)) for (const id of ids) for (const x of claimIds(entities[id], prop)) if (!labelCache.has(x)) wanted.add(x);
	if (wanted.size) {
		const l = await fetchJson(`https://www.wikidata.org/w/api.php?${qs({ action: 'wbgetentities', format: 'json', origin: '*', props: 'labels', languages: 'en|sv', ids: [...wanted].slice(0, 50).join('|') })}`, {}, signal);
		for (const [id, e] of Object.entries<Json>(l?.entities ?? {})) {
			const v = str(e?.labels?.en?.value) ?? str(e?.labels?.sv?.value);
			if (v) labelCache.set(id, v);
		}
	}

	const out: Raw[] = [];
	for (const { p, desc } of picked) {
		const e: Json | undefined = entities[p.pageprops.wikibase_item];
		if (!e) continue;
		const types = labelsOf(e, 'P31'), genres = labelsOf(e, 'P136'), pubs = labelsOf(e, 'P123');
		const kind = classify(types, desc, genres, String(p.extract ?? ''));
		if (!kind) continue;
		const creators = [...new Set([...labelsOf(e, 'P50'), ...labelsOf(e, 'P170'), ...labelsOf(e, 'P110')])].slice(0, 6);
		const ends = claimYears(e, 'P582');
		const page = String(p.title);
		out.push({
			source: 'wikipedia',
			// "Saga (comics)" → "Saga" for series; characters keep their disambiguator ("Sandman (Marvel Comics)")
			title: kind === 'series' ? page.replace(/\s*\([^)]*\)\s*$/, (m) => (COMIC_RE.test(m) ? '' : m)) : page,
			kind,
			url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`,
			description: cleanDescription(p.extract),
			publisher: pickPublisher(pubs),
			genres: genres.length ? genres : undefined,
			creators: creators.length ? creators : undefined,
			startYear: minOf([...claimYears(e, 'P571'), ...claimYears(e, 'P577')]),
			endYear: maxOf(ends),
			status: ends.length ? 'ended' : undefined
		});
	}
	return out;
}

/** English first; Swedish only when English had no plausible title match. Throws only if no language could be queried. */
export async function wikipedia(q: MetaQuery, signal?: AbortSignal): Promise<Raw[]> {
	const all: Raw[] = [];
	let answered = false, failure: unknown;
	for (const lang of ['en', 'sv'] as const) {
		try {
			const found = await lookup(lang, q, signal);
			answered = true;
			all.push(...found);
			if (found.some((c) => titleSimilarity(q.name, c.title) >= 0.6)) break;
		} catch (e) {
			if (signal?.aborted) throw e;
			failure = e;
		}
	}
	if (!answered) throw failure;
	return all;
}
