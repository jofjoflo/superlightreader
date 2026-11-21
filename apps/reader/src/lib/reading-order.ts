import type { Issue, Progress, Series } from './types.ts';

/** Portable import format for a user-curated reading order. */
export interface ReadingOrderItem {
	series: string;
	issue?: number | string;
	volume?: number;
	year?: number;
	story?: string;
	note?: string;
	essential?: boolean;
	url?: string;
}

export interface ReadingOrder {
	id: string;
	title: string;
	description?: string;
	year?: number;
	characters?: string[];
	sourceUrl?: string;
	items: ReadingOrderItem[];
	createdAt: number;
}

export interface ParseReadingOrderResult {
	order?: ReadingOrder;
	errors: string[];
	warnings: string[];
	saved?: boolean;
}

export type ReadingOrderMatchStatus = 'matched' | 'missing' | 'ambiguous';

export interface ReadingOrderItemMatch {
	item: ReadingOrderItem;
	status: ReadingOrderMatchStatus;
	series?: Series;
	issue?: Issue;
	progress?: Progress;
	candidates: Series[];
	issueCandidates: Issue[];
	reason?: string;
}

export interface ReadingOrderMatch {
	order: ReadingOrder;
	items: ReadingOrderItemMatch[];
}

const MAX_ITEMS = 5000;
const MAX_JSON_CHARS = 2_000_000;
const MAX_CHARACTERS = 100;
const text = (v: unknown): v is string => typeof v === 'string';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
const url = (v: unknown): v is string => text(v) && /^https?:\/\//i.test(v) && v.length <= 2048;
const clean = (v: string, max: number) => v.trim().slice(0, max);

function itemIssue(v: unknown): number | string | undefined {
	if (integer(v) && v >= 0 && v <= 100000) return v;
	if (text(v) && clean(v, 80)) return clean(v, 80);
	return undefined;
}

/** Normalises names only for exact matching; it never performs fuzzy matching. */
export function normalizeReadingOrderName(value: string): string {
	return value.normalize('NFKC').trim().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase();
}

function parseObject(value: unknown): ParseReadingOrderResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['Roten måste vara ett JSON-objekt.'], warnings };
	const raw = value as Record<string, unknown>;
	const title = text(raw.title) ? clean(raw.title, 200) : '';
	if (!title) errors.push('title måste vara en icke-tom text.');
	else if (raw.title !== title) warnings.push('title trimmades till 200 tecken.');
	if (!Array.isArray(raw.items)) errors.push('items måste vara en array.');
	const rawItems = Array.isArray(raw.items) ? raw.items : [];
	if (rawItems.length > MAX_ITEMS) errors.push(`items får innehålla högst ${MAX_ITEMS} poster.`);
	const items: ReadingOrderItem[] = [];
	for (let n = 0; n < Math.min(rawItems.length, MAX_ITEMS); n++) {
		const row = rawItems[n];
		if (!row || typeof row !== 'object' || Array.isArray(row)) {
			errors.push(`items[${n}] måste vara ett objekt.`);
			continue;
		}
		const r = row as Record<string, unknown>;
		const series = text(r.series) ? clean(r.series, 200) : '';
		if (!series) {
			errors.push(`items[${n}].series måste vara en icke-tom text.`);
			continue;
		}
		const issue = itemIssue(r.issue);
		if (r.issue !== undefined && issue === undefined) errors.push(`items[${n}].issue måste vara nummer eller text.`);
		for (const key of ['volume', 'year'] as const)
			if (r[key] !== undefined && (!integer(r[key]) || Number(r[key]) < 0 || Number(r[key]) > 3000)) errors.push(`items[${n}].${key} är ogiltigt.`);
		if (r.url !== undefined && !url(r.url)) errors.push(`items[${n}].url måste vara en http(s)-adress.`);
		const item: ReadingOrderItem = { series };
		if (issue !== undefined) item.issue = issue;
		if (integer(r.volume) && r.volume >= 0 && r.volume <= 3000) item.volume = r.volume;
		if (integer(r.year) && r.year >= 0 && r.year <= 3000) item.year = r.year;
		for (const key of ['story', 'note'] as const) if (text(r[key]) && clean(r[key], 2000)) item[key] = clean(r[key], 2000);
		if (typeof r.essential === 'boolean') item.essential = r.essential;
		if (url(r.url)) item.url = r.url;
		items.push(item);
	}
	if (raw.description !== undefined && (!text(raw.description) || raw.description.length > 4000)) errors.push('description måste vara text på högst 4000 tecken.');
	if (raw.year !== undefined && (!integer(raw.year) || raw.year < 0 || raw.year > 3000)) errors.push('year är ogiltigt.');
	if (raw.characters !== undefined && (!Array.isArray(raw.characters) || raw.characters.length > MAX_CHARACTERS || raw.characters.some((v) => !text(v) || !clean(v, 100)))) errors.push(`characters måste vara högst ${MAX_CHARACTERS} texter.`);
	if (raw.sourceUrl !== undefined && !url(raw.sourceUrl)) errors.push('sourceUrl måste vara en http(s)-adress.');
	if (!items.length) errors.push('items måste innehålla minst en giltig post.');
	if (errors.length) return { errors, warnings };
	const order: ReadingOrder = { id: idFor(title, items), title, items, createdAt: Date.now() };
	if (text(raw.description) && clean(raw.description, 4000)) order.description = clean(raw.description, 4000);
	if (integer(raw.year)) order.year = raw.year;
	if (Array.isArray(raw.characters)) order.characters = raw.characters.filter(text).map((v) => clean(v, 100)).filter(Boolean);
	if (url(raw.sourceUrl)) order.sourceUrl = raw.sourceUrl;
	return { order, errors, warnings };
}

function idFor(title: string, items: ReadingOrderItem[]): string {
	const source = `${title}\n${items.map((i) => `${i.series}|${i.issue ?? ''}|${i.volume ?? ''}|${i.year ?? ''}`).join('\n')}`;
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
	return `order-${(hash >>> 0).toString(36)}-${Date.now().toString(36)}`;
}

/** Parse JSON text or an already decoded object without throwing on hostile input. */
export function parseReadingOrderJson(input: string | unknown): ParseReadingOrderResult {
	if (typeof input === 'string') {
		if (input.length > MAX_JSON_CHARS) return { errors: ['JSON-filen är för stor (högst 2 MB).'], warnings: [] };
		try {
			return parseObject(JSON.parse(input));
		} catch {
			return { errors: ['Filen innehåller ogiltig JSON.'], warnings: [] };
		}
	}
	return parseObject(input);
}

function issueMatches(item: ReadingOrderItem, issues: Issue[]): Issue[] {
	return issues.filter((issue) => {
		if (item.volume !== undefined && issue.volume !== item.volume) return false;
		if (item.year !== undefined && issue.year !== item.year) return false;
		if (item.issue === undefined) return true;
		if (typeof item.issue === 'number') return issue.number === item.issue;
		const label = normalizeReadingOrderName(item.issue);
		if (/^\d+(?:\.\d+)?$/.test(label) && issue.number === Number(label)) return true;
		if (normalizeReadingOrderName(issue.numberLabel ?? '') !== label && normalizeReadingOrderName(issue.title ?? '') !== label) return false;
		return true;
	});
}

/** Conservative exact matcher. A missing or ambiguous item is never auto-linked. */
export function matchReadingOrder(order: ReadingOrder, series: Series[], _progress: Record<string, Progress> = {}): ReadingOrderMatch {
	const items = order.items.map((item): ReadingOrderItemMatch => {
		const candidates = series.filter((s) => normalizeReadingOrderName(s.name) === normalizeReadingOrderName(item.series));
		if (!candidates.length) return { item, status: 'missing', candidates, issueCandidates: [], reason: 'Serien finns inte i biblioteket.' };
		if (candidates.length > 1) return { item, status: 'ambiguous', candidates, issueCandidates: [], reason: 'Flera serier har samma namn.' };
		const candidate = candidates[0];
		const issueCandidates = issueMatches(item, candidate.issues);
		if (issueCandidates.length === 1) return { item, status: 'matched', series: candidate, issue: issueCandidates[0], progress: _progress[issueCandidates[0].id], candidates, issueCandidates };
		if (!issueCandidates.length) return { item, status: 'missing', series: candidate, candidates, issueCandidates, reason: 'Numret finns inte i biblioteket.' };
		return { item, status: 'ambiguous', series: candidate, candidates, issueCandidates, reason: 'Flera nummer matchar.' };
	});
	return { order, items };
}

export const parseReadingOrder = parseReadingOrderJson;
