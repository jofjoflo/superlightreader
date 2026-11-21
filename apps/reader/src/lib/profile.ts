import type { Issue, Series } from './types.ts';

export type ProfileKind = 'characters' | 'creators';

export interface ProfileSeries {
	series: Series;
	issues: Issue[];
}

export interface LocalProfile {
	kind: ProfileKind;
	name: string;
	series: ProfileSeries[];
	issueCount: number;
}

/** Exact name key: normalize spacing/unicode and case, but never alias or strip accents. */
export function profileKey(value: string): string {
	return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function profileHref(kind: ProfileKind, name: string): string {
	return `/${kind}/${encodeURIComponent(name)}`;
}

/** Names attached to one local issue. No role is inferred from Metron credits. */
export function issueProfileNames(issue: Issue, kind: ProfileKind): string[] {
	const names = kind === 'characters'
		? [...(issue.characters ?? []), ...(issue.metron?.characters ?? [])]
		: [...(issue.writers ?? []), ...(issue.artists ?? []), ...(issue.metron?.creators ?? [])];
	const seen = new Set<string>();
	return names.map((name) => name.trim()).filter((name) => {
		const key = profileKey(name);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function hasSeriesCreator(series: Series, key: string): boolean {
	return series.creators.some((creator) => profileKey(creator) === key);
}

/** Find only records already present in the local library. */
export function findLocalProfile(kind: ProfileKind, name: string, issues: Issue[], series: Series[]): LocalProfile | undefined {
	const key = profileKey(name);
	if (!key) return undefined;
	const rows: ProfileSeries[] = [];
	for (const current of series) {
		const ownIssues = current.issues.filter((issue) => issueProfileNames(issue, kind).some((value) => profileKey(value) === key));
		// Series-level metadata can name a creator without assigning a role/credit to each issue.
		if (ownIssues.length || (kind === 'creators' && hasSeriesCreator(current, key))) rows.push({ series: current, issues: ownIssues });
	}
	if (!rows.length) return undefined;
	const displayName = rows.flatMap((row) => [...row.issues.flatMap((issue) => issueProfileNames(issue, kind)), ...row.series.creators])
		.find((value) => profileKey(value) === key) ?? name.trim();
	return { kind, name: displayName, series: rows, issueCount: rows.reduce((count, row) => count + row.issues.length, 0) };
}

export function listLocalProfiles(kind: ProfileKind, issues: Issue[], series: Series[]): string[] {
	const names = new Map<string, string>();
	for (const issue of issues) for (const name of issueProfileNames(issue, kind)) names.set(profileKey(name), name);
	if (kind === 'creators') for (const current of series) for (const name of current.creators) names.set(profileKey(name), name);
	return [...names.values()].sort((a, b) => a.localeCompare(b, 'sv'));
}
