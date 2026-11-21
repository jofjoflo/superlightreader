<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Filter chip (uses global `.chip` / `.chip.active` classes). With `onclick` renders a <button>, without a <span>.
	 *  `color` paints a small leading dot (e.g. publisher color). `count` renders in `.count`. */
	let {
		active = false,
		count,
		color,
		title,
		onclick,
		children
	}: { active?: boolean; count?: number; color?: string; title?: string; onclick?: () => void; children: Snippet } = $props();
</script>

{#if onclick}<button type="button" class="chip" class:active {title} {onclick}>{@render children()}{#if count != null}<span class="count">{count}</span>{/if}</button>{:else}<span class="chip" class:active {title}>{@render children()}{#if count != null}<span class="count">{count}</span>{/if}</span>{/if}
