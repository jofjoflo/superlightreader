import type { ComicInfo } from '../types.ts';

/** Parse ComicInfo.xml (flat schema) WITHOUT DOMParser (must run in node). Decode XML entities. Never throws. */
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, d, h, n) => {
		if (n) return ENT[n.toLowerCase()] ?? m;
		try { return String.fromCodePoint(d ? +d : parseInt(h, 16)); } catch { return m; }
	});
const clean = (s: string) => decode(s.replace(/^<!\[CDATA\[|\]\]>$/g, '')).replace(/\s+/g, ' ').trim();
const one = (xml: string, tag: string): string | undefined => {
	const re = new RegExp(`<(?:(?:[\\w-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i');
	const m = xml.match(re); return m ? clean(m[1]) || undefined : undefined;
};
const list = (xml: string, tag: string): string[] | undefined => {
	const v = one(xml, tag); if (!v) return undefined;
	const out = v.split(/[,;|\n]+/).map((s) => clean(s)).filter(Boolean); return out.length ? out : undefined;
};
const num = (xml: string, tag: string): number | undefined => { const n = Number(one(xml, tag)); return Number.isFinite(n) ? n : undefined; };
const bool = (s?: string) => !!s && /^(?:true|yes|1)$/i.test(s);
const attr = (s: string, name: string) => {
	const m = s.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)`, 'i')); return m ? clean(m[1]) : undefined;
};

export function parseComicInfo(xml: string): ComicInfo {
	const out: ComicInfo = {
		writers: list(xml, 'Writer') ?? [], pencillers: list(xml, 'Penciller') ?? [], inkers: list(xml, 'Inker') ?? [], colorists: list(xml, 'Colorist') ?? [],
		letterers: list(xml, 'Letterer') ?? [], coverArtists: list(xml, 'CoverArtist') ?? [], editors: list(xml, 'Editor') ?? [], genres: list(xml, 'Genre') ?? [],
		tags: list(xml, 'Tags') ?? [], characters: list(xml, 'Characters') ?? [], teams: list(xml, 'Teams') ?? [], pages: []
	};
	for (const tag of ['Series', 'Number', 'Title', 'Publisher', 'Imprint', 'StoryArc', 'Summary', 'AgeRating', 'LanguageISO', 'Web', 'Format'] as const) {
		const v = one(xml, tag); if (v !== undefined) (out as unknown as Record<string, string>)[tag[0].toLowerCase() + tag.slice(1)] = v;
	}
	const volume = num(xml, 'Volume'); if (volume !== undefined) out.volume = volume;
	const year = num(xml, 'Year'); if (year !== undefined) out.year = year;
	const month = num(xml, 'Month'); if (month !== undefined) out.month = month;
	const pageCount = num(xml, 'PageCount'); if (pageCount !== undefined) out.pageCount = pageCount;
	const manga = one(xml, 'Manga'); if (manga && /^(Yes|No|YesAndRightToLeft|Unknown)$/i.test(manga)) out.manga = manga[0].toUpperCase() + manga.slice(1) as ComicInfo['manga'];
	const pages = xml.match(/<Page\b[^>]*\/?>/gi) ?? [];
	for (const p of pages) { const image = Number(attr(p, 'Image')); if (!Number.isFinite(image)) continue; const type = attr(p, 'Type'); out.pages.push({ image, type: type || undefined, doublePage: bool(attr(p, 'DoublePage')) || undefined }); }
	return out;
}
