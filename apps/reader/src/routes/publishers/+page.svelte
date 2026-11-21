<script lang="ts">
	import { library } from '$lib/library.svelte';
	import { ui } from '$lib/ui.svelte';
	import { UNKNOWN_PUBLISHER } from '$lib/types';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PublisherTile from '$lib/components/PublisherTile.svelte';

	type Tile = { name: string; seriesCount: number; issueCount: number; covers: string[] };

	const collator = new Intl.Collator('sv');
	const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	const SKELETONS = Array.from({ length: 8 }, (_, i) => i);

	let q = $state('');

	/** One pass over the series: series count, summed issue count and up to 3 cover issues per publisher. */
	const tiles = $derived.by((): Tile[] => {
		const byName = new Map<string, Tile>();
		for (const s of library.series) {
			let t = byName.get(s.publisher);
			if (!t) byName.set(s.publisher, (t = { name: s.publisher, seriesCount: 0, issueCount: 0, covers: [] }));
			t.seriesCount++;
			t.issueCount += s.issueCount;
			if (t.covers.length < 3 && library.issueById.get(s.coverIssueId)?.hasCover) t.covers.push(s.coverIssueId);
		}
		const unknown = (t: Tile) => (t.name === UNKNOWN_PUBLISHER ? 1 : 0);
		return [...byName.values()].sort(
			(a, b) => unknown(a) - unknown(b) || b.seriesCount - a.seriesCount || collator.compare(a.name, b.name)
		);
	});

	const shown = $derived.by(() => {
		const words = fold(q).split(/\s+/).filter(Boolean);
		if (!words.length) return tiles;
		return tiles.filter((t) => {
			const hay = fold(t.name);
			return words.every((w) => hay.includes(w));
		});
	});

	const summary = $derived(shown.length === tiles.length ? `${tiles.length} förlag` : `${shown.length} av ${tiles.length} förlag`);
</script>

<svelte:head><title>Förlag – SuperLight Reader</title></svelte:head>

<div class="page">
	<header class="head">
		<div>
			<h1 class="h1">Förlag</h1>
			{#if library.ready && tiles.length}<p class="muted summary" aria-live="polite">{summary}</p>{/if}
		</div>
		{#if library.ready && tiles.length}
			<div class="search" role="search">
				<Icon name="search" size={18} />
				<input
					type="search"
					bind:value={q}
					placeholder="Sök förlag"
					aria-label="Sök bland förlag"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					enterkeyhint="search"
					onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				/>
				{#if q}
					<button type="button" class="clear-q" aria-label="Rensa sökningen" onclick={() => (q = '')}>
						<Icon name="x" size={16} />
					</button>
				{/if}
			</div>
		{/if}
	</header>

	{#if !library.ready}
		<div class="grid" role="status" aria-label="Laddar förlag">
			{#each SKELETONS as i (i)}
				<div class="skeleton sk-tile"></div>
			{/each}
		</div>
	{:else if tiles.length === 0}
		<EmptyState icon="building" title="Inga förlag ännu" text="Förlagen dyker upp här när du har lagt till serier i biblioteket.">
			<button type="button" class="btn btn-primary" onclick={() => (ui.addOpen = true)}>
				<Icon name="plus" size={18} />Lägg till serier
			</button>
		</EmptyState>
	{:else if shown.length === 0}
		<EmptyState icon="search" title="Inga förlag matchar" text={`Inget förlag matchar ”${q.trim()}”. Kontrollera stavningen eller sök på något kortare.`}>
			<button type="button" class="btn btn-primary" onclick={() => (q = '')}>Rensa sökningen</button>
		</EmptyState>
	{:else}
		<div class="grid">
			{#each shown as t (t.name)}
				<PublisherTile name={t.name} seriesCount={t.seriesCount} issueCount={t.issueCount} coverIssueIds={t.covers} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 14px 24px;
		margin-bottom: 22px;
	}
	.summary {
		margin-top: 6px;
		font-variant-numeric: tabular-nums;
	}

	.search {
		flex: 1 1 260px;
		max-width: 380px;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 4px 0 16px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-dim);
		transition:
			border-color 0.15s,
			background 0.15s,
			box-shadow 0.15s;
	}
	.search:focus-within {
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
		background: var(--surface-2);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: 42px;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
		font-size: 1rem;
	}
	.search input::placeholder {
		color: var(--text-faint);
	}
	.search input::-webkit-search-cancel-button,
	.search input::-webkit-search-decoration {
		-webkit-appearance: none;
		appearance: none;
	}
	.clear-q {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		color: var(--text-dim);
	}
	.clear-q::after {
		/* grows the tap area to 44px */
		content: '';
		position: absolute;
		inset: -4px;
	}
	.clear-q:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 16px;
		animation: fade 0.3s var(--ease) both;
	}
	.sk-tile {
		min-height: 176px;
		border-radius: var(--radius);
	}

	@media (max-width: 639px) {
		.search {
			max-width: none;
		}
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
