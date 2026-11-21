import { UNKNOWN_PUBLISHER } from './types.ts';
import type { Issue, Progress, Series, SeriesMeta, SeriesUser } from './types.ts';
import { naturalCompare } from './util.ts';
import { normalizeGenres } from './parse/genres.ts';

export interface SeriesInput {
	issues: Issue[];
	progress: Record<string, Progress>; // by issueId
	meta: Record<string, SeriesMeta>; // by seriesId
	user: Record<string, SeriesUser>; // by seriesId
}

const MAX_GENRES = 12;
const MAX_CREATORS = 10;
/** Years from these sources are unreliable (first edition of some random book), so they never set startYear. */
const LOW_CONF = new Set(['openlibrary', 'googlebooks']);
const ARTICLE = /^(?:the|a|an|en|ett)\s+(?=\S)/;

/** Own-property lookup: series ids are name slugs, so "constructor" must not resolve to Object.prototype. */
const own = <T>(rec: Record<string, T>, key: string): T | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);

const sortKeyOf = (name: string): string => name.trim().toLowerCase().replace(ARTICLE, '');

/** Ascending, missing (undefined) last; 0 when equal so `||` chains fall through to the next key. */
const byNum = (a?: number, b?: number): number => (a ?? Infinity) - (b ?? Infinity) || 0;

const compareIssues = (a: Issue, b: Issue): number =>
	byNum(a.volume, b.volume) ||
	byNum(a.number, b.number) ||
	byNum(a.year, b.year) ||
	naturalCompare(a.fileName, b.fileName) ||
	(a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // input-order independent

/** Case-insensitive union of string lists: first spelling wins, blanks dropped, capped at `max`. */
function union(max: number, lists: (string[] | undefined)[]): string[] {
	const seen = new Map<string, string>();
	for (const list of lists)
		for (const raw of list ?? []) {
			const s = raw.trim();
			const k = s.toLowerCase();
			if (s && !seen.has(k)) seen.set(k, s);
		}
	return [...seen.values()].slice(0, max);
}

/** Most frequent value; ties go to the one seen first. */
function majority(values: (string | undefined)[]): string | undefined {
	const counts = new Map<string, number>();
	for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best: string | undefined;
	let top = 0;
	for (const [v, n] of counts)
		if (n > top) {
			best = v;
			top = n;
		}
	return best;
}

/** ≥2 distinct whole issue numbers forming an unbroken run from 0 or 1 up to the highest. Decimals/unnumbered are ignored. */
function isComplete(issues: Issue[]): boolean {
	const nums = new Set<number>();
	let min = Infinity;
	let max = -Infinity;
	for (const { number: x } of issues) {
		if (x === undefined || !Number.isInteger(x) || x < 0) continue;
		nums.add(x);
		min = Math.min(min, x);
		max = Math.max(max, x);
	}
	return nums.size >= 2 && (min === 0 || min === 1) && nums.size === max - min + 1;
}

/** Derive one Series. `issues` must be an array we own (it is sorted in place). */
function derive(id: string, issues: Issue[], input: SeriesInput): Series {
	issues.sort(compareIssues);
	const n = issues.length;
	const meta = own(input.meta, id);
	const user = own(input.user, id);
	const recs = issues.map((i) => own(input.progress, i.id));

	let addedAt = 0;
	let lastReadAt = 0;
	let completedCount = 0;
	let partial = 0; // sum of read fractions of started-but-unfinished issues
	let minYear = Infinity;
	let minVolumeYear = Infinity;
	let reading = -1; // index of the most recently touched in-progress issue
	let readingAt = -1;
	let finished = -1; // index of the most recently completed issue
	let finishedAt = -1;
	for (let i = 0; i < n; i++) {
		const issue = issues[i];
		addedAt = Math.max(addedAt, issue.addedAt);
		if (issue.year !== undefined) minYear = Math.min(minYear, issue.year);
		if (issue.volumeYear !== undefined) minVolumeYear = Math.min(minVolumeYear, issue.volumeYear);
		const p = recs[i];
		if (!p) continue;
		const at = p.updatedAt || 0;
		lastReadAt = Math.max(lastReadAt, at);
		if (p.completed) {
			completedCount++;
			if (at >= finishedAt) {
				finished = i;
				finishedAt = at;
			}
		} else if (p.page > 0) {
			const pages = p.pageCount || issue.pageCount;
			if (pages > 0) partial += Math.min(1, p.page / pages);
			if (at >= readingAt) {
				reading = i;
				readingAt = at;
			}
		}
	}

	// In progress, else the first unfinished issue after the one finished last, else the first unfinished, else the first.
	const firstOpen = (from: number): Issue | undefined => {
		for (let i = from; i < n; i++) if (!recs[i]?.completed) return issues[i];
		return undefined;
	};
	const next = reading >= 0 ? issues[reading] : (firstOpen(finished + 1) ?? firstOpen(0) ?? issues[0]);
	const cover = issues.find((i) => i.hasCover) ?? issues[0];
	const allDone = completedCount === n;
	const name = (meta?.userEdited && meta.name) || issues[0].seriesName; // auto-matched metadata never renames a series

	return {
		id,
		name,
		sortKey: sortKeyOf(name),
		publisher:
			(meta?.userEdited && meta.publisher) ||
			majority(issues.map((i) => i.publisher)) ||
			meta?.publisher ||
			UNKNOWN_PUBLISHER,
		// user edit > volume year from folder name "(1991)" > online match > earliest owned issue year
		startYear:
			(meta?.userEdited && meta.startYear) ||
			(minVolumeYear < Infinity ? minVolumeYear : undefined) ||
			(meta && !LOW_CONF.has(meta.source ?? '') ? meta.startYear : undefined) ||
			(minYear < Infinity ? minYear : undefined),
		endYear: meta?.endYear,
		genres: union(MAX_GENRES, [...issues.map((i) => normalizeGenres(i.genres)), normalizeGenres(meta?.genres)]),
		// Local ComicInfo remains first; Metron creators are additive and never replace it.
		creators: union(MAX_CREATORS, [...issues.flatMap((i) => [i.writers, i.artists, i.metron?.creators]), meta?.creators]),
		description: meta?.description || issues.find((i) => i.summary)?.summary,
		related: meta?.related ?? [],
		status: meta?.status,
		issues,
		issueCount: n,
		coverIssueId: cover.id,
		color: cover.color,
		addedAt,
		lastReadAt: lastReadAt > 0 ? lastReadAt : undefined,
		completedCount,
		progress: allDone ? 1 : (completedCount + partial) / n,
		state: allDone ? 'done' : completedCount > 0 || reading >= 0 ? 'reading' : 'unread',
		inProgressIssueId: reading >= 0 ? issues[reading].id : undefined,
		nextIssueId: next.id,
		favorite: !!user?.favorite,
		rating: user?.rating || undefined,
		rtl: meta?.rtl ?? issues.some((i) => i.rtl),
		oneShot: n === 1 && issues[0].number === undefined,
		complete: isComplete(issues),
		matched: !!meta?.source && !meta.notFound,
		meta
	};
}

/** Group issues by issue.seriesId and derive every field of Series. See docs/architecture.md → "Serie-derivering". Pure. */
export function buildSeries(input: SeriesInput): Series[] {
	const groups = new Map<string, Issue[]>();
	for (const issue of input.issues) {
		const group = groups.get(issue.seriesId);
		if (group) group.push(issue);
		else groups.set(issue.seriesId, [issue]);
	}
	const out: Series[] = [];
	for (const [id, issues] of groups) out.push(derive(id, issues, input));

	// Same display name → tell them apart by start year, else by publisher (nothing to add if that is unknown too).
	const byName = new Map<string, Series[]>();
	for (const s of out) {
		const group = byName.get(s.name);
		if (group) group.push(s);
		else byName.set(s.name, [s]);
	}
	for (const group of byName.values()) {
		if (group.length < 2) continue;
		for (const s of group) {
			const tag = s.startYear ?? (s.publisher === UNKNOWN_PUBLISHER ? undefined : s.publisher);
			if (tag === undefined) continue;
			s.name += ` (${tag})`;
			s.sortKey = sortKeyOf(s.name);
		}
	}
	return out;
}
