/**
 * Reactive app store (single instance). Owned by the orchestrator.
 * Update model: `$state.raw` collections are REPLACED (immutably) on change; derived views are lazy.
 * Import as: import { library } from '$lib/library.svelte';
 */
import { buildSeries } from './series.ts';
import { computeFacets } from './filter.ts';
import { buildHomeRows } from './recommend.ts';
import { scanFiles } from './scan.ts';
import { pickFiles } from './pick.ts';
import {
	dbLoad,
	dbPutIssues,
	dbDeleteIssues,
	dbPutProgressMany,
	dbPutSeriesMeta,
	dbPutSeriesUser,
	dbDeleteSeriesRows,
	dbClear
} from './db.ts';
import {
	opfsAvailable,
	opfsPut,
	opfsGet,
	opfsDelete,
	opfsList,
	opfsClear,
	storageEstimate,
	requestPersist
} from './files.ts';
import { loadSettings, saveSettings, defaultSettings } from './settings.ts';
import { createBackup, downloadBackup, parseBackup, readBackupFile, restoreBackup } from './backup.ts';
import type { BackupImportResult, LibraryBackup } from './backup.ts';
import { fetchSeriesMeta, candidateToMeta } from './metadata/index.ts';
import { applyMetronIssue, fetchMetronIssue, searchMetronIssues } from './metadata/metron.ts';
import { runPool, sleep } from './util.ts';
import { convertToAvifCbz } from './convert.ts';
import { UNKNOWN_PUBLISHER } from './types.ts';
import type {
	CoverResult,
	Issue,
	MetaCandidate,
	MetronIssue,
	MetaQuery,
	Progress,
	ReaderSettings,
	ScanInput,
	ScanResult,
	Series,
	SeriesMeta,
	SeriesUser,
	Settings
} from './types.ts';

const META_TTL = 45 * 864e5;

export interface ScanState {
	active: boolean;
	phase: 'idle' | 'scan' | 'copy';
	done: number;
	total: number;
	label: string;
	added: number;
	skipped: number;
	failed: { path: string; error: string }[];
}
export interface MetaJob {
	active: boolean;
	done: number;
	total: number;
	label: string;
}

export interface ConvertFailure {
	id: string;
	name: string;
	error: string;
}

export interface ConvertDownload {
	id: string;
	name: string;
	fileName: string;
	url: string;
	bytes: number;
}

/** Raw Metron match retained alongside ComicInfo; unknown fields are kept for future API changes. */
export interface ConvertState {
	active: boolean;
	done: number;
	total: number;
	current: string;
	pageDone: number;
	pageTotal: number;
	completed: number;
	failed: ConvertFailure[];
	downloads: ConvertDownload[];
	cancelled: boolean;
}

class Library {
	// ── persisted data (replace to update) ──
	ready = $state(false);
	issues = $state.raw<Issue[]>([]);
	progress = $state.raw<Record<string, Progress>>({});
	metas = $state.raw<Record<string, SeriesMeta>>({});
	users = $state.raw<Record<string, SeriesUser>>({});
	/** issueId → explicitly selected Metron issue. Never replaces ComicInfo fields. */
	metron = $state.raw<Record<string, MetronIssue>>({});
	/** issueId → object URL of the cover thumbnail */
	covers = $state.raw<Record<string, string>>({});
	/** issueIds whose file is readable right now (OPFS copy or picked this session) */
	linked = $state.raw<Record<string, true>>({});
	/** Issue ids added by the most recent import, useful for an explicit follow-up conversion action. */
	lastImportedIds = $state.raw<string[]>([]);

	settings = $state<Settings>(structuredClone(defaultSettings));
	scan = $state<ScanState>({ active: false, phase: 'idle', done: 0, total: 0, label: '', added: 0, skipped: 0, failed: [] });
	metaJob = $state<MetaJob>({ active: false, done: 0, total: 0, label: '' });
	convert = $state<ConvertState>({ active: false, done: 0, total: 0, current: '', pageDone: 0, pageTotal: 0, completed: 0, failed: [], downloads: [], cancelled: false });
	storage = $state({ usage: 0, quota: 0, opfs: false, persisted: false });

	// ── derived (lazy) ──
	series = $derived.by(() =>
		buildSeries({ issues: this.issues, progress: this.progress, meta: this.metas, user: this.users })
	);
	seriesById = $derived(new Map(this.series.map((s) => [s.id, s])));
	issueById = $derived(new Map(this.issues.map((i) => [i.id, i])));
	facets = $derived(computeFacets(this.series));
	homeRows = $derived(buildHomeRows(this.series));
	/** issues that cannot be opened until the user re-picks the folder */
	unlinked = $derived(this.issues.reduce((n, i) => n + (this.linked[i.id] || i.unsupported ? 0 : 1), 0));

	private files = new Map<string, File>();
	private chain: Promise<unknown> = Promise.resolve();
	private metaAbort?: AbortController;
	private convertAbort?: AbortController;
	private conversionUrls = new Set<string>();
	private pending = new Map<string, Progress>();
	private flushTimer?: ReturnType<typeof setTimeout>;
	private initP?: Promise<void>;

	// ───────────── lifecycle ─────────────

	/** Call once from the root layout onMount. Safe to call repeatedly. */
	init(): Promise<void> {
		return (this.initP ??= this.load());
	}

	private async load() {
		const [snap, settings] = await Promise.all([dbLoad(), loadSettings()]);
		this.settings = settings;
		this.issues = snap.issues;
		this.progress = Object.fromEntries(snap.progress.map((p) => [p.issueId, p]));
		this.metas = Object.fromEntries(snap.seriesMeta.map((m) => [m.seriesId, m]));
		this.users = Object.fromEntries(snap.seriesUser.map((u) => [u.seriesId, u]));
		this.metron = Object.fromEntries(
			snap.issues.flatMap((issue) => {
				const match = issue.metron;
				return match?.id ? [[issue.id, match] as const] : [];
			})
		);
		const covers: Record<string, string> = {};
		for (const [id, blob] of snap.covers) covers[id] = URL.createObjectURL(blob);
		this.covers = covers;
		const opfs = opfsAvailable();
		if (opfs) {
			try {
				this.linked = Object.fromEntries([...(await opfsList())].map((id) => [id, true as const]));
			} catch (e) {
				console.warn('opfsList failed', e);
			}
		}
		this.ready = true;
		void this.refreshStorage();
		addEventListener('pagehide', () => this.flushProgress());
		document.addEventListener('visibilitychange', () => document.hidden && this.flushProgress());
		if (import.meta.env.DEV) (window as unknown as { __slr: Library }).__slr = this;
		if (this.settings.autoMetadata) setTimeout(() => void this.enrichMissing(), 1500);
	}

	// ───────────── selectors ─────────────

	getSeries = (id: string): Series | undefined => this.seriesById.get(id);
	getIssue = (id: string): Issue | undefined => this.issueById.get(id);
	coverUrl = (issueId?: string): string | undefined => (issueId ? this.covers[issueId] : undefined);
	progressOf = (issueId: string): Progress | undefined => this.progress[issueId];
	isLinked = (issueId: string): boolean => !!this.linked[issueId];
	metronMatchOf = (issueId: string): MetronIssue | undefined => this.metron[issueId];

	/** Search through the same-origin server proxy; credentials never reach the browser. */
	async searchMetron(input: string | Issue | { name: string; number?: number | string; volume?: number; year?: number }, signal?: AbortSignal) {
		try { return await searchMetronIssues(typeof input === 'string' ? { name: input } : input, signal); }
		catch (e) { throw metronError(e); }
	}
	async metronDetail(id: number | string, signal?: AbortSignal, candidate?: Parameters<typeof fetchMetronIssue>[2]) {
		try { return await fetchMetronIssue(id, signal, candidate); }
		catch (e) { throw metronError(e); }
	}
	/** Persist only the chosen remote record. ComicInfo and reading progress remain untouched. */
	async applyMetronMatch(issueId: string, data: MetronIssue): Promise<MetronIssue | undefined> {
		const issue = this.issueById.get(issueId);
		if (!issue || data.source !== 'metron' || !Number.isSafeInteger(data.id) || data.id < 1) return undefined;
		const next = applyMetronIssue(issue, data);
		this.issues = this.issues.map((row) => (row.id === issueId ? next : row));
		this.metron = { ...this.metron, [issueId]: next.metron! };
		await dbPutIssues([{ issue: next }]);
		return next.metron;
	}
	applyMetronIssue = (issueId: string, data: MetronIssue): Promise<MetronIssue | undefined> => this.applyMetronMatch(issueId, data);

	/** The readable File for an issue, or undefined if the user must re-pick (see `pick`). */
	async getFile(id: string): Promise<File | undefined> {
		const f = this.files.get(id);
		if (f) return f;
		if (opfsAvailable()) {
			const o = await opfsGet(id).catch(() => undefined);
			if (o) {
				this.files.set(id, o);
				return o;
			}
		}
		return undefined;
	}

	// ───────────── adding / linking files ─────────────

	/** Open the native picker (call DIRECTLY from a click handler) then add/re-link whatever was chosen. */
	async pick(kind: 'folder' | 'files' = 'folder'): Promise<ScanResult | undefined> {
		const inputs = await pickFiles({ directory: kind === 'folder' });
		return inputs.length ? this.addFiles(inputs) : undefined;
	}

	/** Index new files (known ones are just re-linked). Jobs run one after another. */
	addFiles(inputs: ScanInput[], opts: { persist?: boolean } = {}): Promise<ScanResult> {
		const run = () => this.runScan(inputs, opts.persist ?? this.settings.persistFiles);
		const p = this.chain.then(run, run);
		this.chain = p.catch(() => {});
		return p;
	}

	/** Generate and add the built-in demo library. */
	async addDemo(): Promise<ScanResult> {
		this.scan = { ...this.scan, active: true, phase: 'scan', label: 'Skapar demodata…', done: 0, total: 1 };
		const { makeDemoInputs } = await import('./demo.ts');
		const inputs = await makeDemoInputs((done, total) => {
			this.scan.done = done;
			this.scan.total = total;
		});
		return this.addFiles(inputs);
	}

	private async runScan(inputs: ScanInput[], persist: boolean): Promise<ScanResult> {
		const useOpfs = persist && opfsAvailable();
		const known = new Set(this.issues.map((i) => i.id));
		const relink: { id: string; file: File }[] = [];
		const newlyLinked: string[] = [];
		let buffer: { issue: Issue; cover?: CoverResult }[] = [];
		this.scan = { active: true, phase: 'scan', done: 0, total: inputs.length, label: '', added: 0, skipped: 0, failed: [] };

		const flush = async () => {
			const rows = buffer;
			buffer = [];
			if (!rows.length) return;
			await dbPutIssues(rows.map((r) => ({ issue: r.issue, cover: r.cover?.blob })));
			const covers = { ...this.covers };
			for (const r of rows) if (r.cover) covers[r.issue.id] = URL.createObjectURL(r.cover.blob);
			const ids = newlyLinked.splice(0);
			this.covers = covers;
			this.linked = { ...this.linked, ...Object.fromEntries(ids.map((id) => [id, true as const])) };
			this.issues = [...this.issues, ...rows.map((r) => r.issue)];
		};

		let res: ScanResult = { added: 0, skipped: 0, failed: [] };
		const addedIds: string[] = [];
		try {
			res = await scanFiles(inputs, {
				known,
				concurrency: 3,
				onProgress: (done, total, label) => {
					this.scan.done = done;
					this.scan.total = total;
					this.scan.label = label;
				},
				onIssue: async (issue, cover, input) => {
					addedIds.push(issue.id);
					let kept = false;
					if (useOpfs && !issue.unsupported) {
						try {
							this.scan.phase = 'copy';
							await opfsPut(issue.id, input.file);
							issue.persisted = true;
							kept = true;
						} catch (e) {
							console.warn('OPFS copy failed – keeping in memory', e);
						} finally {
							this.scan.phase = 'scan';
						}
					}
					if (!kept) this.files.set(issue.id, input.file);
					newlyLinked.push(issue.id);
					buffer.push({ issue, cover });
					if (buffer.length >= 24) await flush();
				},
				onKnown: (id, input) => relink.push({ id, file: input.file })
			});
			await flush();
			await this.finishRelink(relink, useOpfs);
		} finally {
			this.lastImportedIds = addedIds;
			this.scan = { ...this.scan, active: false, phase: 'idle', added: res.added, skipped: res.skipped, failed: res.failed };
			void this.refreshStorage();
		}
		if (this.settings.autoMetadata && res.added) void this.enrichMissing();
		return res;
	}

	/** Files of already-indexed issues: make them readable now, and copy to OPFS if wanted. */
	private async finishRelink(relink: { id: string; file: File }[], useOpfs: boolean) {
		if (!relink.length) return;
		const linked = { ...this.linked };
		for (const r of relink) {
			if (!linked[r.id]) this.files.set(r.id, r.file);
			linked[r.id] = true;
		}
		this.linked = linked;
		if (!useOpfs) return;
		const todo = relink.filter((r) => !this.issueById.get(r.id)?.persisted);
		if (!todo.length) return;
		this.scan.phase = 'copy';
		this.scan.done = 0;
		this.scan.total = todo.length;
		const done = new Set<string>();
		for (const r of todo) {
			this.scan.label = r.file.name;
			try {
				await opfsPut(r.id, r.file);
				done.add(r.id);
				this.files.delete(r.id);
			} catch (e) {
				console.warn('OPFS copy failed', e);
				break;
			}
			this.scan.done++;
		}
		if (done.size) {
			this.issues = this.issues.map((i) => (done.has(i.id) ? { ...i, persisted: true } : i));
			await dbPutIssues(this.issues.filter((i) => done.has(i.id)).map((issue) => ({ issue })));
		}
	}

	// ───────────── reading progress ─────────────

	saveProgress(issueId: string, page: number, pageCount: number) {
		const prev = this.progress[issueId];
		const reachedEnd = pageCount > 0 && page >= pageCount - 1;
		const p: Progress = { issueId, page, pageCount, completed: !!prev?.completed || reachedEnd, updatedAt: Date.now() };
		this.progress = { ...this.progress, [issueId]: p };
		this.pending.set(issueId, p);
		clearTimeout(this.flushTimer);
		this.flushTimer = setTimeout(() => this.flushProgress(), 700);
	}

	flushProgress() {
		clearTimeout(this.flushTimer);
		if (!this.pending.size) return;
		const ps = [...this.pending.values()];
		this.pending.clear();
		void dbPutProgressMany(ps);
	}

	markIssues(ids: string[], read: boolean) {
		const next = { ...this.progress };
		const out: Progress[] = [];
		const now = Date.now();
		for (const id of ids) {
			const i = this.issueById.get(id);
			if (!i) continue;
			const p: Progress = read
				? { issueId: id, page: Math.max(0, i.pageCount - 1), pageCount: i.pageCount, completed: true, updatedAt: now }
				: { issueId: id, page: 0, pageCount: i.pageCount, completed: false, updatedAt: next[id]?.updatedAt ?? 0 };
			next[id] = p;
			out.push(p);
		}
		this.progress = next;
		void dbPutProgressMany(out);
	}
	markSeriesRead(seriesId: string, read: boolean) {
		const s = this.seriesById.get(seriesId);
		if (s) this.markIssues(s.issues.map((i) => i.id), read);
	}

	// ───────────── user data ─────────────

	private patchUser(seriesId: string, patch: Partial<SeriesUser>) {
		const u: SeriesUser = { ...this.users[seriesId], seriesId, ...patch, updatedAt: Date.now() };
		this.users = { ...this.users, [seriesId]: u };
		void dbPutSeriesUser(u);
	}
	toggleFavorite(seriesId: string) {
		this.patchUser(seriesId, { favorite: !this.users[seriesId]?.favorite });
	}
	setRating(seriesId: string, rating?: number) {
		this.patchUser(seriesId, { rating });
	}

	// ───────────── metadata ─────────────

	metaQuery(s: Series): MetaQuery {
		return {
			name: s.issues[0]?.seriesName ?? s.name,
			year: s.startYear,
			publisher: s.publisher === UNKNOWN_PUBLISHER ? undefined : s.publisher,
			manga: s.rtl || undefined,
			creators: s.creators.slice(0, 3),
			issueCount: s.issueCount
		};
	}

	private putMeta(m: SeriesMeta) {
		this.metas = { ...this.metas, [m.seriesId]: m };
		void dbPutSeriesMeta(m);
	}

	/** Manual edit from the UI (name, description, publisher, genres …). Marks the record userEdited. */
	setSeriesMeta(seriesId: string, patch: Partial<SeriesMeta>) {
		const prev = this.metas[seriesId];
		this.putMeta({
			...prev,
			...patch,
			seriesId,
			source: patch.source ?? prev?.source ?? 'user',
			userEdited: true,
			notFound: false,
			fetchedAt: Date.now()
		});
	}

	/** Use a candidate picked from `searchMeta` ("Fel match? Sök igen"). */
	applyCandidate(seriesId: string, c: MetaCandidate): SeriesMeta {
		const m = candidateToMeta(seriesId, c, true);
		this.putMeta(m);
		return m;
	}

	/** Auto-fetch for one series. Returns undefined on network failure. Skips fresh/user-edited unless force. */
	async enrichSeries(
		seriesId: string,
		opts: { force?: boolean; query?: string; signal?: AbortSignal } = {}
	): Promise<SeriesMeta | undefined> {
		const s = this.seriesById.get(seriesId);
		const prev = this.metas[seriesId];
		if (!s) return prev;
		if (!opts.force && prev && (prev.userEdited || (prev.fetchedAt && Date.now() - prev.fetchedAt < META_TTL))) return prev;
		const q = this.metaQuery(s);
		if (opts.query) q.name = opts.query;
		const m = await fetchSeriesMeta(seriesId, q, opts.signal);
		if (!m) return undefined;
		if (this.metas[seriesId]?.userEdited && !opts.force) return this.metas[seriesId];
		this.putMeta(m);
		return m;
	}

	/** Background job: fetch metadata for every series that has none (or stale). */
	async enrichMissing(force = false) {
		if (this.metaJob.active || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
		const now = Date.now();
		const todo = this.series.filter((s) => {
			const m = this.metas[s.id];
			if (m?.userEdited) return false;
			return force || !m || !m.fetchedAt || now - m.fetchedAt > META_TTL;
		});
		if (!todo.length) return;
		const ac = (this.metaAbort = new AbortController());
		this.metaJob = { active: true, done: 0, total: todo.length, label: '' };
		let netFails = 0;
		try {
			await runPool(
				todo,
				2,
				async (s) => {
					this.metaJob.label = s.name;
					const m = await this.enrichSeries(s.id, { force: true, signal: ac.signal }).catch(() => undefined);
					netFails = m ? 0 : netFails + 1;
					if (netFails >= 6) ac.abort(); // probably offline
					this.metaJob.done++;
					await sleep(250);
				},
				ac.signal
			);
		} finally {
			this.metaJob = { ...this.metaJob, active: false };
		}
	}
	cancelMeta() {
		this.metaAbort?.abort();
	}

	// ───────────── removal ─────────────

	async removeIssues(ids: string[]) {
		const set = new Set(ids);
		const covers = { ...this.covers };
		const linked = { ...this.linked };
		const progress = { ...this.progress };
		const metron = { ...this.metron };
		for (const id of ids) {
			if (covers[id]) URL.revokeObjectURL(covers[id]);
			delete covers[id];
			delete linked[id];
			delete progress[id];
			delete metron[id];
			this.files.delete(id);
		}
		this.covers = covers;
		this.linked = linked;
		this.progress = progress;
		this.metron = metron;
		this.issues = this.issues.filter((i) => !set.has(i.id));
		await dbDeleteIssues(ids);
		if (opfsAvailable()) await Promise.all(ids.map((id) => opfsDelete(id).catch(() => {})));
		void this.refreshStorage();
	}

	async removeSeries(seriesId: string) {
		const s = this.seriesById.get(seriesId);
		if (!s) return;
		await this.removeIssues(s.issues.map((i) => i.id));
		const { [seriesId]: _m, ...metas } = this.metas;
		const { [seriesId]: _u, ...users } = this.users;
		this.metas = metas;
		this.users = users;
		await dbDeleteSeriesRows(seriesId);
	}

	/** Wipe the whole library (issues, covers, progress, metadata, OPFS copies). Settings are kept. */
	async clearAll() {
		this.cancelMeta();
		this.cancelConvert();
		for (const url of this.conversionUrls) URL.revokeObjectURL(url);
		this.conversionUrls.clear();
		for (const u of Object.values(this.covers)) URL.revokeObjectURL(u);
		this.files.clear();
		this.pending.clear();
		this.issues = [];
		this.progress = {};
		this.metas = {};
		this.users = {};
		this.metron = {};
		this.covers = {};
		this.linked = {};
		await dbClear();
		if (opfsAvailable()) await opfsClear().catch(() => {});
		void this.refreshStorage();
	}

	// ───────────── settings & storage ─────────────

	async exportBackup(): Promise<LibraryBackup> { return createBackup(); }
	downloadBackup(): Promise<boolean> {
		return createBackup().then((backup) => downloadBackup(backup));
	}
	validateBackup(input: unknown) { return parseBackup(input); }
	readBackupFile(file: Blob) { return readBackupFile(file); }
	async importBackup(input: unknown, opts: { importSettings?: boolean } = {}): Promise<BackupImportResult> {
		const result = await restoreBackup(input, { replaceExisting: false, replaceSettings: opts.importSettings === true });
		if (result.ok || result.added.issues || result.updated.issues || result.added.progress || result.updated.progress || result.added.seriesMeta || result.updated.seriesMeta || result.added.seriesUser || result.updated.seriesUser) {
			const snap = await dbLoad();
			this.issues = snap.issues;
			this.progress = Object.fromEntries(snap.progress.map((row) => [row.issueId, row]));
			this.metas = Object.fromEntries(snap.seriesMeta.map((row) => [row.seriesId, row]));
			this.users = Object.fromEntries(snap.seriesUser.map((row) => [row.seriesId, row]));
			this.metron = Object.fromEntries(snap.issues.flatMap((row) => row.metron ? [[row.id, row.metron] as const] : []));
			this.linked = Object.fromEntries(Object.keys(this.linked).filter((id) => snap.issues.some((row) => row.id === id)).map((id) => [id, true as const]));
		}
		if (result.settings === 'imported') this.settings = await loadSettings();
		return result;
	}

	updateSettings(patch: Partial<Omit<Settings, 'reader'>>) {
		this.settings = { ...this.settings, ...patch };
		void saveSettings(this.settings);
	}
	updateReader(patch: Partial<ReaderSettings>) {
		this.settings = { ...this.settings, reader: { ...this.settings.reader, ...patch } };
		void saveSettings(this.settings);
	}

	async refreshStorage() {
		const e = await storageEstimate().catch(() => ({ usage: 0, quota: 0 }));
		this.storage = { ...this.storage, ...e, opfs: opfsAvailable() };
	}
	async persistStorage() {
		this.storage = { ...this.storage, persisted: await requestPersist().catch(() => false) };
	}

	// ───────────── AVIF conversion ─────────────

	/** Convert selected readable originals and download new CBZ files. Originals/library rows stay untouched. */
	async convertIssues(ids: string[], opts: { quality: number; maxWidth?: number }): Promise<ConvertState> {
		if (this.convert.active) return this.convert;
		for (const url of this.conversionUrls) URL.revokeObjectURL(url);
		this.conversionUrls.clear();
		const unique = [...new Set(ids)].filter((id) => this.issueById.has(id));
		const ac = (this.convertAbort = new AbortController());
		this.convert = {
			active: true,
			done: 0,
			total: unique.length,
			current: '',
			pageDone: 0,
			pageTotal: 0,
			completed: 0,
			failed: [],
			downloads: [],
			cancelled: false
		};
		try {
			for (const id of unique) {
				if (ac.signal.aborted) break;
				const issue = this.issueById.get(id);
				if (!issue) continue;
				this.convert.current = issue.fileName;
				this.convert.pageDone = 0;
				this.convert.pageTotal = 0;
				try {
					const source = await this.getFile(id);
					if (!source) throw new Error('Filen är inte länkad – välj mappen eller filen igen.');
					// OPFS uses an internal .bin name; preserve the original archive name for output naming.
					const namedSource = source.name === issue.fileName ? source : new File([source], issue.fileName, { type: source.type, lastModified: source.lastModified });
					const result = await convertToAvifCbz(namedSource, {
						quality: Math.max(1, Math.min(100, opts.quality)),
						// 0 means preserve source width; core normalises this explicitly.
						maxWidth: opts.maxWidth,
						signal: ac.signal,
						onProgress: (done: number, total: number) => {
							this.convert.pageDone = done;
							this.convert.pageTotal = total;
						}
					});
					const blob = result instanceof Blob ? result : result.blob;
					if (!(blob instanceof Blob)) throw new Error('Konverteringen gav ingen CBZ-fil.');
					const suggested = result instanceof Blob ? undefined : result.fileName;
					const fileName = suggested || avifName(issue.fileName);
					const url = URL.createObjectURL(blob);
					this.conversionUrls.add(url);
					this.convert.downloads = [...this.convert.downloads, { id, name: issue.fileName, fileName, url, bytes: blob.size }];
					this.convert.completed++;
				} catch (e) {
					if (ac.signal.aborted || isAbortError(e)) break;
					this.convert.failed = [
						...this.convert.failed,
						{ id, name: issue.fileName, error: e instanceof Error ? e.message : 'Okänt fel' }
					];
				}
				this.convert.done++;
			}
		} finally {
			this.convert = { ...this.convert, active: false, cancelled: ac.signal.aborted };
			this.convertAbort = undefined;
		}
		return this.convert;
	}

	cancelConvert() {
		this.convertAbort?.abort();
	}

	/** Delete OPFS copies only (library stays; files must be re-picked to read). */
	async clearCopies() {
		if (opfsAvailable()) await opfsClear().catch(() => {});
		const keep = new Set(this.files.keys());
		this.linked = Object.fromEntries([...keep].map((id) => [id, true as const]));
		this.issues = this.issues.map((i) => ({ ...i, persisted: false }));
		await dbPutIssues(this.issues.map((issue) => ({ issue })));
		void this.refreshStorage();
	}
}

export const library = new Library();

function metronError(error: unknown): Error {
	const status = Number((error as { status?: number } | null)?.status);
	if (status === 503) return new Error('Metron är inte konfigurerat på servern. Kontakta administratören eller försök senare.');
	if (status === 429) return new Error('Metron har tillfälligt för många förfrågningar. Vänta en stund och försök igen.');
	return error instanceof Error ? error : new Error('Metron kunde inte nås. Kontrollera anslutningen.');
}

function avifName(name: string): string {
	return `${name.replace(/\.[^.]+$/, '')} AVIF.cbz`;
}

function isAbortError(e: unknown): boolean {
	return (typeof DOMException !== 'undefined' && e instanceof DOMException) ? e.name === 'AbortError' : (e as { name?: string } | null)?.name === 'AbortError';
}
