<script lang="ts">
	/** 5 star buttons (44px touch targets even if icon is `size`). value 0/undefined = none. Clicking the current value clears (onchange(0)).
	 *  Read-only when `onchange` is not given. aria-label per star: "Betyg 3 av 5". */
	let { value, onchange, size = 22 }: { value?: number; onchange?: (n: number) => void; size?: number } = $props();
</script>

	<div class="stars" style={`--star-size:${size}px`} role="group" aria-label="Betyg">
		{#each [1, 2, 3, 4, 5] as n}
			{#if onchange}<button type="button" aria-label={`Betyg ${n} av 5`} class:active={(value ?? 0) >= n} onclick={() => onchange?.(value === n ? 0 : n)}>★</button>{:else}<span aria-label={`Betyg ${n} av 5`} class:active={(value ?? 0) >= n}>★</span>{/if}
		{/each}
	</div>

<style>
	.stars { display:flex; align-items:center; gap:2px; }
	.stars button,.stars span { display:grid; place-items:center; width:44px; height:44px; color:var(--text-faint); font-size:var(--star-size); }
	.stars button:hover,.stars .active { color:var(--accent-2); }
	.stars button:active { transform:scale(.92); }
</style>
