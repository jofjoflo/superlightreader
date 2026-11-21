<script lang="ts" module>
	import type { IconName } from './Icon.svelte';

	export type FacetGroup = 'publishers' | 'genres' | 'decades';
	export type FacetValue = string | number;
	export interface FacetOption {
		value: FacetValue;
		count: number;
	}

	/** The three multi-select filter groups of /library: sheet title, button icon and how a value reads. */
	export const FACETS: Record<FacetGroup, { title: string; icon: IconName; label: (value: FacetValue) => string }> = {
		publishers: { title: 'Förlag', icon: 'building', label: String },
		genres: { title: 'Genre', icon: 'bookmark', label: String },
		decades: { title: 'Årtionde', icon: 'clock', label: (v) => `${v}-talet` }
	};
</script>

<script lang="ts">
	import Chip from './Chip.svelte';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	/**
	 * Multi-select sheet for one facet group. Mount it only while it is open (the search text resets per open).
	 * `options` already carry counts that reflect the other active filters; selected values the other filters
	 * exclude arrive with count 0 so they can still be removed. Selection changes apply immediately.
	 */
	let {
		group,
		options,
		selected,
		resultCount,
		ontoggle,
		onclear,
		onclose
	}: {
		group: FacetGroup;
		options: FacetOption[];
		selected: FacetValue[];
		resultCount: number;
		ontoggle: (value: FacetValue) => void;
		onclear: () => void;
		onclose: () => void;
	} = $props();

	const fmt = new Intl.NumberFormat('sv-SE');
	const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

	const meta = $derived(FACETS[group]);
	let query = $state('');
	/** Long lists (publishers, genres) get a search field; it stays while a query is typed. */
	const searchable = $derived(options.length > 12 || query !== '');
	const picked = $derived(new Set(selected));
	const shown = $derived.by(() => {
		const words = fold(query).split(/\s+/).filter(Boolean);
		if (!words.length) return options;
		return options.filter((o) => {
			const hay = fold(meta.label(o.value));
			return words.every((w) => hay.includes(w));
		});
	});
</script>

<Sheet open title={meta.title} {onclose}>
	{#if searchable}
		<div class="find">
			<div class="field">
				<Icon name="search" size={18} />
				<input
					type="search"
					bind:value={query}
					placeholder="Sök {meta.title.toLowerCase()}"
					aria-label="Sök bland {meta.title.toLowerCase()}"
					autocomplete="off"
					spellcheck="false"
				/>
			</div>
		</div>
	{/if}

	{#if shown.length}
		<div class="chips" role="group" aria-label={meta.title}>
			{#each shown as o (o.value)}
				{@const on = picked.has(o.value)}
				<span class="opt" class:zero={o.count === 0}>
					<Chip active={on} count={o.count} onclick={() => ontoggle(o.value)}>
						{meta.label(o.value)}{#if on}<span class="sr-only"> (vald)</span>{/if}
					</Chip>
				</span>
			{/each}
		</div>
	{:else}
		<p class="muted none">Inga träffar{query.trim() ? ` för ”${query.trim()}”` : ''}.</p>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-ghost" disabled={!selected.length} onclick={onclear}>Rensa</button>
		<button type="button" class="btn btn-primary" onclick={onclose}>
			{resultCount ? `Visa ${fmt.format(resultCount)} ${resultCount === 1 ? 'serie' : 'serier'}` : 'Klar'}
		</button>
	{/snippet}
</Sheet>

<style>
	/* sticks to the top of the sheet's scrolling body (which has 20px padding) */
	.find {
		position: sticky;
		top: -20px;
		z-index: 1;
		margin: -20px -20px 14px;
		padding: 14px 20px 10px;
		background: var(--bg-raised);
	}
	.field {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-dim);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.field:focus-within {
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.field input {
		flex: 1;
		min-width: 0;
		height: 42px;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
		font-size: 1rem;
	}
	.field input::placeholder {
		color: var(--text-faint);
	}
	.field input::-webkit-search-cancel-button {
		-webkit-appearance: none;
		appearance: none;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.chips :global(.chip) {
		min-height: 44px;
		padding-inline: 16px;
	}
	.opt {
		display: inline-flex;
	}
	.opt.zero {
		opacity: 0.72;
	}
	.none {
		padding: 22px 0;
		text-align: center;
	}
</style>
