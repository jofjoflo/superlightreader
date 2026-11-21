<script lang="ts">
	/**
	 * Publisher tile, link to `href` (default `/library?publisher=${encodeURIComponent(name)}`). ~16:10 card with a gradient from
	 * publisherColor(name) (lib/parse/publishers.ts) to a darker shade, up to 3 overlapping, slightly rotated covers
	 * (library.coverUrl(coverIssueIds[i])) on the right, publisher name (bold, clamp-2) bottom-left, muted
	 * "12 serier · 140 nummer". UNKNOWN_PUBLISHER gets a neutral gray gradient.
	 */
	let {
		name,
		seriesCount,
		issueCount,
		coverIssueIds = [],
		href
	}: { name: string; seriesCount: number; issueCount: number; coverIssueIds?: string[]; href?: string } = $props();
	import { library } from '$lib/library.svelte';
	import { publisherColor } from '$lib/parse/publishers';
	import Cover from './Cover.svelte';
	const color = $derived(publisherColor(name));
</script>

<a href={href ?? `/library?publisher=${encodeURIComponent(name)}`} class="publisher" style:--publisher-color={color}>
	<div class="covers">{#each coverIssueIds.slice(0,3) as id, i}<span style:--i={i}><Cover issueId={id} alt="" /></span>{/each}</div>
	<strong class="clamp-2">{name}</strong><small>{seriesCount} serier · {issueCount} nummer</small>
</a>

<style>
	.publisher { position:relative; display:flex; min-height:150px; flex-direction:column; justify-content:flex-end; overflow:hidden; padding:18px; border:1px solid var(--border); border-radius:var(--radius); background:linear-gradient(135deg,color-mix(in srgb,var(--publisher-color) 70%,var(--surface)),var(--surface)); box-shadow:var(--shadow-card); isolation:isolate; }
	.publisher::before { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(0deg,rgba(10,12,18,.9),transparent 70%); }
	.publisher strong,.publisher small { position:relative; z-index:2; }.publisher strong { font-size:1.05rem; }.publisher small { margin-top:4px; color:var(--text-dim); }.covers { position:absolute; right:10px; top:14px; width:55%; height:78%; }.covers span { position:absolute; right:calc(var(--i) * 25px); top:calc(var(--i) * 7px); width:62px; transform:rotate(calc((var(--i) - 1) * 7deg)); transform-origin:bottom center; filter:drop-shadow(0 5px 8px rgba(0,0,0,.55)); }.covers span :global(.cover) { border-radius:6px; }
</style>
