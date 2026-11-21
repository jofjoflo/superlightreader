<script lang="ts">
	import { untrack } from 'svelte';
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	import { library } from '$lib/library.svelte';
	import { toast } from '$lib/toast.svelte';
	import { searchMeta } from '$lib/metadata';
	import type { MetaCandidate, Series } from '$lib/types';

	/**
	 * "Fel match?" – manual metadata search. Search field (prefilled with the series' original name) + candidate list
	 * (title, source badge, publisher, years, 2-line description, match %). Tap a candidate → library.applyCandidate.
	 * Searches automatically when opened.
	 */
	let { open, series, onclose }: { open: boolean; series: Series; onclose: () => void } = $props();

	const SOURCES: Record<string, { name: string; color: string }> = {
		wikipedia: { name: 'Wikipedia', color: '#b9c2d6' },
		anilist: { name: 'AniList', color: '#3db4f2' },
		googlebooks: { name: 'Google Books', color: '#6ea4ff' },
		openlibrary: { name: 'Open Library', color: '#f0a050' }
	};
	const pct = new Intl.NumberFormat('sv-SE', { style: 'percent', maximumFractionDigits: 0 });

	let query = $state('');
	let phase = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	let results = $state.raw<MetaCandidate[]>([]);
	let searched = $state('');
	let runId = 0;
	let ctrl: AbortController | undefined;

	async function search() {
		const q = query.trim();
		if (!q) return;
		ctrl?.abort();
		const mine = (ctrl = new AbortController());
		const id = ++runId;
		phase = 'loading';
		try {
			const r = await searchMeta({ ...library.metaQuery(series), name: q }, mine.signal);
			if (id !== runId) return;
			results = r;
			searched = q;
			phase = 'done';
		} catch {
			if (id === runId) phase = 'error';
		}
	}

	// Reset + search every time the sheet opens; cancel a running search on close.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			query = series.issues[0]?.seriesName ?? series.name;
			results = [];
			phase = 'idle';
			void search();
		});
		return () => {
			runId++;
			ctrl?.abort();
		};
	});

	function apply(c: MetaCandidate) {
		library.applyCandidate(series.id, c);
		toast.show(`Matchad mot ’${c.title}’`, { kind: 'ok' });
		onclose();
	}

	function years(c: MetaCandidate): string {
		if (c.startYear && c.endYear) return c.startYear === c.endYear ? `${c.startYear}` : `${c.startYear}–${c.endYear}`;
		if (c.startYear) return c.status === 'ongoing' ? `${c.startYear} – pågår` : `${c.startYear}`;
		return '';
	}
	const isCurrent = (c: MetaCandidate) => series.meta?.source === c.source && series.meta?.matchedTitle === c.title;
</script>

<Sheet {open} title="Hitta rätt serie" {onclose}>
	<form
		class="search"
		role="search"
		onsubmit={(e) => {
			e.preventDefault();
			void search();
		}}
	>
		<input type="search" bind:value={query} placeholder="Serietitel" aria-label="Sök titel" enterkeyhint="search" autocomplete="off" />
		<button type="submit" class="btn btn-primary" disabled={phase === 'loading' || !query.trim()}>Sök</button>
	</form>
	<p class="hint">Välj den träff som stämmer. Prova gärna originaltiteln, till exempel den engelska.</p>

	<div class="out" aria-live="polite" aria-busy={phase === 'loading'}>
		{#if phase === 'loading'}
			<div class="skeleton sk"></div>
			<div class="skeleton sk"></div>
			<div class="skeleton sk"></div>
		{:else if phase === 'error'}
			<div class="msg">
				<p>Sökningen misslyckades. Kontrollera anslutningen och försök igen.</p>
				<button type="button" class="btn" onclick={search}><Icon name="refresh" size={18} /> Försök igen</button>
			</div>
		{:else if phase === 'done' && !results.length}
			<div class="msg">
				<p>Inga träffar för ’{searched}’. Prova ett annat namn eller stava om.</p>
			</div>
		{:else if results.length}
			<ul class="list">
				{#each results as c, i (i)}
					<li>
						<button type="button" class="cand" class:current={isCurrent(c)} onclick={() => apply(c)}>
							<span class="top">
								<span class="title clamp-1">{c.title}</span>
								<span class="score" class:hi={c.score >= 0.72}>{pct.format(c.score)}</span>
							</span>
							<span class="meta">
								<span class="src" style:--c={SOURCES[c.source]?.color ?? 'var(--text-dim)'}>{SOURCES[c.source]?.name ?? c.source}</span>
								{#if c.publisher}<span>{c.publisher}</span>{/if}
								{#if years(c)}<span>{years(c)}</span>{/if}
								{#if isCurrent(c)}<span class="now"><Icon name="check" size={14} /> Vald nu</span>{/if}
							</span>
							{#if c.description}<span class="desc clamp-2">{c.description}</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Sheet>

<style>
	.search {
		display: flex;
		gap: 10px;
	}
	.search input {
		flex: 1;
		min-width: 0;
		min-height: 48px;
		padding: 0 14px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
	}
	.search input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--accent) 70%, transparent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.hint {
		margin: 10px 2px 14px;
		font-size: 0.86rem;
		color: var(--text-dim);
	}
	.out {
		display: grid;
		gap: 10px;
		min-height: 120px;
	}
	.sk {
		height: 88px;
	}
	.msg {
		display: grid;
		justify-items: center;
		gap: 12px;
		padding: 28px 12px;
		text-align: center;
		color: var(--text-dim);
	}
	.list {
		display: grid;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.cand {
		display: grid;
		gap: 6px;
		width: 100%;
		min-height: 64px;
		padding: 12px 14px;
		text-align: left;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
		transition:
			transform 0.12s var(--ease),
			background 0.15s,
			border-color 0.15s;
	}
	.cand:hover {
		background: var(--surface-2);
		border-color: var(--border-strong);
	}
	.cand:active {
		transform: scale(0.985);
	}
	.cand.current {
		border-color: color-mix(in srgb, var(--accent) 65%, transparent);
		background: color-mix(in srgb, var(--accent) 10%, var(--surface));
	}
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.title {
		min-width: 0;
		font-weight: 700;
	}
	.score {
		flex: none;
		font-size: 0.82rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}
	.score.hi {
		color: var(--ok);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: 0.82rem;
		color: var(--text-dim);
	}
	.src {
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
	}
	.now {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--accent-2);
		font-weight: 650;
	}
	.desc {
		font-size: 0.86rem;
		line-height: 1.4;
		color: var(--text-dim);
	}
</style>
