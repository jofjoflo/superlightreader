/**
 * Issue metadata from Metron through the same-origin proxy.
 *
 * Search is deliberately conservative: series title must be an exact
 * normalised match and known issue number/volume/year values may not disagree.
 * Ambiguous results are returned to the caller for an explicit manual choice.
 */
import type { Issue, MetronAttribution, MetronIssue } from '../types.ts';
import { fetchJson } from './net.ts';
import { Capacitor } from '@capacitor/core';
import { MetronNative, parseNativeMetronResponse } from './metron-native.ts';

const PROXY = '/api/metron';
const MAX_RESULTS = 100;
const AUTO_SCORE = 0.9;
const AUTO_MARGIN = 0.12;

export type MetronQuery =
	| { seriesName: string; number?: number | string; volume?: number; year?: number }
	| { name: string; number?: number | string; volume?: number; year?: number };

interface NormalizedMetronQuery {
	seriesName: string;
	number?: number | string;
	volume?: number;
	year?: number;
}

export interface MetronIssueCandidate {
	id: number;
	seriesName?: string;
	number?: string;
	volume?: number;
	year?: number;
	seriesYear?: number;
	title?: string;
	image?: string;
	sourceUrl: string;
	confidence: number;
	uncertain?: boolean;
}

export type MetronMatchCandidate = MetronIssueCandidate;
export type MetronIssueMetadata = MetronIssue;

export interface MetronMatch {
	status: 'matched' | 'ambiguous' | 'not-found';
	selected?: MetronIssue;
	candidates: MetronIssueCandidate[];
}

/** Array-compatible search result. `hasMore` is non-enumerable to keep callers' list behavior unchanged. */
export type MetronSearchResults = MetronIssueCandidate[] & { hasMore?: boolean };

type JsonObject = Record<string, unknown>;

export class MetronUnavailableError extends Error {
	constructor(message = 'Metron är inte konfigurerat. Ange en token i Inställningar och försök igen.') {
		super(message);
		this.name = 'MetronUnavailableError';
	}
}

export type MetronTokenStatus = 'configured' | 'missing' | 'unavailable';

const nativeFailure = (error: unknown): MetronUnavailableError | Error => {
	if (error instanceof MetronUnavailableError) return error;
	const code = String((error as { code?: unknown } | null)?.code ?? '');
	if (code === 'INVALID_TOKEN') return new Error('Metron-token saknas eller har ogiltigt format.');
	if (code === 'TOKEN_STORAGE_FAILED') return new Error('Metron-token kunde inte sparas eller läsas.');
	if (code === 'TOKEN_MISSING') return new MetronUnavailableError();
	if (code === 'METRON_HTTP_ERROR') return new Error('Metron svarade med ett fel. Kontrollera token och försök igen.');
	return new MetronUnavailableError('Metron kunde inte nås i Android-appen. Kontrollera token och anslutning.');
};

export function isMetronNative(): boolean {
	return Capacitor.isNativePlatform();
}

export async function metronTokenStatus(): Promise<MetronTokenStatus> {
	if (!isMetronNative()) return 'unavailable';
	try {
		const result = await MetronNative.hasToken();
		return result?.configured ? 'configured' : 'missing';
	} catch {
		return 'unavailable';
	}
}

export async function setMetronToken(token: string): Promise<void> {
	if (!isMetronNative()) throw new MetronUnavailableError('Metron-token kan bara anges i Android-appen.');
	const value = token.trim();
	if (!value) throw new Error('Ange en Metron-token.');
	try {
		await MetronNative.setToken({ token: value });
	} catch (error) {
		throw nativeFailure(error);
	}
}

export async function clearMetronToken(): Promise<void> {
	if (!isMetronNative()) return;
	try {
		await MetronNative.clearToken();
	} catch (error) {
		throw nativeFailure(error);
	}
}

function configuredProxyOrigin(): string | undefined {
	const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_METRON_PROXY_URL?.trim();
	if (!env) return undefined;
	try {
		const url = new URL(env);
		return url.protocol === 'https:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** fetchJson paces by URL hostname; keep this absolute while remaining same-origin in browsers. */
const proxyUrl = (params: URLSearchParams): string => {
	if (Capacitor.isNativePlatform()) {
		const origin = configuredProxyOrigin();
		if (!origin) throw new MetronUnavailableError();
		return `${new URL(PROXY, origin).toString()}?${params}`;
	}
	const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
	return `${new URL(PROXY, origin).toString()}?${params}`;
};

const object = (v: unknown): JsonObject | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as JsonObject : undefined);
const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;
const integer = (v: unknown): number | undefined => {
	const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
	return Number.isSafeInteger(n) ? n : undefined;
};
const numberValue = (v: unknown): number | undefined => {
	const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
	return Number.isFinite(n) ? n : undefined;
};

const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const cleanList = (v: unknown): string[] => {
	const out: string[] = [];
	for (const item of list(v)) {
		const row = object(item);
		const value = text(row?.name) ?? text(object(row?.character)?.name) ?? text(item);
		if (value && !out.some((x) => x.toLocaleLowerCase() === value.toLocaleLowerCase())) out.push(value);
	}
	return out;
};

const people = (v: unknown): string[] => {
	const out: string[] = [];
	for (const item of list(v)) {
		const row = object(item);
		const value = text(row?.name) ?? text(row?.creator) ?? text(object(row?.creator)?.name) ?? text(row?.person) ?? text(object(row?.person)?.name) ?? text(item);
		if (value && !out.some((x) => x.toLocaleLowerCase() === value.toLocaleLowerCase())) out.push(value);
	}
	return out;
};

/** Key used only for matching names; displayed/source names are never rewritten. */
export function metronTitleKey(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const issueNumberKey = (value: number | string | undefined): string | undefined => {
	if (value === undefined || value === null) return undefined;
	const s = String(value).trim().replace(/^#/, '');
	if (!s) return undefined;
	const n = Number(s);
	return Number.isFinite(n) && /^\d+(?:\.\d+)?$/.test(s) ? String(n) : s.toLocaleLowerCase();
};

const LEADING_ARTICLE = /^(?:the|a|an|en|ett)\s+/;
const titleMatch = (a: string, b: string): 'exact' | 'article' | undefined => {
	const x = metronTitleKey(a), y = metronTitleKey(b);
	if (!x || !y) return undefined;
	if (x === y) return 'exact';
	return x.replace(LEADING_ARTICLE, '') === y.replace(LEADING_ARTICLE, '') ? 'article' : undefined;
};

const yearFromDate = (value: unknown): number | undefined => {
	const match = /^(?:\+)?(\d{4})/.exec(String(value ?? ''));
	const year = match ? Number(match[1]) : NaN;
	return year >= 1800 && year <= 2100 ? year : undefined;
};

function seriesOf(raw: JsonObject): JsonObject | undefined {
	return object(raw.series);
}

function seriesNameOf(raw: JsonObject): string | undefined {
	return text(seriesOf(raw)?.name) ?? text(raw.series_name);
}

function seriesYearOf(raw: JsonObject): number | undefined {
	return numberValue(seriesOf(raw)?.year_began) ?? numberValue(raw.year_began);
}

function yearOf(raw: JsonObject): number | undefined {
	return yearFromDate(raw.cover_date) ?? yearFromDate(raw.store_date) ?? seriesYearOf(raw);
}

function volumeOf(raw: JsonObject): number | undefined {
	return numberValue(seriesOf(raw)?.volume) ?? numberValue(raw.series_volume) ?? numberValue(raw.volume);
}

function numberOf(raw: JsonObject): string | undefined {
	return text(raw.number) ?? text(raw.issue_number) ?? (() => {
		const issue = text(raw.issue);
		const match = issue?.match(/#\s*([^\s]+)\s*$/);
		return match?.[1];
	})();
}

const sourceUrlOf = (id: number, raw: JsonObject): string => text(raw.resource_url) ?? `https://metron.cloud/issue/${id}/`;

function scoreCandidate(query: NormalizedMetronQuery, candidate: Pick<MetronIssueCandidate, 'seriesName' | 'number' | 'volume' | 'year'>): number {
	const match = titleMatch(query.seriesName, candidate.seriesName ?? '');
	if (!match) return 0;
	// Article-only differences stay below the automatic threshold. They remain
	// useful in the picker, but require an explicit user choice.
	let score = match === 'exact' ? 1 : 0.86;
	const qNumber = issueNumberKey(query.number);
	const cNumber = issueNumberKey(candidate.number);
	if (qNumber !== undefined) {
		if (cNumber !== undefined && qNumber !== cNumber) return 0;
		if (cNumber === undefined) score -= 0.3;
		else score += 0.01;
	}
	if (query.volume !== undefined) {
		if (candidate.volume !== undefined && query.volume !== candidate.volume) return 0;
		if (candidate.volume === undefined) score -= 0.15;
		else score += 0.01;
	}
	if (query.year !== undefined) {
		if (candidate.year !== undefined && Math.abs(query.year - candidate.year) > 1) return 0;
		if (candidate.year === undefined) score -= 0.12;
		else score += 0.01;
	}
	return Math.max(0, Math.min(1, score));
}

function candidateOf(rawValue: unknown, query: NormalizedMetronQuery): MetronIssueCandidate | undefined {
	const raw = object(rawValue);
	const id = integer(raw?.id);
	if (!raw || id === undefined) return undefined;
	const candidate: MetronIssueCandidate = {
		id,
		seriesName: seriesNameOf(raw),
		number: numberOf(raw),
		volume: volumeOf(raw),
		year: yearOf(raw),
		seriesYear: seriesYearOf(raw),
		title: text(raw.issue),
		image: text(raw.image),
		sourceUrl: sourceUrlOf(id, raw),
		confidence: 0
	};
	candidate.confidence = scoreCandidate(query, candidate);
	return candidate;
}

function responseResults(response: unknown): { rows: unknown[]; hasMore: boolean } {
	if (Array.isArray(response)) return { rows: response, hasMore: false };
	const body = object(response);
	const rows = list(body?.results);
	const count = numberValue(body?.count);
	return { rows, hasMore: (count !== undefined && count > rows.length) || !!text(body?.next) };
}

function queryOf(input: MetronQuery | Issue): NormalizedMetronQuery {
	if ('id' in input) return { seriesName: input.seriesName, number: input.number ?? input.numberLabel, volume: input.volume, year: input.year ?? input.volumeYear };
	return { seriesName: 'seriesName' in input ? input.seriesName : input.name, number: input.number, volume: input.volume, year: input.year };
}

/** Search candidates only. No candidate is silently chosen here. */
export async function searchMetronIssues(input: MetronQuery | Issue, signal?: AbortSignal, page = 1): Promise<MetronSearchResults> {
	const query = queryOf(input);
	if (!query.seriesName.trim() || signal?.aborted) return [];
	const pageNumber = Math.max(1, Math.min(100, Math.trunc(page) || 1));
	const number = issueNumberKey(query.number);
	let response: unknown;
	if (isMetronNative()) {
		try {
			const nativeResponse = await MetronNative.search({ q: query.seriesName.trim(), number, page: pageNumber });
			response = parseNativeMetronResponse(nativeResponse);
		} catch (error) {
			throw nativeFailure(error);
		}
	} else {
		const params = new URLSearchParams({ action: 'search', q: query.seriesName.trim(), page: String(pageNumber) });
		if (number !== undefined) params.set('number', number);
		response = await fetchJson(proxyUrl(params), {}, signal);
	}
	const parsed = responseResults(response);
	const out = parsed.rows
		.map((raw) => candidateOf(raw, query))
		.filter((c): c is MetronIssueCandidate => !!c && c.confidence > 0)
		.sort((a, b) => b.confidence - a.confidence || a.id - b.id)
		.slice(0, MAX_RESULTS);
	if (parsed.hasMore) Object.defineProperty(out, 'hasMore', { value: true, enumerable: false });
	return out as MetronSearchResults;
}

function attributionOf(value: unknown): MetronAttribution[] | undefined {
	const out = list(value).flatMap((item) => {
		const row = object(item);
		const source = text(row?.source);
		if (!source) return [];
		const result: MetronAttribution = { source };
		const url = text(row?.url);
		if (url) result.url = url;
		return [result];
	});
	return out.length ? out : undefined;
}

function detailsOf(rawValue: unknown, candidate?: MetronIssueCandidate): MetronIssue {
	const raw = object(rawValue);
	const id = integer(raw?.id) ?? candidate?.id;
	if (!raw || id === undefined) throw new Error('Metron returned an invalid issue');
	const sourceUrl = sourceUrlOf(id, raw);
	const detail: MetronIssue = {
		source: 'metron',
		id,
		seriesName: seriesNameOf(raw) ?? candidate?.seriesName,
		number: numberOf(raw) ?? candidate?.number,
		volume: volumeOf(raw) ?? candidate?.volume,
		year: yearOf(raw) ?? candidate?.year,
		title: text(raw.issue) ?? candidate?.title,
		description: text(raw.desc),
		characters: cleanList(raw.characters),
		creators: people(raw.creators).concat(people(raw.credits).filter((x) => !people(raw.creators).some((y) => y.toLocaleLowerCase() === x.toLocaleLowerCase()))),
		sourceUrl,
		attribution: attributionOf(raw.attribution),
		confidence: candidate?.confidence
	};
	return detail;
}

/** Fetch one detail record after the user selected a candidate. */
export async function fetchMetronIssue(id: number | string, signal?: AbortSignal, candidate?: MetronIssueCandidate): Promise<MetronIssue> {
	const parsed = integer(id);
	if (parsed === undefined || parsed < 1) throw new Error('Metron issue id must be a positive integer');
	let response: unknown;
	if (isMetronNative()) {
		try {
			const nativeResponse = await MetronNative.detail({ id: parsed });
			response = parseNativeMetronResponse(nativeResponse);
		} catch (error) {
			throw nativeFailure(error);
		}
	} else {
		const params = new URLSearchParams({ action: 'detail', id: String(parsed) });
		response = await fetchJson(proxyUrl(params), {}, signal);
	}
	return detailsOf(response, candidate);
}

/** Search, expose ambiguity, and detail-fetch only a confident automatic match. */
export async function matchMetronIssue(input: MetronQuery | Issue, signal?: AbortSignal): Promise<MetronMatch> {
	const candidates = await searchMetronIssues(input, signal);
	if (!candidates.length) return { status: 'not-found', candidates: [] };
	const [best, second] = candidates;
	const ambiguous = best.confidence < AUTO_SCORE || (second && best.confidence - second.confidence < AUTO_MARGIN);
	if (ambiguous) return { status: 'ambiguous', candidates: candidates.map((c, i) => i < 2 ? { ...c, uncertain: true } : c) };
	return { status: 'matched', candidates, selected: await fetchMetronIssue(best.id, signal, best) };
}

/** Attach a selected Metron record without changing local ComicInfo-derived fields. */
export function applyMetronIssue(issue: Issue, metron: MetronIssue): Issue {
	return { ...issue, metron: { ...metron, characters: [...metron.characters], creators: [...metron.creators], attribution: metron.attribution?.map((a) => ({ ...a })) } };
}

// Short aliases keep call sites readable and make the two-step manual picker explicit.
export const searchMetron = searchMetronIssues;
export const searchMetronPage = (input: MetronQuery | Issue, page: number, signal?: AbortSignal): Promise<MetronSearchResults> => searchMetronIssues(input, signal, page);
export const lookupMetronIssue = matchMetronIssue;
export const matchMetron = matchMetronIssue;
export const selectMetronIssue = fetchMetronIssue;

