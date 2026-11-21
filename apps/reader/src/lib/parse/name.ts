import type { ParsedName, PathInfo } from '../types.ts';
import { hash, slugify } from '../util.ts';
import { isKnownPublisher, normalizePublisher } from './publishers.ts';

const GENERIC = new Set('comics comic serier series tidningar tidning böcker bok books downloads download nedladdningar dokument documents manga library bibliotek new nya'.split(' '));
const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const cleanFolder = (s: string) => s.replace(/[\[({][^\])}]*[\])}]/g, ' ').replace(/\s+/g, ' ').trim();
const key = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// number markers (checked in this order): YYYY-NN, "#12" / "Nr 12" / "Issue 12" …, "Vol. 3" / "v03", bare trailing number
const RE_YYNN = /(?<![\p{L}\p{N}])((?:19|20)\d{2})-(\d{1,2})(?![\p{L}\p{N}])/u;
const RE_HASH = /#\s*(\d+(?:\.\d+)?)/g;
const RE_WORD = /(?<![\p{L}\p{N}])(?:issue|iss|no|nr|nummer|number|chapter|ch|ep|episode|part|pt)\.?\s*(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/giu;
const RE_VOL = /(?<![\p{L}\p{N}])(?:(?:vol(?:ume)?|volym|tome)\.?\s*|v)(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/giu;
const RE_BARE = /(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/gu;
const RE_YEAR = /^(?:19|20)\d{2}$/;
const RE_KIND = /(?<![\p{L}\p{N}])(annuals?|special)(?![\p{L}\p{N}])/giu;
const RE_ONESHOT = /(?<![\p{L}\p{N}])one[- ]?shot(?![\p{L}\p{N}])/iu;
const EDGE = /^[\s:–—_.,-]+|[\s:–—_.,-]+$/g;

interface Span { start: number; end: number; value: number; label: string }
const spans = (re: RegExp, s: string): Span[] =>
	[...s.matchAll(re)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, value: Number(m[1]), label: m[1] }));

/** "Saga 001 (2012) (Digital) (Zone-Empire).cbz" → { series:'Saga', number:1, numberLabel:'001', year:2012, kind:'issue' } */
export function parseFileName(fileName: string): ParsedName {
	let base = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.(?:cb[zr7t]|zip|rar|7z|pdf)$/i, '').replace(/_/g, ' ');
	let year: number | undefined;
	base = base.replace(/[\[({]\s*((?:19|20)\d{2})\s*[\])}]/, (_, y: string) => { year = Number(y); return ' '; });
	base = base.replace(/[\[({][^\])}]*[\])}]/g, ' ');
	if (!/\s/.test(base)) base = base.replace(/(?<!\d)\.|\.(?!\d)/g, ' '); // Amazing.Spider-Man.700 (keep decimals)
	base = base.replace(/\s+/g, ' ').trim();

	let kind: ParsedName['kind'] = 'issue';
	for (const m of base.matchAll(RE_KIND)) kind = m[1].toLowerCase() === 'special' ? 'special' : 'annual';

	const vols = spans(RE_VOL, base);
	const marks = [...spans(RE_HASH, base), ...spans(RE_WORD, base)].sort((a, b) => a.start - b.start);
	const used = [...vols, ...marks];
	let num: Span | undefined;
	let yearSpan: Span | undefined;
	const yy = RE_YYNN.exec(base);
	if (yy) {
		year ??= Number(yy[1]);
		num = { start: yy.index, end: yy.index + yy[0].length, value: Number(yy[2]), label: yy[2] };
	} else if (marks.length) {
		num = marks[marks.length - 1];
	} else {
		const bare = spans(RE_BARE, base).filter((s) => !used.some((u) => s.start >= u.start && s.end <= u.end));
		const last = bare[bare.length - 1];
		// trailing 4-digit year ("Fantomen 12 2023", "Watchmen 1986"); a lone leading one is part of the title
		if (last && RE_YEAR.test(last.label) && !(bare.length === 1 && last.start === 0 && !vols.length)) {
			year ??= last.value;
			yearSpan = last;
			bare.pop();
		}
		const pick = bare[bare.length - 1];
		// a lone leading numeral is part of the title ("100 Bullets"), unless nothing else is there
		if (pick && (pick.start > 0 || !/\p{L}/u.test(base.slice(pick.end)))) num = pick;
	}

	let volume: number | undefined;
	if (vols.length) {
		if (!num) num = vols[vols.length - 1]; // "Berserk v03": the volume IS the number
		else if (!vols.some((v) => v.start === num!.start)) volume = vols[vols.length - 1].value;
	}

	let series = num ? base.slice(0, num.start) : yearSpan ? base.slice(0, yearSpan.start) : base;
	let title = num ? base.slice(num.end) : undefined;
	if (num && title !== undefined && yearSpan && yearSpan.start >= num.end) title = base.slice(num.end, yearSpan.start) + ' ' + base.slice(yearSpan.end);
	series = series.replace(RE_VOL, ' ').replace(RE_KIND, ' ').replace(/\s+/g, ' ').replace(EDGE, '');
	if (title !== undefined) {
		title = title.replace(RE_VOL, ' ');
		if (year === undefined) {
			const ym = /(?<![\p{L}\p{N}])((?:19|20)\d{2})(?![\p{L}\p{N}])/u.exec(title);
			if (ym) { year = Number(ym[1]); title = title.replace(ym[0], ' '); }
		}
		title = title.replace(/\s+/g, ' ').replace(EDGE, '') || undefined;
	}
	if (!series) series = base;
	if (!num && kind === 'issue') kind = 'oneshot';
	if (kind === 'issue' && RE_ONESHOT.test(series)) kind = 'oneshot';
	return { series, number: num?.value, numberLabel: num?.label, volume, year, title, kind };
}

/** Combine file name + ancestor folders. See docs/architecture.md → "Series grouping". */
export function parsePath(relPath: string): PathInfo {
	const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
	const name = parseFileName(parts.at(-1) ?? relPath);
	const ancestors = parts.slice(0, -1);
	let folderSeries: string | undefined; let volumeYear: number | undefined;
	if (ancestors.length) {
		const rawFolder = ancestors.at(-1)!;
		const cleaned = cleanFolder(rawFolder); const fk = key(cleaned); const nk = key(name.series);
		if (fk && !GENERIC.has(fk) && !isKnownPublisher(cleaned) && (!nk || /^\d/.test(name.series) || nk.includes(fk) || fk.includes(nk))) {
			folderSeries = cleaned; const y = rawFolder.match(/\b(19\d{2}|20\d{2})\b/); if (y) volumeYear = Number(y[1]);
		}
	}
	let publisher: string | undefined;
	for (let i = ancestors.length - 1; i >= 0; i--) if (isKnownPublisher(ancestors[i])) { publisher = normalizePublisher(ancestors[i]); break; }
	return { name, folderSeries, volumeYear, publisher };
}

/** Stable series id (url-safe). Same inputs → same id. Falls back to hash() when slug is empty. */
export function seriesKey(name: string, volume?: number, volumeYear?: number): string {
	const bare = name.trim().replace(/^(?:the|a|an|en|ett)\s+/i, '');
	return (slugify(bare) || `s-${hash(name)}`) + (volume !== undefined && volume > 1 ? `-v${volume}` : '') + (volumeYear ? `-${volumeYear}` : '');
}

/** "Batman", volume 3, volumeYear 2016 → "Batman (2016)"; volume>1 without year → "Batman vol. 3". */
export function seriesDisplayName(name: string, volume?: number, volumeYear?: number): string {
	if (volumeYear) return `${name} (${volumeYear})`;
	return volume !== undefined && volume > 1 ? `${name} vol. ${volume}` : name;
}
