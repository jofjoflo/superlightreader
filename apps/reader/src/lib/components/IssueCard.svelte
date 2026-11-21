<script lang="ts">
	import type { Issue, Series } from '$lib/types';
	import { library } from '$lib/library.svelte';
	import Cover from './Cover.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Cover card of ONE issue linking to /read/{issue.id}. Shows cover, number badge ("#20"), reading progress bar
	 * (library.progressOf(issue.id)), check when completed, cloud-off icon when !library.isLinked(issue.id).
	 * Below: series name (if showSeries && series) + "Nr 20" / issue.title; `note` as muted extra line.
	 * Width:100% of its container (like SeriesCard).
	 */
	let {
		issue,
		series,
		note,
		showSeries = false
	}: { issue: Issue; series?: Series; note?: string; showSeries?: boolean } = $props();
</script>

<a href={`/read/${encodeURIComponent(issue.id)}`} class="issue-card" class:unlinked={!library.isLinked(issue.id) && !issue.unsupported}>
	<div class="art"><Cover issueId={issue.id} alt={issue.title ?? issue.fileName} />{#if issue.numberLabel || issue.number != null}<span class="number">#{issue.numberLabel ?? issue.number}</span>{/if}{#if library.progressOf(issue.id)?.completed}<span class="state"><Icon name="check" size={16} /></span>{:else if library.progressOf(issue.id) && library.progressOf(issue.id)?.pageCount}<ProgressBar value={((library.progressOf(issue.id)?.page ?? 0) + 1) / (library.progressOf(issue.id)?.pageCount ?? 1)} class="card-progress" />{/if}{#if !library.isLinked(issue.id) || issue.unsupported}<span class="link-state" title={issue.unsupported ?? 'Filen är inte länkad'}><Icon name="cloud-off" size={15} /></span>{/if}</div>
	{#if showSeries && series}<span class="series-name clamp-1">{series.name}</span>{/if}<strong class="clamp-2">{issue.number != null ? `Nr ${issue.number}${issue.title ? ` · ${issue.title}` : ''}` : issue.title ?? issue.fileName}</strong>{#if note}<span class="note">{note}</span>{/if}
</a>

<style>
	.issue-card { display:block; width:100%; min-width:0; content-visibility:auto; contain-intrinsic-size:220px; }
	.art { position:relative; margin-bottom:9px; border-radius:var(--radius-s); overflow:hidden; filter:drop-shadow(var(--shadow-card)); }
	.number { position:absolute; left:8px; bottom:8px; padding:3px 7px; border-radius:6px; background:rgba(10,12,18,.8); font-size:.78rem; font-weight:700; }
	.state,.link-state { position:absolute; right:8px; top:8px; display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:rgba(10,12,18,.8); }.state{color:var(--ok)}.link-state{color:var(--warn)}
	:global(.card-progress) { position:absolute; inset:auto 8px 8px; width:calc(100% - 16px); }.series-name,.note { display:block; color:var(--text-dim); font-size:.82rem; }.issue-card strong { display:block; line-height:1.25; }.unlinked { opacity:.82; }
</style>
