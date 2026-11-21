import type { ComicArchive, ComicInfo, CoverResult, Issue, ScanInput, ScanOptions, ScanResult } from './types.ts';
import { isComicFileName, openArchive } from './archive.ts';
import { parseComicInfo } from './parse/comicinfo.ts';
import { parsePath, seriesKey } from './parse/name.ts';
import { normalizePublisher } from './parse/publishers.ts';
import { clamp, hash, runPool, uniq } from './util.ts';

/** Injection points (tests). Defaults: the real archive reader and the browser-only cover maker (imported lazily). */
export interface ScanDeps {
	openArchive?: (file: Blob & { name?: string }) => Promise<ComicArchive>;
	makeCover?: (image: Blob) => Promise<CoverResult>;
}

const FORMATS = ['cbz', 'cbr', 'zip', 'rar'] as const;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const text = (s?: string): string | undefined => s?.trim() || undefined;
const some = <T>(a?: T[]): T[] | undefined => (a?.length ? a : undefined);
const positive = (n?: number): number | undefined => (n !== undefined && n > 0 ? n : undefined);

/** Stable id from file name + size. Base name only (moving a file keeps its id). */
export function issueIdFor(file: { name: string; size: number }): string {
	const base = file.name.split(/[\\/]/).pop()!;
	return hash(`${base.normalize('NFC').toLowerCase()}|${file.size}`);
}

/** Issue from file name/path, enriched by ComicInfo when given. Priority: ComicInfo > folder > file name. */
function buildIssue(input: ScanInput, now: number, info?: ComicInfo, pageCount = 0): Issue {
	const { file } = input;
	const { name, folderSeries, volumeYear, publisher } = parsePath(input.path || file.name);

	const seriesName =
		text(info?.series) ?? (folderSeries || name.series || file.name.replace(/\.[^.]*$/, '') || 'Okänd serie');

	const label = text(info?.number);
	const parsed = label === undefined ? NaN : parseFloat(label);
	const numbered = Number.isFinite(parsed);

	// ComicInfo <Volume> is often the volume's start year (ComicTagger): treat 4-digit values as volumeYear.
	const infoVolume = positive(info?.volume);
	const volIsYear = infoVolume !== undefined && infoVolume >= 1900 && infoVolume <= 2099;
	const volume = volIsYear ? name.volume : (infoVolume ?? name.volume);
	const vYear = (volIsYear ? infoVolume : undefined) ?? volumeYear;

	const front = info?.pages.find((p) => p.type?.toLowerCase() === 'frontcover');
	const ext = file.name.split('.').pop()!.toLowerCase();

	return {
		id: issueIdFor(file),
		fileName: file.name,
		relPath: input.path,
		size: file.size,
		lastModified: file.lastModified,
		addedAt: now,
		format: FORMATS.find((f) => f === ext) ?? 'cbz',
		seriesId: seriesKey(seriesName, volume, vYear),
		seriesName,
		volume,
		volumeYear: vYear,
		number: numbered ? parsed : name.number,
		numberLabel: numbered ? label : name.numberLabel,
		title: text(info?.title) ?? name.title,
		year: positive(info?.year) ?? name.year,
		pageCount,
		publisher: normalizePublisher(info?.publisher) ?? publisher,
		imprint: text(info?.imprint),
		writers: some(info?.writers),
		artists: some(uniq([...(info?.pencillers ?? []), ...(info?.inkers ?? []), ...(info?.coverArtists ?? [])])),
		genres: some(info?.genres),
		tags: some(info?.tags),
		characters: some(info?.characters),
		summary: text(info?.summary),
		rtl: info?.manga === 'YesAndRightToLeft',
		ageRating: text(info?.ageRating),
		language: text(info?.languageISO),
		wide: some(uniq(info?.pages.filter((p) => p.doublePage && p.image >= 0 && p.image < pageCount).map((p) => p.image) ?? [])),
		coverIndex: clamp(Math.trunc(front?.image ?? 0) || 0, 0, Math.max(0, pageCount - 1)),
		hasCover: false
	};
}

/**
 * Why a file that failed to open still deserves a shelf entry: RAR (support missing/corrupt), encrypted or corrupt.
 * undefined = no zip/rar signature (or unreadable) → not an archive at all.
 */
async function unsupportedReason(file: Blob, err: unknown): Promise<'rar' | 'encrypted' | 'corrupt' | undefined> {
	let b: Uint8Array;
	try {
		b = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	} catch {
		return undefined;
	}
	const zip = b[0] === 0x50 && b[1] === 0x4b; // "PK"
	const rar = b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21; // "Rar!"
	if (!zip && !rar) return undefined;
	const msg = errMsg(err);
	if (/krypter|lösenord/i.test(msg)) return 'encrypted'; // zip.ts: "Krypterad…", rar.ts: "…lösenordsskyddad"
	return rar && !/skadad|giltig/i.test(msg) ? 'rar' : 'corrupt'; // rar.ts: "…skadad", "…inte ett giltigt RAR-arkiv"
}

/**
 * Open archive → ComicInfo + path/filename parse → page count → cover.
 * A zip/rar that cannot be opened (no RAR support, encrypted, corrupt) yields a filename-only issue with `unsupported` set.
 * Throws for anything else unreadable (not an archive, no pages, I/O error).
 */
export async function scanFile(
	input: ScanInput,
	now: number = Date.now(),
	deps: ScanDeps = {}
): Promise<{ issue: Issue; cover?: CoverResult }> {
	const { file } = input;
	let archive: ComicArchive;
	try {
		archive = await (deps.openArchive ?? openArchive)(file);
	} catch (err) {
		const unsupported = await unsupportedReason(file, err);
		if (!unsupported) throw err;
		return { issue: { ...buildIssue(input, now), unsupported } };
	}
	try {
		let info: ComicInfo | undefined;
		try {
			const xml = await archive.readText('ComicInfo.xml');
			if (xml) info = parseComicInfo(xml);
		} catch {
			// unreadable ComicInfo.xml: go by file name/path
		}
		if (!archive.pages.length) throw new Error('Inga bildsidor i arkivet');
		const issue = buildIssue(input, now, info, archive.pages.length);

		let cover: CoverResult | undefined;
		try {
			const makeCover = deps.makeCover ?? (await import('./covers.ts')).makeCover;
			const c = await makeCover(await archive.readPage(issue.coverIndex));
			issue.hasCover = true;
			issue.color = c.color;
			issue.coverW = c.width;
			issue.coverH = c.height;
			cover = c;
		} catch {
			// undecodable cover: keep the issue without one
		}
		return { issue, cover };
	} finally {
		try {
			archive.close();
		} catch {
			// ignore
		}
	}
}

/**
 * Concurrency-limited scan. Never throws for single-file failures (collected in result.failed).
 * Known ids are skipped (onKnown), identical ids within the batch are scanned once, onProgress counts only files actually scanned.
 */
export async function scanFiles(inputs: ScanInput[], opts: ScanOptions, deps: ScanDeps = {}): Promise<ScanResult> {
	const result: ScanResult = { added: 0, skipped: 0, failed: [] };
	const queued = new Set<string>();
	const todo: ScanInput[] = [];
	for (const input of inputs) {
		if (!isComicFileName(input.file.name)) continue;
		const id = issueIdFor(input.file);
		if (opts.known?.has(id)) {
			result.skipped++;
			opts.onKnown?.(id, input);
		} else if (queued.has(id)) {
			result.skipped++;
		} else {
			queued.add(id);
			todo.push(input);
		}
	}

	let done = 0;
	await runPool(
		todo,
		Math.max(1, opts.concurrency || 3),
		async (input) => {
			try {
				const { issue, cover } = await scanFile(input, Date.now(), deps);
				await opts.onIssue(issue, cover, input);
				result.added++;
			} catch (e) {
				result.failed.push({ path: input.path, error: errMsg(e) });
			}
			opts.onProgress?.(++done, todo.length, input.file.name);
		},
		opts.signal
	);
	return result;
}
