// CORS verified: access-control-allow-origin echoes the request Origin (also on the HTTP 429 that keyless quota exhaustion returns, which we treat as a failed source).
import type { MetaQuery } from '../types.ts';
import { baseTitle, titleKey, titleSimilarity, type Raw } from './match.ts';
import { fetchJson } from './net.ts';
import { minOf, pickPublisher, qs, str, strings, top, yearOf, type Json } from './shared.ts';
import { cleanDescription } from './text.ts';

const COMIC = /comic|graphic novel|manga/i;

/** volumes?q=intitle:"…": volumes of one series are merged into a single candidate (earliest year, most common publisher). */
export async function googleBooks(q: MetaQuery, signal?: AbortSignal): Promise<Raw[]> {
	const json = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${qs({ q: `intitle:"${q.name.replace(/"/g, ' ')}"`, maxResults: '20' })}`, {}, signal);
	const groups = new Map<string, { vols: Json[]; comic: boolean; id?: string }>();
	for (const item of (Array.isArray(json?.items) ? json.items : []) as Json[]) {
		const v: Json = item?.volumeInfo ?? {};
		const title = str(v.title);
		if (!title || titleSimilarity(q.name, title) < 0.6) continue;
		const cats = strings(v.categories);
		const comic = cats.some((c) => COMIC.test(c));
		if (cats.length && !comic) continue; // categorised as something else (Fiction, Juvenile …)
		const key = titleKey(title);
		const g = groups.get(key) ?? { vols: [], comic: false, id: str(item?.id) };
		g.vols.push(v);
		g.comic = g.comic || comic;
		groups.set(key, g);
	}
	return [...groups.values()].map((g): Raw => {
		const vols = g.vols;
		const descriptions = vols.map((v) => str(v.description)).filter((x): x is string => !!x).sort((a, b) => b.length - a.length);
		const genres = top(vols.flatMap((v) => strings(v.categories)), 4);
		const creators = top(vols.flatMap((v) => strings(v.authors)), 4);
		return {
			source: 'googlebooks',
			title: vols.map((v) => baseTitle(String(v.title))).sort((a, b) => a.length - b.length)[0],
			kind: g.comic ? 'series' : 'unknown',
			url: str(vols[0].infoLink) ?? (g.id ? `https://books.google.com/books?id=${encodeURIComponent(g.id)}` : undefined),
			description: cleanDescription(descriptions[0]),
			publisher: pickPublisher(vols.map((v) => str(v.publisher)).filter((x): x is string => !!x)),
			genres: genres.length ? genres : undefined,
			startYear: minOf(vols.map((v) => yearOf(v.publishedDate))),
			creators: creators.length ? creators : undefined
		};
	});
}
