<script lang="ts">
	import { library } from '$lib/library.svelte';

	/** Cover thumbnail of an issue. 2:3 box, object-fit cover, placeholder tinted with issue.color while loading / when missing. */
	let { issueId, alt = '', class: cls = '' }: { issueId?: string; alt?: string; class?: string } = $props();
	const url = $derived(library.coverUrl(issueId));
	const issue = $derived(issueId ? library.getIssue(issueId) : undefined);
</script>

<div class={`cover ${cls}`} style:--cover-color={issue?.color ?? '#272d3f'}>
	{#if url}<img src={url} {alt} loading="lazy" decoding="async" />{:else}<span class="cover-placeholder" aria-hidden="true">▦</span>{/if}
</div>

<style>
	.cover { position: relative; aspect-ratio: 2 / 3; overflow: hidden; background: linear-gradient(145deg, color-mix(in srgb, var(--cover-color) 50%, var(--surface)), var(--surface-2)); }
	.cover img { width: 100%; height: 100%; object-fit: cover; }
	.cover-placeholder { display: grid; place-items: center; width: 100%; height: 100%; color: color-mix(in srgb, var(--cover-color) 70%, white); font-size: 2rem; opacity: .55; }
</style>
