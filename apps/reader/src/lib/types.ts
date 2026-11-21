/**
 * SHARED CONTRACT. Every module imports its types from here.
 * Pure modules must only use erasable TS (no enums/namespaces) so `node --test` can run them.
 */

export const UNKNOWN_PUBLISHER = 'Okänt förlag';

// ───────────────────────── Archive ─────────────────────────

export interface ArchivePage {
	index: number; // position in natural-sorted page list
	name: string; // entry path inside archive
	size: number; // uncompressed bytes
	mime: string; // image/avif | image/webp | image/jpeg | image/png | image/gif | image/bmp
}

export interface ComicArchive {
	format: 'zip' | 'rar';
	pages: ArchivePage[];
	/** Blob typed with page.mime. Must be cheap for zip "stored" entries (Blob.slice, no copy). */
	readPage(index: number): Promise<Blob>;
	/** Basename match, case-insensitive, any folder. e.g. readText('ComicInfo.xml'). */
	readText(name: string): Promise<string | undefined>;
	close(): void;
}

// ───────────────────────── Parsing ─────────────────────────

export interface ParsedName {
	series: string; // cleaned: no number/year/tags/extension
	number?: number; // 20 for "020"; 1.5 for "1.5"
	numberLabel?: string; // as written, e.g. "020", "Annual 1"
	volume?: number; // "v3", "Vol. 3" when an issue number is ALSO present
	year?: number; // 4-digit year found in filename, e.g. "(2025)"
	title?: string; // trailing title, e.g. "Saga 001 - Chapter One" → "Chapter One"
	kind: 'issue' | 'annual' | 'special' | 'oneshot';
}

export interface PathInfo {
	name: ParsedName; // from the file name
	folderSeries?: string; // series suggested by parent folder (year/tags stripped); undefined if folder is a generic container
	volumeYear?: number; // "(2016)" in a series folder name, i.e. volume start year
	publisher?: string; // normalized publisher found in an ancestor folder name
}

export interface ComicInfo {
	series?: string;
	number?: string;
	title?: string;
	volume?: number;
	year?: number;
	month?: number;
	publisher?: string; // raw, un-normalized
	imprint?: string;
	writers: string[];
	pencillers: string[];
	inkers: string[];
	colorists: string[];
	letterers: string[];
	coverArtists: string[];
	editors: string[];
	genres: string[];
	tags: string[];
	characters: string[];
	teams: string[];
	storyArc?: string;
	summary?: string;
	manga?: 'Yes' | 'No' | 'YesAndRightToLeft' | 'Unknown';
	ageRating?: string;
	languageISO?: string;
	pageCount?: number;
	web?: string;
	format?: string;
	pages: { image: number; type?: string; doublePage?: boolean }[];
}

// ───────────────────────── Persisted records ─────────────────────────

export interface Issue {
	id: string; // hash(fileName|size) – stable across sessions
	fileName: string;
	relPath: string;
	size: number;
	lastModified: number;
	addedAt: number;
	format: 'cbz' | 'cbr' | 'zip' | 'rar';
	seriesId: string;
	seriesName: string;
	volume?: number;
	volumeYear?: number;
	number?: number;
	numberLabel?: string;
	title?: string;
	year?: number;
	pageCount: number;
	publisher?: string; // normalized
	imprint?: string;
	writers?: string[];
	artists?: string[]; // pencillers + inkers + cover artists, unique
	genres?: string[];
	tags?: string[];
	characters?: string[];
	summary?: string;
	rtl?: boolean; // ComicInfo Manga=YesAndRightToLeft
	ageRating?: string;
	language?: string;
	wide?: number[]; // page indices flagged DoublePage in ComicInfo
	coverIndex: number;
	hasCover: boolean;
	color?: string; // dominant cover color '#rrggbb'
	coverW?: number;
	coverH?: number;
	persisted?: boolean; // a copy lives in OPFS
	unsupported?: string; // why it cannot be opened (e.g. 'rar')
	/** Optional issue-level metadata from the server-side Metron proxy. Local ComicInfo fields stay authoritative. */
	metron?: MetronIssue;
}

export interface MetronAttribution {
	source: string;
	url?: string;
}

/** Issue metadata returned by Metron. Kept separate from local ComicInfo-derived fields. */
export interface MetronIssue {
	source: 'metron';
	id: number;
	seriesName?: string;
	number?: string;
	volume?: number;
	year?: number;
	title?: string;
	description?: string;
	characters: string[];
	creators: string[];
	sourceUrl: string;
	attribution?: MetronAttribution[];
	confidence?: number;
	/** True when the result was retained for review rather than confidently auto-selected. */
	uncertain?: boolean;
}
export type IssueMetron = MetronIssue;

/** Online/user metadata, keyed by series id. All fields optional overrides. */
export interface SeriesMeta {
	seriesId: string;
	name?: string;
	description?: string;
	publisher?: string;
	startYear?: number;
	endYear?: number;
	genres?: string[];
	creators?: string[];
	related?: string[]; // titles of similar works, used by recommendations
	status?: 'ongoing' | 'ended';
	rtl?: boolean;
	source?: string; // 'wikipedia' | 'anilist' | 'googlebooks' | 'openlibrary' | 'user'
	sourceUrl?: string;
	matchedTitle?: string;
	confidence?: number; // 0..1
	fetchedAt?: number; // set only after a definitive answer (found or notFound); never on network error
	notFound?: boolean;
	userEdited?: boolean;
}

export interface Progress {
	issueId: string;
	page: number; // 0-based index of the page last viewed
	pageCount: number;
	completed: boolean;
	updatedAt: number;
}

export interface SeriesUser {
	seriesId: string;
	favorite?: boolean;
	rating?: number; // 1..5
	updatedAt: number;
}

// ───────────────────────── Derived ─────────────────────────

export interface Series {
	id: string;
	name: string;
	sortKey: string;
	publisher: string; // UNKNOWN_PUBLISHER if unknown
	startYear?: number;
	endYear?: number;
	genres: string[];
	creators: string[];
	description?: string;
	related: string[];
	status?: 'ongoing' | 'ended';
	issues: Issue[]; // sorted by volume, number, year, fileName
	issueCount: number;
	coverIssueId: string;
	color?: string;
	addedAt: number; // max addedAt of issues
	lastReadAt?: number;
	completedCount: number;
	progress: number; // 0..1 (completed issues + partial of the in-progress one)
	state: 'unread' | 'reading' | 'done';
	inProgressIssueId?: string;
	nextIssueId?: string; // what "Läs / Fortsätt" opens
	favorite: boolean;
	rating?: number;
	rtl: boolean;
	oneShot: boolean;
	complete: boolean; // ≥2 issues, numbers contiguous 1..max (0/1 start ok), no gaps
	matched: boolean; // meta from an online source or user
	meta?: SeriesMeta;
}

// ───────────────────────── Filters ─────────────────────────

export type SortKey = 'name' | 'added' | 'read' | 'year' | 'issues' | 'rating' | 'progress';

export interface Filters {
	q: string;
	/** Exact creator filter after case/accent folding; empty means no creator filter. */
	creator: string;
	publishers: string[];
	genres: string[];
	decades: number[]; // 1980, 1990 …
	status: 'all' | 'unread' | 'reading' | 'done' | 'favorites';
	kind: 'all' | 'series' | 'oneshot' | 'manga' | 'complete';
	sort: SortKey;
	desc: boolean;
}

export interface Facet<T = string> {
	value: T;
	count: number;
}
export interface Facets {
	publishers: Facet[];
	genres: Facet[];
	decades: Facet<number>[];
}

// ───────────────────────── Recommendations ─────────────────────────

export interface RecIssueItem {
	issue: Issue;
	series: Series;
	note?: string;
}
export interface RecSeriesItem {
	series: Series;
	note?: string; // short Swedish reason, e.g. "Liknar Saga"
}
export type RecRow =
	| { id: string; kind: 'issues'; title: string; subtitle?: string; items: RecIssueItem[] }
	| { id: string; kind: 'series'; title: string; subtitle?: string; href?: string; items: RecSeriesItem[] };

export interface Scored {
	series: Series;
	score: number;
	why: string; // Swedish, short
}

// ───────────────────────── Online metadata ─────────────────────────

export interface MetaQuery {
	name: string;
	year?: number;
	publisher?: string;
	manga?: boolean;
	creators?: string[];
	issueCount?: number;
}

export type MetaSource = 'wikipedia' | 'anilist' | 'googlebooks' | 'openlibrary';

export interface MetaCandidate {
	source: MetaSource;
	title: string;
	url?: string;
	description?: string;
	publisher?: string;
	genres?: string[];
	startYear?: number;
	endYear?: number;
	creators?: string[];
	related?: string[];
	status?: 'ongoing' | 'ended';
	score: number; // 0..1 how well it matches the query
}

// ───────────────────────── Scanning ─────────────────────────

export interface ScanInput {
	file: File;
	/** '/'-separated path incl. selected root folder, e.g. "Serier/Marvel/X-Men/X-Men 020.cbz"; just the file name if unknown. */
	path: string;
}

export interface CoverResult {
	blob: Blob;
	width: number;
	height: number;
	color: string; // dominant color '#rrggbb'
}

export interface ScanOptions {
	known?: Set<string>; // issue ids already indexed → skipped (but still reported via onKnown)
	concurrency?: number; // default 3
	signal?: AbortSignal;
	onProgress?: (done: number, total: number, label: string) => void;
	onIssue: (issue: Issue, cover: CoverResult | undefined, input: ScanInput) => Promise<void> | void;
	onKnown?: (id: string, input: ScanInput) => void; // for re-linking files of known issues
}

export interface ScanResult {
	added: number;
	skipped: number;
	failed: { path: string; error: string }[];
}

// ───────────────────────── Settings ─────────────────────────

export interface ReaderSettings {
	fit: 'screen' | 'width' | 'height';
	spread: 'auto' | 'single' | 'double';
	direction: 'auto' | 'ltr' | 'rtl';
	background: string; // css color
	tapZones: boolean;
	keepAwake: boolean;
	preload: number; // pages to preload ahead (default 2)
}

export interface Settings {
	persistFiles: boolean; // copy added files into OPFS (offline, no re-pick after reload)
	autoMetadata: boolean; // fetch online metadata automatically after scan
	cardSize: number; // min card width in px for grids
	reader: ReaderSettings;
}
