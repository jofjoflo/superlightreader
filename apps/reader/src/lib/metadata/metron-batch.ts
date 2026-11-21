import type { Issue, MetronIssue } from '../types.ts';
import {
	matchMetronIssue,
	type MetronIssueCandidate,
	type MetronMatch
} from './metron.ts';

export type MetronBatchItemStatus = 'matched' | 'ambiguous' | 'not-found' | 'skipped' | 'failed' | 'aborted';

export interface MetronBatchItem {
	issueId: string;
	status: MetronBatchItemStatus;
	match?: MetronIssue;
	candidates?: MetronIssueCandidate[];
	error?: string;
}

export interface MetronBatchProgress {
	phase: 'running' | 'completed' | 'aborted';
	done: number;
	total: number;
	currentIssueId?: string;
	matched: number;
	ambiguous: number;
	notFound: number;
	skipped: number;
	failed: number;
	rateLimited: number;
}

export interface MetronBatchResult {
	status: 'completed' | 'aborted';
	items: MetronBatchItem[];
	progress: MetronBatchProgress;
}

export interface MetronBatchOptions {
	signal?: AbortSignal;
	/** Minimum delay between issue searches. Network-level host pacing remains active as well. */
	minIntervalMs?: number;
	/** Retries for the proxy's 429 response after fetchJson's own retry. */
	rateLimitRetries?: number;
	/** Initial abortable delay for a 429 retry; doubles per retry. */
	rateLimitBackoffMs?: number;
	/** Called only for a new, safe automatic match. Existing matches are skipped before this callback. */
	onMatch?: (issue: Issue, match: MetronIssue) => void | Promise<void>;
	/** Live lookup used immediately before onMatch; return undefined when the issue was removed. */
	getCurrentIssue?: (issueId: string) => Issue | undefined;
	onProgress?: (progress: MetronBatchProgress) => void | Promise<void>;
}

export const METRON_PROXY_MIN_INTERVAL_MS = 3_000;

const abortError = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('Aborted', 'AbortError');
const isAbort = (error: unknown, signal: AbortSignal): boolean => signal.aborted || (error instanceof DOMException && error.name === 'AbortError');

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout>;
		const abort = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			reject(abortError(signal!));
		};
		const finish = () => {
			signal?.removeEventListener('abort', abort);
			resolve();
		};
		timer = setTimeout(finish, ms);
		if (signal?.aborted) abort();
		else signal?.addEventListener('abort', abort, { once: true });
	});
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const statusOf = (error: unknown): number | undefined => {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : undefined;
};

/**
 * Match every issue in one series, sequentially and conservatively.
 * Search ambiguity is returned for manual review; it never triggers a detail fetch or write.
 */
export async function runMetronBatch(issues: readonly Issue[], options: MetronBatchOptions = {}): Promise<MetronBatchResult> {
	const signal = options.signal;
	const total = issues.length;
	const items: MetronBatchItem[] = [];
	const progress: MetronBatchProgress = {
		phase: 'running', done: 0, total, matched: 0, ambiguous: 0, notFound: 0, skipped: 0, failed: 0, rateLimited: 0
	};
	const emit = async (currentIssueId?: string) => {
		progress.currentIssueId = currentIssueId;
		await options.onProgress?.({ ...progress });
	};
	await emit();
	let lastStart = 0;
	for (const issue of issues) {
		if (signal?.aborted) {
			progress.phase = 'aborted';
			break;
		}
		const currentAtStart = options.getCurrentIssue ? options.getCurrentIssue(issue.id) : issue;
		if (!currentAtStart || currentAtStart.metron) {
			items.push({ issueId: issue.id, status: 'skipped' });
			progress.skipped++;
			progress.done++;
			await emit(issue.id);
			continue;
		}
		try {
			await wait(Math.max(0, (options.minIntervalMs ?? METRON_PROXY_MIN_INTERVAL_MS) - (Date.now() - lastStart)), signal);
		} catch (error) {
			if (signal && isAbort(error, signal)) {
				progress.phase = 'aborted';
				break;
			}
			throw error;
		}
		if (signal?.aborted) {
			progress.phase = 'aborted';
			break;
		}
		lastStart = Date.now();
		await emit(issue.id);
		let item: MetronBatchItem;
		{
			let rateRetries = 0;
			try {
				let match: MetronMatch;
				for (;;) {
					try {
						match = await matchMetronIssue(issue, signal, { minIntervalMs: options.minIntervalMs ?? METRON_PROXY_MIN_INTERVAL_MS });
						break;
					} catch (error) {
						if (statusOf(error) !== 429 || rateRetries >= Math.max(0, Math.trunc(options.rateLimitRetries ?? 2))) throw error;
						progress.rateLimited++;
						rateRetries++;
						await emit(issue.id);
						await wait((options.rateLimitBackoffMs ?? 3_000) * 2 ** (rateRetries - 1), signal);
					}
				}
				if (match.status === 'matched' && match.selected) {
					// Re-check before the write callback: a concurrent UI action may have selected a match.
					const current = options.getCurrentIssue ? options.getCurrentIssue(issue.id) : issue;
					if (!current || current.metron) item = { issueId: issue.id, status: 'skipped' };
					else {
						await options.onMatch?.(current, match.selected);
						item = { issueId: issue.id, status: 'matched', match: match.selected };
						progress.matched++;
					}
				} else if (match.status === 'ambiguous') {
					item = { issueId: issue.id, status: 'ambiguous', candidates: match.candidates };
					progress.ambiguous++;
				} else {
					item = { issueId: issue.id, status: 'not-found', candidates: match.candidates };
					progress.notFound++;
				}
			} catch (error) {
				if (signal && isAbort(error, signal)) {
					progress.phase = 'aborted';
					break;
				}
				item = { issueId: issue.id, status: 'failed', error: errorText(error) };
				progress.failed++;
			}
		}
		if (item!) items.push(item!);
		progress.done++;
		await emit(issue.id);
	}
	if (progress.phase !== 'aborted') progress.phase = 'completed';
	progress.currentIssueId = undefined;
	await emit();
	return { status: progress.phase, items, progress: { ...progress } };
}

export const matchMetronSeries = runMetronBatch;
export const batchMetron = runMetronBatch;
