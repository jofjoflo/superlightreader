<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Titled horizontal shelf: header (title .h2, optional muted subtitle, optional "Visa alla ›" link to `href`
	 * labelled `hrefLabel`) + `.scroll-x` track containing the children. On pointer:fine devices show round
	 * prev/next arrow buttons overlaying the track edges. Children are cards; give each a fixed width via a wrapper
	 * (default 150px; use CSS var --shelf-card-w, overridable per instance, default `calc(var(--card-min,170px)*0.9)`).
	 * Bottom margin ~28px so shelves stack nicely.
	 */
	let {
		title,
		subtitle,
		href,
		hrefLabel = 'Visa alla',
		children
	}: { title: string; subtitle?: string; href?: string; hrefLabel?: string; children: Snippet } = $props();
	let track: HTMLDivElement;
	const move = (delta: number) => track?.scrollBy({ left: delta * Math.max(track.clientWidth * .72, 220), behavior: 'smooth' });
</script>

<section>
	<header><div><h2 class="h2">{title}</h2>{#if subtitle}<p class="muted">{subtitle}</p>{/if}</div>{#if href}<a class="more" href={href}>{hrefLabel} <span aria-hidden="true">›</span></a>{/if}</header>
	<div class="shelf-track"><button class="arrow prev" type="button" aria-label="Föregående" onclick={() => move(-1)}><span>‹</span></button><div class="scroll-x" bind:this={track}>{@render children()}</div><button class="arrow next" type="button" aria-label="Nästa" onclick={() => move(1)}><span>›</span></button></div>
</section>

<style>
	section { margin-bottom:28px; }.h2 { margin-bottom:2px; } header { display:flex; align-items:end; justify-content:space-between; gap:12px; margin-bottom:6px; }.muted { font-size:.88rem; }.more { color:var(--accent-2); font-size:.9rem; font-weight:650; white-space:nowrap; }.more span { font-size:1.25em; }.shelf-track { position:relative; }.scroll-x { padding-top:8px; }.arrow { position:absolute; z-index:3; top:42%; display:grid; place-items:center; width:40px; height:40px; border:1px solid var(--border); border-radius:50%; background:color-mix(in srgb,var(--surface) 88%,transparent); color:var(--text); box-shadow:var(--shadow-pop); }.arrow span { font-size:1.8rem; line-height:1; }.prev { left:-10px; }.next { right:-10px; }@media(max-width:899px){.arrow{display:none}}
</style>
