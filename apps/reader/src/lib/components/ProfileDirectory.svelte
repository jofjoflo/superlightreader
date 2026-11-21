<script lang="ts">
	import { library } from '$lib/library.svelte';
	import { listLocalProfiles, profileHref, type ProfileKind } from '$lib/profile';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { kind }: { kind: ProfileKind } = $props();
	const label = $derived(kind === 'characters' ? 'Karaktärer' : 'Skapare');
	const names = $derived(listLocalProfiles(kind, library.issues, library.series));
</script>

<svelte:head><title>{label} – SuperLight Reader</title></svelte:head>

<div class="page directory">
	<div class="heading"><h1 class="h1">{label}</h1><p class="muted">Lokala namn från ComicInfo och matchade Metron-nummer.</p></div>
	{#if !library.ready}
		<div class="skeleton loading" role="status" aria-label={`Laddar ${label.toLocaleLowerCase()}`}></div>
	{:else if !names.length}
		<EmptyState icon="search" title={`Inga ${label.toLocaleLowerCase()} ännu`} text="Matcha ett nummer mot Metron eller lägg till ComicInfo med namn.">
			<a class="btn btn-primary" href="/library">Till biblioteket</a>
		</EmptyState>
	{:else}
		<ul class="names" aria-label={label}>
			{#each names as name (name)}<li><a class="name" href={profileHref(kind, name)}><span>{name}</span><Icon name="chevron-right" size={18} /></a></li>{/each}
		</ul>
	{/if}
</div>

<style>
	.directory { display:grid; gap:22px; }
	.heading { display:grid; gap:6px; }
	.names { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr)); gap:8px; max-width:1000px; padding:0; list-style:none; }
	.name { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:52px; padding:0 15px; border:1px solid var(--border); border-radius:var(--radius-s); background:var(--surface); }
	.name:hover { border-color:var(--accent); color:var(--accent-2); }
	.name span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.loading { width:100%; max-width:30rem; height:48px; border-radius:var(--radius-s); }
</style>
