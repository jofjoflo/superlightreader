import { clear, createStore, delMany, entries, setMany, values } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';
import type { Issue, Progress, SeriesMeta, SeriesUser } from './types.ts';

export interface DbSnapshot {
	issues: Issue[];
	progress: Progress[];
	seriesMeta: SeriesMeta[];
	seriesUser: SeriesUser[];
	covers: Map<string, Blob>; // issueId → thumbnail blob
}

export interface DbBackupRows {
	issues?: Issue[];
	progress?: Progress[];
	seriesMeta?: SeriesMeta[];
	seriesUser?: SeriesUser[];
}

const KINDS = ['issues', 'covers', 'progress', 'meta', 'user'] as const;
type Kind = (typeof KINDS)[number];

// One database per kind, created on first use so importing this module never touches IndexedDB.
const stores: Partial<Record<Kind, UseStore>> = {};
const db = (kind: Kind): UseStore => (stores[kind] ??= createStore(`slr-${kind}`, 'kv'));

/** Callers may hand us Svelte $state proxies, which structuredClone (IndexedDB) rejects. Never use on Blobs. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const put = async (kind: Kind, rows: [string, unknown][]) => {
	if (rows.length) await setMany(rows, db(kind));
};
const drop = async (kind: Kind, keys: string[]) => {
	if (keys.length) await delMany(keys, db(kind));
};

/** Persistence is best effort (quota, private mode): a failed write must never break the UI. */
async function safe(what: string, run: () => Promise<unknown>): Promise<void> {
	try {
		await run();
	} catch (e) {
		console.warn(`IndexedDB: ${what} failed`, e);
	}
}

export async function dbLoad(): Promise<DbSnapshot> {
	try {
		const [issues, progress, seriesMeta, seriesUser, covers] = await Promise.all([
			values<Issue>(db('issues')),
			values<Progress>(db('progress')),
			values<SeriesMeta>(db('meta')),
			values<SeriesUser>(db('user')),
			entries<string, Blob>(db('covers'))
		]);
		return { issues, progress, seriesMeta, seriesUser, covers: new Map(covers) };
	} catch (e) {
		console.warn('IndexedDB unavailable – starting with an empty library', e);
		return { issues: [], progress: [], seriesMeta: [], seriesUser: [], covers: new Map() };
	}
}

/** Upsert issue rows and their cover blobs (a missing `cover` leaves any stored cover untouched). */
export async function dbPutIssues(rows: { issue: Issue; cover?: Blob }[]): Promise<void> {
	await safe('put issues', () =>
		Promise.all([
			put('issues', rows.map(({ issue }) => [issue.id, plain(issue)])),
			put('covers', rows.flatMap(({ issue, cover }): [string, Blob][] => (cover ? [[issue.id, cover]] : [])))
		])
	);
}
export async function dbDeleteIssues(ids: string[]): Promise<void> {
	await safe('delete issues', () => Promise.all((['issues', 'covers', 'progress'] as const).map((k) => drop(k, ids))));
}
export async function dbPutProgress(p: Progress): Promise<void> {
	await dbPutProgressMany([p]);
}
export async function dbPutProgressMany(ps: Progress[]): Promise<void> {
	await safe('put progress', () => put('progress', ps.map((p) => [p.issueId, plain(p)])));
}
export async function dbPutSeriesMeta(m: SeriesMeta): Promise<void> {
	await safe('put series meta', () => put('meta', [[m.seriesId, plain(m)]]));
}
export async function dbPutSeriesUser(u: SeriesUser): Promise<void> {
	await safe('put series user', () => put('user', [[u.seriesId, plain(u)]]));
}

/** Backup restore path: does not touch covers and lets storage failures reach the caller. */
export async function dbPutBackupRows(rows: DbBackupRows): Promise<void> {
	await Promise.all([
		put('issues', (rows.issues ?? []).map((issue): [string, unknown] => [issue.id, plain({ ...issue, persisted: false })])),
		put('progress', (rows.progress ?? []).map((progress): [string, unknown] => [progress.issueId, plain(progress)])),
		put('meta', (rows.seriesMeta ?? []).map((meta): [string, unknown] => [meta.seriesId, plain(meta)])),
		put('user', (rows.seriesUser ?? []).map((user): [string, unknown] => [user.seriesId, plain(user)]))
	]);
}

/** Remove meta + user rows of a series (not its issues). */
export async function dbDeleteSeriesRows(seriesId: string): Promise<void> {
	await safe('delete series rows', () => Promise.all([drop('meta', [seriesId]), drop('user', [seriesId])]));
}
/** Wipe everything (library data, not settings). */
export async function dbClear(): Promise<void> {
	await safe('clear', () => Promise.all(KINDS.map((k) => clear(db(k)))));
}
