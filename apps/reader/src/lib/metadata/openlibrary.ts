// CORS verified: GET /search.json → access-control-allow-origin: * (no headers needed).
import type { MetaQuery } from '../types.ts';
import { baseTitle, titleKey, titleSimilarity, type Raw } from './match.ts';
import { fetchJson } from './net.ts';
import { minOf, pickPublisher, qs, str, strings, top, type Json } from './shared.ts';

const COMIC = /comic|graphic novel|manga|cartoon/i;
const GENRE = /fiction|fantasy|science|superhero|horror|adventure|humou?r|mystery|romance|western|crime|action|drama|comedy|war\b|history|comic|manga/i;

/** search.json?title=…: docs of one series are merged into a single candidate (earliest first_publish_year, most common publisher/author). */
export async function openLibrary(q: MetaQuery, signal?: AbortSignal): Promise<Raw[]> {
	const json = await fetchJson(
		`https://openlibrary.org/search.json?${qs({ title: q.name, limit: '20', fields: 'key,title,author_name,first_publish_year,publisher,subject' })}`,
		{},
		signal
	);
	const groups = new Map<string, { docs: Json[]; comic: boolean }>();
	for (const d of (Array.isArray(json?.docs) ? json.docs : []) as Json[]) {
		const title = str(d?.title);
		if (!title || titleSimilarity(q.name, title) < 0.6) continue;
		const subjects = strings(d.subject);
		const comic = subjects.some((s) => COMIC.test(s));
		if (subjects.length && !comic) continue; // subjects say it is something else
		const key = titleKey(title);
		const g = groups.get(key) ?? { docs: [], comic: false };
		g.docs.push(d);
		g.comic = g.comic || comic;
		groups.set(key, g);
	}
	return [...groups.values()].map((g): Raw => {
		const docs = g.docs;
		const genres = top(docs.flatMap((d) => strings(d.subject)).filter((s) => !/[:=]/.test(s) && GENRE.test(s)), 4);
		const creators = top(docs.flatMap((d) => strings(d.author_name)), 4);
		const key = str(docs[0].key);
		return {
			source: 'openlibrary',
			title: docs.map((d) => baseTitle(String(d.title))).sort((a, b) => a.length - b.length)[0],
			kind: g.comic ? 'series' : 'unknown',
			url: key ? `https://openlibrary.org${key}` : undefined,
			publisher: pickPublisher(docs.flatMap((d) => strings(d.publisher).slice(0, 3))),
			genres: genres.length ? genres : undefined,
			startYear: minOf(docs.map((d) => (typeof d.first_publish_year === 'number' ? d.first_publish_year : undefined))),
			creators: creators.length ? creators : undefined
		};
	});
}
