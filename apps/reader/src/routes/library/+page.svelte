<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { library } from '$lib/library.svelte';
	import { ui } from '$lib/ui.svelte';
	import { applyFilters, computeFacets, countActiveFilters, filtersFromParams, filtersToParams } from '$lib/filter';
	import { UNKNOWN_PUBLISHER } from '$lib/types';
	import type { Filters } from '$lib/types';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FilterSheet, { type FacetGroup, type FacetOption, type FacetValue } from '$lib/components/FilterSheet.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LibraryToolbar from '$lib/components/LibraryToolbar.svelte';
	import SeriesCard from '$lib/components/SeriesCard.svelte';

	type Lists = Record<FacetGroup, FacetValue[]>;
	const canon = (x: Filters) => filtersToParams(x).toString();
	const SKELETONS = Array.from({ length: 18 }, (_, i) => i);

	// All filters live in one state object: seeded from the URL, written back with replaceState, and re-read
	// when the URL changes from outside (e.g. a link to /library?publisher=Marvel).
	const initial = filtersFromParams(page.url.searchParams);
	let filters = $state<Filters>(initial);
	/** Canonical query of the state last written to / read from the URL: tells our own echo from an outside navigation. */
	let written = canon(initial);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let openGroup = $state<FacetGroup | null>(null);

	const results = $derived(applyFilters(library.series, filters));
	const active = $derived(countActiveFilters(filters));

	/** Options of the open sheet. Counts come from the series left by every *other* filter, so they match what a tap gives. */
	const options = $derived.by((): FacetOption[] => {
		const group = openGroup;
		if (!group) return [];
		// the sort does not change counts: use the cheapest key
		const rest: Filters = { ...filters, sort: 'added', desc: false };
		(rest as Lists)[group] = [];
		const list: FacetOption[] = [...computeFacets(applyFilters(library.series, rest))[group]];
		// selected values that the other filters exclude must stay visible so they can be removed
		const seen = new Set(list.map((o) => o.value));
		for (const value of (filters as Lists)[group]) if (!seen.has(value)) list.push({ value, count: 0 });
		if (group === 'decades') list.sort((a, b) => Number(a.value) - Number(b.value));
		else if (group === 'publishers') list.sort((a, b) => Number(a.value === UNKNOWN_PUBLISHER) - Number(b.value === UNKNOWN_PUBLISHER));
		return list;
	});

	function push() {
		clearTimeout(timer);
		const key = canon(filters);
		if (key === written) return;
		written = key;
		goto(key ? `${page.url.pathname}?${key}` : page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
	}

	/** Applies a toolbar edit. Typing (`debounce`) filters at once but writes the URL 250 ms after the last keystroke. */
	function update(patch: Partial<Filters>, debounce = false) {
		Object.assign(filters, patch);
		if (debounce) {
			clearTimeout(timer);
			timer = setTimeout(push, 250);
		} else {
			push();
		}
	}
	function toggle(group: FacetGroup, value: FacetValue) {
		const cur: FacetValue[] = filters[group];
		(filters as Lists)[group] = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
		push();
	}
	function clearGroup(group: FacetGroup) {
		(filters as Lists)[group] = [];
		push();
	}
	/** Resets every filter but keeps the chosen sort order. Fresh arrays: defaultFilters shares its own. */
	function clear() {
		filters = { ...filtersFromParams(new URLSearchParams()), sort: filters.sort, desc: filters.desc };
		push();
	}

	// URL → state for navigations we did not cause (the echo of our own write is skipped, so typing is never reset).
	$effect(() => {
		const incoming = filtersFromParams(page.url.searchParams);
		const key = canon(incoming);
		if (key === written) return;
		written = key;
		clearTimeout(timer);
		filters = incoming;
	});
	// never let a pending write navigate back here after the page is left
	$effect(() => () => clearTimeout(timer));
</script>

<svelte:head><title>Bibliotek – SuperLight Reader</title></svelte:head>

<div class="page">
	<h1 class="h1 title">Bibliotek</h1>

	{#if !library.ready}
		<div class="sk" role="status" aria-label="Laddar biblioteket">
			<div class="skeleton sk-bar"></div>
			<div class="skeleton sk-chips"></div>
			<div class="grid-cards">
				{#each SKELETONS as i (i)}
					<div>
						<div class="skeleton sk-cover"></div>
						<div class="skeleton sk-line"></div>
						<div class="skeleton sk-line short"></div>
					</div>
				{/each}
			</div>
		</div>
	{:else if library.series.length === 0}
		<EmptyState icon="library" title="Biblioteket är tomt" text="Lägg till en mapp eller några filer så dyker dina serier upp här.">
			<button type="button" class="btn btn-primary" onclick={() => (ui.addOpen = true)}>
				<Icon name="plus" size={18} />Lägg till serier
			</button>
		</EmptyState>
	{:else}
		<LibraryToolbar
			{filters}
			count={results.length}
			{active}
			onupdate={update}
			onopen={(group) => (openGroup = group)}
			onremove={toggle}
			onclear={clear}
		/>

		{#if results.length}
			<div class="grid-cards results">
				{#each results as s (s.id)}
					<SeriesCard series={s} />
				{/each}
			</div>
		{:else}
			<EmptyState icon="search" title="Inga serier matchar" text="Prova att ändra sökningen eller ta bort något filter.">
				<button type="button" class="btn btn-primary" onclick={clear}>Rensa filter</button>
			</EmptyState>
		{/if}
	{/if}
</div>

{#if openGroup}
	{@const group = openGroup}
	<FilterSheet
		{group}
		{options}
		selected={filters[group]}
		resultCount={results.length}
		ontoggle={(value) => toggle(group, value)}
		onclear={() => clearGroup(group)}
		onclose={() => (openGroup = null)}
	/>
{/if}

<style>
	.title {
		margin-bottom: 14px;
	}
	.results {
		animation: fade 0.3s var(--ease) both;
	}

	/* ── skeleton ── */
	.sk {
		display: grid;
		gap: 14px;
	}
	.sk-bar {
		height: 48px;
		border-radius: 999px;
	}
	.sk-chips {
		width: min(640px, 100%);
		height: 44px;
		border-radius: 999px;
	}
	.sk .grid-cards {
		margin-top: 8px;
	}
	.sk-cover {
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-s);
	}
	.sk-line {
		height: 12px;
		margin-top: 10px;
		border-radius: 6px;
	}
	.sk-line.short {
		width: 60%;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
