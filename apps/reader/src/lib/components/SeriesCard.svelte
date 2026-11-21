<script lang="ts">
	import type { Series } from '$lib/types';
	import { library } from '$lib/library.svelte';
	import Cover from './Cover.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Cover card linking to /series/{series.id}. Cover (2:3) with soft shadow; stacked-edge effect when issueCount > 1;
	 * bottom progress bar (series.progress) when 0 < progress < 1, check badge when state==='done', heart when favorite;
	 * under the cover: name (clamp-2) and a muted line "Förlag · N nummer" (or `note` instead when given).
	 * Must size itself to its container (width:100%) so it works in `.grid-cards` AND in `.scroll-x` shelves (where the
	 * parent gives it a fixed width, e.g. 150px).
	 */
	let { series, note, class: cls = '' }: { series: Series; note?: string; class?: string } = $props();
</script>

<a href={`/series/${encodeURIComponent(series.id)}`} class={`series-card ${cls}`}>
	<div class="art" class:stacked={series.issueCount > 1}><Cover issueId={series.coverIssueId} alt={`Omslag: ${series.name}`} />{#if series.progress > 0 && series.progress < 1}<ProgressBar value={series.progress} class="card-progress" />{/if}{#if series.state === 'done'}<span class="state"><Icon name="check" size={16} /></span>{/if}{#if series.favorite}<span class="favorite"><Icon name="heart-fill" size={16} /></span>{/if}</div>
	<strong class="clamp-2">{series.name}</strong>
	<span class="meta">{note ?? `${series.publisher} · ${series.issueCount} ${series.issueCount === 1 ? 'nummer' : 'nummer'}`}</span>
</a>

<style>
	.series-card { display:block; width:100%; min-width:0; content-visibility:auto; contain-intrinsic-size:220px; }
	.art { position:relative; margin-bottom:10px; filter:drop-shadow(var(--shadow-card)); }
	.art.stacked::before,.art.stacked::after { content:""; position:absolute; inset:5px -4px -3px 4px; z-index:-1; border-radius:var(--radius-s); background:var(--surface-3); transform:rotate(2deg); }
	.art.stacked::after { inset:3px -2px -2px 2px; transform:rotate(-2deg); background:var(--surface-2); }
	.series-card strong { display:block; font-size:.98rem; line-height:1.25; }
	.meta { display:block; margin-top:4px; overflow:hidden; color:var(--text-dim); font-size:.82rem; text-overflow:ellipsis; white-space:nowrap; }
	.card-progress { position:absolute; inset:auto 8px 8px; width:calc(100% - 16px); z-index:1; }
	.state,.favorite { position:absolute; top:8px; display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:rgba(10,12,18,.78); }
	.state { right:8px; color:var(--ok); }.favorite { left:8px; color:var(--danger); }
</style>
