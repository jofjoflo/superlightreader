import { dbLoad, dbPutBackupRows } from './db.ts';
import { parseReadingOrderJson, type ReadingOrder } from './reading-order.ts';
import { loadSettings, saveSettingsStrict } from './settings.ts';
import type { Issue, Progress, SeriesMeta, SeriesUser, Settings } from './types.ts';
import { saveBlob } from './export.ts';

export const BACKUP_FORMAT = 'superlight-reader-backup' as const;
export const BACKUP_VERSION = 1 as const;
const MAX_CHARS = 10_000_000;
const MAX_ROWS = 100_000;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface LibraryBackup {
	format: typeof BACKUP_FORMAT;
	version: typeof BACKUP_VERSION;
	exportedAt: string;
	issues: Issue[];
	progress: Progress[];
	seriesMeta: SeriesMeta[];
	seriesUser: SeriesUser[];
	settings: Settings;
	readingOrders: ReadingOrder[];
}

export interface BackupImportResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
	added: BackupCounts;
	updated: BackupCounts;
	skipped: BackupCounts;
	orphaned: string[];
	conflicts: string[];
	settings: 'imported' | 'skipped' | 'failed';
}

export interface BackupCounts {
	issues: number;
	metron: number;
	progress: number;
	seriesMeta: number;
	seriesUser: number;
	readingOrders: number;
}

export interface BackupParseResult {
	backup?: LibraryBackup;
	errors: string[];
	warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, required = false): v is string => typeof v === 'string' && v.length <= max && !CONTROL.test(v) && (!required || v.trim().length > 0);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const finite = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function localStorageOrUndefined(storage?: Storage): Storage | undefined {
	if (storage) return storage;
	try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}
function loadReadingOrders(storage?: Storage): ReadingOrder[] {
	const store = localStorageOrUndefined(storage); if (!store) return [];
	try {
		const raw = JSON.parse(store.getItem('slr.reading-orders') ?? '[]');
		if (!Array.isArray(raw)) return [];
		return raw.flatMap((x) => { const parsed = parseReadingOrderJson(x); return parsed.order ? [{ ...parsed.order, ...(typeof x?.id === 'string' ? { id: x.id } : {}), ...(typeof x?.createdAt === 'number' ? { createdAt: x.createdAt } : {}) }] : []; });
	} catch { return []; }
}
function saveReadingOrders(orders: ReadingOrder[], storage?: Storage): boolean {
	const store = localStorageOrUndefined(storage); if (!store) return false;
	try { store.setItem('slr.reading-orders', JSON.stringify(orders)); return true; } catch { return false; }
}

function safeIssue(v: unknown): Issue | undefined {
	if (!isObject(v) || !text(v.id, 256, true) || !text(v.fileName, 1024, true) || !text(v.relPath, 4096, true) || !text(v.seriesId, 256, true) || !text(v.seriesName, 500, true)) return undefined;
	if (!finite(v.size) || !finite(v.lastModified) || !finite(v.addedAt) || !integer(v.pageCount, 0, 10_000_000) || !integer(v.coverIndex, 0, 10_000_000) || typeof v.hasCover !== 'boolean') return undefined;
	if (!['cbz', 'cbr', 'zip', 'rar'].includes(String(v.format))) return undefined;
	const allowed = new Set(['id', 'fileName', 'relPath', 'size', 'lastModified', 'addedAt', 'format', 'seriesId', 'seriesName', 'volume', 'volumeYear', 'number', 'numberLabel', 'title', 'year', 'pageCount', 'publisher', 'imprint', 'writers', 'artists', 'genres', 'tags', 'characters', 'summary', 'rtl', 'ageRating', 'language', 'wide', 'coverIndex', 'hasCover', 'color', 'coverW', 'coverH', 'persisted', 'unsupported', 'metron']);
	if (Object.keys(v).some((key) => !allowed.has(key))) return undefined;
	for (const key of ['numberLabel', 'title', 'publisher', 'imprint', 'summary', 'ageRating', 'language', 'color', 'unsupported'] as const) if (v[key] !== undefined && !text(v[key], key === 'summary' ? 20_000 : 2_000)) return undefined;
	for (const key of ['writers', 'artists', 'genres', 'tags', 'characters'] as const) if (v[key] !== undefined && (!Array.isArray(v[key]) || v[key].length > 200 || !v[key].every((x) => text(x, 500, true)))) return undefined;
	for (const key of ['volume', 'volumeYear', 'number', 'year', 'coverW', 'coverH'] as const) if (v[key] !== undefined && !finite(v[key], key === 'number' ? -1_000_000 : 0)) return undefined;
	if (v.rtl !== undefined && typeof v.rtl !== 'boolean' || v.persisted !== undefined && typeof v.persisted !== 'boolean') return undefined;
	if (v.wide !== undefined && (!Array.isArray(v.wide) || v.wide.length > 10_000 || !v.wide.every((x) => integer(x, 0, (v.pageCount as number) - 1)))) return undefined;
	if (v.metron !== undefined && !safeMetron(v.metron)) return undefined;
	const out = copy(v) as unknown as Issue;
	// A backup never carries files; this flag can never be trusted across devices.
	out.persisted = false;
	return out;
}

function safeMetron(v: unknown): boolean {
	if (!isObject(v) || v.source !== 'metron' || !integer(v.id, 1, 2_147_483_647) || typeof v.sourceUrl !== 'string' || !/^https?:\/\/[^\s]+$/i.test(v.sourceUrl) || v.sourceUrl.length > 2048 || CONTROL.test(v.sourceUrl)) return false;
	if (!Array.isArray(v.characters) || v.characters.length > 200 || !v.characters.every((x) => text(x, 500, true))) return false;
	if (!Array.isArray(v.creators) || v.creators.length > 200 || !v.creators.every((x) => text(x, 500, true))) return false;
	for (const key of ['seriesName', 'number', 'title', 'description'] as const) if (v[key] !== undefined && !text(v[key], key === 'description' ? 20_000 : 500)) return false;
	if (v.volume !== undefined && !integer(v.volume, 0, 10_000) || v.year !== undefined && !integer(v.year, 0, 3_000) || v.confidence !== undefined && (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) || v.uncertain !== undefined && typeof v.uncertain !== 'boolean') return false;
	if (v.attribution !== undefined && (!Array.isArray(v.attribution) || v.attribution.length > 100 || !v.attribution.every((x) => isObject(x) && text(x.source, 200, true) && (x.url === undefined || (typeof x.url === 'string' && /^https?:\/\/[^\s]+$/i.test(x.url) && x.url.length <= 2048 && !CONTROL.test(x.url)))))) return false;
	return true;
}

function safeProgress(v: unknown): Progress | undefined {
	if (!isObject(v) || !text(v.issueId, 256, true) || !integer(v.page, 0, 10_000_000) || !integer(v.pageCount, 0, 10_000_000) || v.page > v.pageCount || typeof v.completed !== 'boolean' || !finite(v.updatedAt)) return undefined;
	return { issueId: v.issueId, page: v.page, pageCount: v.pageCount, completed: v.completed, updatedAt: v.updatedAt };
}

function safeMeta(v: unknown): SeriesMeta | undefined {
	if (!isObject(v) || !text(v.seriesId, 256, true)) return undefined;
	for (const key of ['name', 'description', 'publisher', 'source', 'matchedTitle'] as const) if (v[key] !== undefined && !text(v[key], key === 'description' ? 20_000 : 2_000)) return undefined;
	for (const key of ['genres', 'creators', 'related'] as const) if (v[key] !== undefined && (!Array.isArray(v[key]) || v[key].length > 200 || !v[key].every((x) => text(x, 500, true)))) return undefined;
	if (v.sourceUrl !== undefined && (typeof v.sourceUrl !== 'string' || !/^https?:\/\/[^\s]+$/i.test(v.sourceUrl) || v.sourceUrl.length > 2048 || CONTROL.test(v.sourceUrl))) return undefined;
	if (v.startYear !== undefined && !integer(v.startYear, 0, 3000) || v.endYear !== undefined && !integer(v.endYear, 0, 3000) || v.confidence !== undefined && (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) || v.fetchedAt !== undefined && !finite(v.fetchedAt)) return undefined;
	if (v.status !== undefined && v.status !== 'ongoing' && v.status !== 'ended') return undefined;
	for (const key of ['rtl', 'notFound', 'userEdited'] as const) if (v[key] !== undefined && typeof v[key] !== 'boolean') return undefined;
	return copy(v) as unknown as SeriesMeta;
}

function safeUser(v: unknown): SeriesUser | undefined {
	if (!isObject(v) || !text(v.seriesId, 256, true) || (v.favorite !== undefined && typeof v.favorite !== 'boolean') || (v.rating !== undefined && !integer(v.rating, 1, 5)) || !finite(v.updatedAt)) return undefined;
	return copy(v) as unknown as SeriesUser;
}

function safeSettings(v: unknown): Settings | undefined {
	if (!isObject(v) || typeof v.persistFiles !== 'boolean' || typeof v.autoMetadata !== 'boolean' || !integer(v.cardSize, 80, 1000) || !isObject(v.reader)) return undefined;
	const r = v.reader;
	if (!['screen', 'width', 'height'].includes(String(r.fit)) || !['auto', 'single', 'double'].includes(String(r.spread)) || !['auto', 'ltr', 'rtl'].includes(String(r.direction)) || typeof r.background !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(r.background) || CONTROL.test(r.background) || typeof r.tapZones !== 'boolean' || typeof r.keepAwake !== 'boolean' || !integer(r.preload, 0, 6)) return undefined;
	return copy(v) as unknown as Settings;
}

function safeOrder(v: unknown): ReadingOrder | undefined {
	if (!isObject(v)) return undefined;
	const parsed = parseReadingOrderJson(v);
	if (!parsed.order || parsed.errors.length) return undefined;
	if (v.id !== undefined && !text(v.id, 256, true)) return undefined;
	if (v.createdAt !== undefined && !finite(v.createdAt)) return undefined;
	return { ...parsed.order, ...(typeof v.id === 'string' ? { id: v.id } : {}), ...(typeof v.createdAt === 'number' ? { createdAt: v.createdAt } : {}) };
}

export function parseBackup(input: string | unknown): BackupParseResult {
	if (typeof input === 'string') {
		if (input.length > MAX_CHARS) return { errors: ['Backupfilen är för stor (högst 10 MB).'], warnings: [] };
		try { return parseBackup(JSON.parse(input)); } catch { return { errors: ['Backupfilen innehåller ogiltig JSON.'], warnings: [] }; }
	}
	if (!isObject(input)) return { errors: ['Backupfilen måste innehålla ett JSON-objekt.'], warnings: [] };
	if (input.format !== BACKUP_FORMAT || input.version !== BACKUP_VERSION) return { errors: ['Backupfilen har en okänd version eller kommer från en annan app.'], warnings: [] };
	const errors: string[] = [];
	const list = <T>(key: string, fn: (v: unknown) => T | undefined): T[] => {
		if (!Array.isArray(input[key]) || input[key].length > MAX_ROWS) { errors.push(`Backupfilen saknar en giltig lista: ${key}.`); return []; }
		return input[key].flatMap((v, n) => { const row = fn(v); if (!row) errors.push(`${key}[${n}] är ogiltig.`); return row ? [row] : []; });
	};
	const issues = list('issues', safeIssue);
	const progress = list('progress', safeProgress);
	const seriesMeta = list('seriesMeta', safeMeta);
	const seriesUser = list('seriesUser', safeUser);
	const readingOrders = list('readingOrders', safeOrder);
	const settings = safeSettings(input.settings);
	if (!settings) errors.push('settings är ogiltiga.');
	const issueIds = new Set(issues.map((x) => x.id));
	if (issueIds.size !== issues.length) errors.push('Backupfilen innehåller dubbla nummer-id:n.');
	if (new Set(progress.map((x) => x.issueId)).size !== progress.length) errors.push('Backupfilen innehåller dubbla lässtatusposter.');
	if (progress.some((x) => !issueIds.has(x.issueId))) errors.push('Backupens lässtatus hänvisar till ett nummer som saknas.');
	if (new Set(seriesMeta.map((x) => x.seriesId)).size !== seriesMeta.length) errors.push('Backupfilen innehåller dubbla metadatafält.');
	if (new Set(seriesUser.map((x) => x.seriesId)).size !== seriesUser.length) errors.push('Backupfilen innehåller dubbla användarposter.');
	if (new Set(readingOrders.map((x) => x.id)).size !== readingOrders.length) errors.push('Backupfilen innehåller dubbla läsordningar.');
	if (errors.length) return { errors, warnings: [] };
	return { backup: { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(), issues, progress, seriesMeta, seriesUser, settings: settings!, readingOrders }, errors, warnings: [] };
}

export async function createBackup(storage?: Storage): Promise<LibraryBackup> {
	const [snapshot, settings] = await Promise.all([dbLoad(), loadSettings()]);
	return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), issues: snapshot.issues.map((i) => ({ ...copy(i), persisted: false })), progress: copy(snapshot.progress), seriesMeta: copy(snapshot.seriesMeta), seriesUser: copy(snapshot.seriesUser), settings: copy(settings), readingOrders: copy(loadReadingOrders(storage)) };
}

export async function downloadBackup(backup: LibraryBackup): Promise<boolean> {
	const json = JSON.stringify(backup, null, 2);
	await saveBlob(new Blob([json], { type: 'application/json' }), {
		fileName: `superlightreader-backup-${new Date().toISOString().slice(0, 10)}.json`,
		mimeType: 'application/json'
	});
	return true;
}

export async function readBackupFile(file: Blob): Promise<BackupParseResult> {
	if (file.size > MAX_CHARS) return { errors: ['Backupfilen är för stor (högst 10 MB).'], warnings: [] };
	return parseBackup(await file.text());
}

export async function restoreBackup(input: unknown, options: { replaceExisting?: boolean; replaceSettings?: boolean; storage?: Storage } = {}): Promise<BackupImportResult> {
	const parsed = parseBackup(input);
	const counts = (): BackupCounts => ({ issues: 0, metron: 0, progress: 0, seriesMeta: 0, seriesUser: 0, readingOrders: 0 });
	const out: BackupImportResult = { ok: false, errors: [...parsed.errors], warnings: [...parsed.warnings], added: counts(), updated: counts(), skipped: counts(), orphaned: [], conflicts: [], settings: 'skipped' };
	if (!parsed.backup) return out;
	const backup = parsed.backup;
	const replace = options.replaceExisting === true;
	const snapshot = await dbLoad();
	const currentIssues = new Map(snapshot.issues.map((x) => [x.id, x]));
	const issueIds = new Set(currentIssues.keys());
	const progressIds = new Set(snapshot.progress.map((x) => x.issueId));
	const metaIds = new Set(snapshot.seriesMeta.map((x) => x.seriesId));
	const userIds = new Set(snapshot.seriesUser.map((x) => x.seriesId));
	const issues = backup.issues.filter((x) => {
		if (!issueIds.has(x.id)) { out.added.issues++; issueIds.add(x.id); return true; }
		if (replace) { out.updated.issues++; return true; }
		out.skipped.issues++; out.conflicts.push(`issues:${x.id}`); return false;
	}).map((x) => ({ ...x, persisted: false }));
	const allIssueIds = new Set(issueIds);
	const progress = backup.progress.filter((x) => {
		if (!allIssueIds.has(x.issueId)) { out.orphaned.push(`progress:${x.issueId}`); return false; }
		if (progressIds.has(x.issueId) && !replace) { out.skipped.progress++; out.conflicts.push(`progress:${x.issueId}`); return false; }
		if (progressIds.has(x.issueId)) out.updated.progress++; else out.added.progress++;
		return true;
	});
	const seriesMeta = backup.seriesMeta.filter((x) => {
		if (metaIds.has(x.seriesId) && !replace) { out.skipped.seriesMeta++; out.conflicts.push(`seriesMeta:${x.seriesId}`); return false; }
		if (metaIds.has(x.seriesId)) out.updated.seriesMeta++; else out.added.seriesMeta++;
		return true;
	});
	const seriesUser = backup.seriesUser.filter((x) => {
		if (userIds.has(x.seriesId) && !replace) { out.skipped.seriesUser++; out.conflicts.push(`seriesUser:${x.seriesId}`); return false; }
		if (userIds.has(x.seriesId)) out.updated.seriesUser++; else out.added.seriesUser++;
		return true;
	});
	try { await dbPutBackupRows({ issues, progress, seriesMeta, seriesUser }); }
	catch { out.errors.push('IndexedDB kunde inte spara backupdata.'); return out; }
	const existingOrders = loadReadingOrders(options.storage); const ids = new Set(existingOrders.map((x) => x.id)); const orders = backup.readingOrders.filter((x) => {
		if (ids.has(x.id)) { out.skipped.readingOrders++; out.conflicts.push(`readingOrders:${x.id}`); return false; }
		ids.add(x.id); out.added.readingOrders++; return true;
	});
	if (orders.length && !saveReadingOrders([...existingOrders, ...orders], options.storage)) { out.errors.push('Läsordningar kunde inte sparas.'); out.added.readingOrders = 0; }
	if (options.replaceSettings) { try { await saveSettingsStrict(backup.settings); out.settings = 'imported'; } catch { out.settings = 'failed'; out.errors.push('Inställningar kunde inte sparas.'); } }
	out.ok = out.errors.length === 0; return out;
}
