<script lang="ts">
	import { library } from '$lib/library.svelte';
	import type { Filters, SortKey } from '$lib/types';
	import { FACETS, type FacetGroup, type FacetValue } from './FilterSheet.svelte';
	import Icon from './Icon.svelte';

	/**
	 * Sticky filter bar of /library (glass bar under the topbar). Presentational: every edit leaves through
	 * `onupdate` / `onopen` / `onremove` / `onclear`; the page owns the filter state and the URL sync.
	 * `onupdate(patch, true)` = typing (the URL write is debounced); `onupdate({})` flushes a pending write.
	 */
	let {
		filters,
		count,
		active,
		onupdate,
		onopen,
		onremove,
		onclear
	}: {
		filters: Filters;
		count: number;
		active: number;
		onupdate: (patch: Partial<Filters>, debounce?: boolean) => void;
		onopen: (group: FacetGroup) => void;
		onremove: (group: FacetGroup, value: FacetValue) => void;
		onclear: () => void;
	} = $props();

	const fmt = new Intl.NumberFormat('sv-SE');
	const GROUPS = Object.keys(FACETS) as FacetGroup[];
	const STATUS: [Filters['status'], string][] = [
		['all', 'Alla'],
		['unread', 'Oläst'],
		['reading', 'Pågående'],
		['done', 'Läst'],
		['favorites', 'Favoriter']
	];
	const KIND: [Filters['kind'], string][] = [
		['all', 'Alla'],
		['series', 'Serier'],
		['oneshot', 'Engångs'],
		['manga', 'Manga'],
		['complete', 'Kompletta']
	];
	/** `desc` = the direction a key starts in. filter.ts sorts every key ascending when desc=false. */
	const SORTS: { key: SortKey; label: string; desc: boolean }[] = [
		{ key: 'name', label: 'Namn', desc: false },
		{ key: 'added', label: 'Senast tillagd', desc: true },
		{ key: 'read', label: 'Senast läst', desc: true },
		{ key: 'year', label: 'Startår', desc: false },
		{ key: 'issues', label: 'Antal nummer', desc: true },
		{ key: 'rating', label: 'Betyg', desc: true },
		{ key: 'progress', label: 'Framsteg', desc: true }
	];
	/** What ascending / descending means per key; shown on the direction button. */
	const ORDER: Record<SortKey, [asc: string, desc: string]> = {
		name: ['A–Ö', 'Ö–A'],
		added: ['Äldst först', 'Nyast först'],
		read: ['Äldst först', 'Nyast först'],
		year: ['Äldst först', 'Nyast först'],
		issues: ['Minst först', 'Flest först'],
		rating: ['Lägst först', 'Högst först'],
		progress: ['Minst först', 'Mest först']
	};
	const MIN = 120;
	const MAX = 260;

	let input = $state<HTMLInputElement>();

	const order = $derived(ORDER[filters.sort][filters.desc ? 1 : 0]);
	const size = $derived(library.settings.cardSize);
	const fill = $derived(`${Math.round(((Math.min(MAX, Math.max(MIN, size)) - MIN) / (MAX - MIN)) * 100)}%`);
	const selected = $derived(
		GROUPS.flatMap((group) => {
			const values: FacetValue[] = filters[group];
			return values.map((value) => ({ group, value }));
		})
	);

	const setSort = (key: SortKey) => onupdate({ sort: key, desc: SORTS.find((s) => s.key === key)?.desc ?? false });
</script>

<section class="toolbar" aria-label="Filter och sortering">
	<div class="row top">
		<div class="search" role="search">
			<Icon name="search" size={18} />
			<input
				bind:this={input}
				type="search"
				value={filters.q}
				placeholder="Sök serie, förlag, genre eller skapare"
				aria-label="Sök i biblioteket"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="search"
				oninput={(e) => onupdate({ q: e.currentTarget.value }, true)}
				onkeydown={(e) => {
					if (e.key !== 'Enter') return;
					onupdate({});
					e.currentTarget.blur();
				}}
			/>
			{#if filters.q}
				<button
					type="button"
					class="clear-q"
					aria-label="Rensa sökningen"
					onclick={() => {
						onupdate({ q: '' });
						input?.focus();
					}}
				>
					<Icon name="x" size={16} />
				</button>
			{/if}
		</div>

		<div class="controls">
			<div class="facets">
				{#each GROUPS as group (group)}
					{@const n = filters[group].length}
					<button type="button" class="btn facet" class:on={n > 0} aria-haspopup="dialog" onclick={() => onopen(group)}>
						<Icon name={FACETS[group].icon} size={18} />{FACETS[group].title}
						{#if n}<span class="badge" aria-hidden="true">{n}</span><span class="sr-only">({n} valda)</span>{/if}
					</button>
				{/each}
			</div>

			<div class="sort">
				<div class="select">
					<span class="lead" aria-hidden="true"><Icon name="sort" size={18} /></span>
					<select aria-label="Sortera efter" value={filters.sort} onchange={(e) => setSort(e.currentTarget.value as SortKey)}>
						{#each SORTS as s (s.key)}
							<option value={s.key}>{s.label}</option>
						{/each}
					</select>
					<span class="tail" aria-hidden="true"><Icon name="chevron-down" size={16} /></span>
				</div>
				<button
					type="button"
					class="btn dir"
					title={order}
					aria-label="Sorteringsordning: {order}. Tryck för att vända."
					onclick={() => onupdate({ desc: !filters.desc })}
				>
					<span class="arrow" style:--r={filters.desc ? '-90deg' : '90deg'}><Icon name="arrow-left" size={18} /></span>
					<span class="order">{order}</span>
				</button>
			</div>

			<div class="density">
				<Icon name="grid" size={16} />
				<input
					type="range"
					min={MIN}
					max={MAX}
					step="10"
					value={size}
					style:--p={fill}
					title="Kortstorlek"
					aria-label="Kortstorlek"
					oninput={(e) => library.updateSettings({ cardSize: Number(e.currentTarget.value) })}
				/>
				<Icon name="grid" size={22} />
			</div>
		</div>
	</div>

	<div class="row mid">
		<div class="segs">
			<div class="seg" role="group" aria-label="Status">
				{#each STATUS as [value, label] (value)}
					<button
						type="button"
						class="chip"
						class:active={filters.status === value}
						aria-pressed={filters.status === value}
						onclick={() => onupdate({ status: value })}>{label}</button
					>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="Typ">
				{#each KIND as [value, label] (value)}
					<button
						type="button"
						class="chip"
						class:active={filters.kind === value}
						aria-pressed={filters.kind === value}
						onclick={() => onupdate({ kind: value })}>{label}</button
					>
				{/each}
			</div>
		</div>

		<div class="meta">
			<p class="count" aria-live="polite"><b>{fmt.format(count)}</b> {count === 1 ? 'serie' : 'serier'}</p>
			{#if active}
				<button type="button" class="btn btn-ghost clear" onclick={onclear}>Rensa ({active})</button>
			{/if}
		</div>
	</div>

	{#if selected.length}
		<div class="row sel" role="group" aria-label="Valda filter">
			{#each selected as s (`${s.group}:${s.value}`)}
				<button
					type="button"
					class="chip active"
					aria-label="Ta bort {FACETS[s.group].title}: {FACETS[s.group].label(s.value)}"
					onclick={() => onremove(s.group, s.value)}
				>
					{FACETS[s.group].label(s.value)}<Icon name="x" size={14} />
				</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	.toolbar {
		position: sticky;
		top: var(--topbar-h);
		z-index: 20;
		display: grid;
		gap: 8px;
		margin: 0 calc(var(--gutter) * -1) 20px;
		padding: 10px var(--gutter) 8px;
		background: color-mix(in srgb, var(--bg) 78%, transparent);
		-webkit-backdrop-filter: blur(18px) saturate(1.5);
		backdrop-filter: blur(18px) saturate(1.5);
		border-bottom: 1px solid var(--border);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.top {
		flex-wrap: wrap;
	}

	/* ── search ── */
	.search {
		flex: 1 1 280px;
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

	/* ── facet buttons, sort, density (one line on wide screens, a scrolling line below 1100px) ── */
	.controls {
		display: contents;
	}
	.facets,
	.sort {
		display: flex;
		flex: none;
		gap: 8px;
	}
	.facet {
		padding-inline: 16px;
	}
	.facet.on {
		background: color-mix(in srgb, var(--accent) 20%, var(--surface-2));
		border-color: color-mix(in srgb, var(--accent) 65%, transparent);
	}
	.badge {
		display: inline-grid;
		place-items: center;
		min-width: 22px;
		height: 22px;
		padding: 0 6px;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		color: var(--accent-ink);
		font-size: 0.78rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.select select {
		-webkit-appearance: none;
		appearance: none;
		min-height: 44px;
		padding: 0 40px 0 44px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text);
		font-weight: 650;
		cursor: pointer;
		transition: background 0.15s;
	}
	.select select:hover {
		background: var(--surface-3);
	}
	.lead,
	.tail {
		position: absolute;
		top: 50%;
		display: grid;
		transform: translateY(-50%);
		color: var(--text-dim);
		pointer-events: none;
	}
	.lead {
		left: 16px;
	}
	.tail {
		right: 14px;
	}
	.dir {
		padding-inline: 14px 16px;
	}
	.arrow {
		display: grid;
		transform: rotate(var(--r, 90deg));
		transition: transform 0.2s var(--ease);
	}
	.order {
		font-variant-numeric: tabular-nums;
	}

	.density {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		width: 176px;
		color: var(--text-faint);
	}
	.density input {
		-webkit-appearance: none;
		appearance: none;
		flex: 1;
		min-width: 0;
		height: 44px;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}
	.density input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent) var(--p, 50%), var(--surface-3) var(--p, 50%));
	}
	.density input::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 22px;
		height: 22px;
		margin-top: -9px;
		border: 0;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.5);
	}
	.density input::-moz-range-track {
		height: 4px;
		border-radius: 999px;
		background: var(--surface-3);
	}
	.density input::-moz-range-progress {
		height: 4px;
		border-radius: 999px;
		background: var(--accent);
	}
	.density input::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.5);
	}

	/* ── status / kind segments, counter, clear ── */
	.mid {
		justify-content: space-between;
		gap: 12px;
	}
	.segs,
	.sel {
		/* padding + negative margin keep focus rings and the 44px tap areas from being clipped by the scroller */
		margin: -4px;
		padding: 4px;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}
	.segs::-webkit-scrollbar,
	.sel::-webkit-scrollbar,
	.controls::-webkit-scrollbar {
		display: none;
	}
	.segs {
		display: flex;
		flex: 1 1 0;
		gap: 10px;
		min-width: 0;
	}
	.seg {
		display: flex;
		flex: none;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
	}
	.chip {
		position: relative;
		flex: none;
	}
	.chip::after {
		/* 36px chip, 44px tap area */
		content: '';
		position: absolute;
		inset: -4px -2px;
	}
	.seg .chip:not(.active) {
		background: transparent;
		border-color: transparent;
	}
	.seg .chip:not(.active):hover {
		background: var(--surface-2);
	}
	.meta {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
	}
	.count {
		padding: 0 6px;
		color: var(--text-dim);
		font-size: 0.92rem;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.count b {
		color: var(--text);
		font-weight: 750;
	}
	.clear {
		padding-inline: 12px;
		color: var(--accent-2);
	}

	/* ── selected filters ── */
	.sel {
		gap: 8px;
	}
	.sel .chip {
		gap: 4px;
		padding-right: 10px;
	}

	@media (max-width: 1099px) {
		.controls {
			display: flex;
			flex: 1 1 100%;
			align-items: center;
			gap: 8px;
			margin: -3px;
			padding: 3px;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.density {
			margin-left: auto;
		}
	}
	@media (max-width: 699px) {
		/* phones: a tall bar would eat the screen, so it scrolls away with the page */
		.toolbar {
			position: static;
			margin: 0 0 16px;
			padding: 0;
			background: none;
			border-bottom: 0;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
		.mid {
			flex-wrap: wrap;
		}
		.segs {
			flex: 1 1 100%;
		}
		.meta {
			flex: 1 1 100%;
			justify-content: space-between;
		}
	}
</style>
