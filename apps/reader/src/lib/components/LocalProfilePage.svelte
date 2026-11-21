<script lang="ts">
	import { page } from '$app/state';
	import { library } from '$lib/library.svelte';
	import { findLocalProfile, profileHref, type ProfileKind } from '$lib/profile';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IssueCard from '$lib/components/IssueCard.svelte';
	import SeriesCard from '$lib/components/SeriesCard.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { kind }: { kind: ProfileKind } = $props();
	const name = $derived(page.params.name ?? '');
	const profile = $derived(findLocalProfile(kind, name, library.issues, library.series));
	const label = $derived(kind === 'characters' ? 'Karaktär' : 'Skapare');
	const plural = $derived(kind === 'characters' ? 'Karaktärsprofiler' : 'Skaparprofiler');
</script>

<svelte:head><title>{profile ? `${profile.name} – ${label}` : `${label} – SuperLight Reader`}</title></svelte:head>

<div class="page profile-page">
	<a class="back" href={`/${kind}`}><Icon name="arrow-left" size={18} />{plural}</a>
	{#if !library.ready}
		<div class="loading" role="status" aria-label={`Laddar ${label.toLocaleLowerCase()}`}><div class="skeleton sk-title"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line short"></div></div>
	{:else if !profile}
		<EmptyState icon="search" title={`${label}en finns inte`} text="Profilen skapas från lokala ComicInfo- och Metron-träffar.">
			<a class="btn btn-primary" href={`/${kind}`}>Visa {plural.toLocaleLowerCase()}</a>
		</EmptyState>
	{:else}
		<header class="heading">
			<p class="eyebrow">{label}</p>
			<h1 class="h1">{profile.name}</h1>
			<p class="muted">{profile.issueCount} matchade nummer i {profile.series.length} {profile.series.length === 1 ? 'serie' : 'serier'}</p>
		</header>
		<div class="series-list">
			{#each profile.series as row (row.series.id)}
				<section class="profile-series" aria-labelledby={`series-${row.series.id}`}>
					<div class="series-title" id={`series-${row.series.id}`}>
						<SeriesCard series={row.series} />
						<div><strong>{row.series.name}</strong><span class="muted">{row.issues.length ? `${row.issues.length} matchade nummer` : 'Serien har skaparen lokalt'}</span></div>
					</div>
					{#if row.issues.length}
						<div class="grid-cards issues">
							{#each row.issues as issue (issue.id)}<IssueCard {issue} series={row.series} />{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

<style>
	.profile-page { display:grid; gap:24px; }
	.back { display:inline-flex; align-items:center; gap:6px; width:max-content; min-height:44px; margin:-6px 0 0 -10px; padding:0 14px 0 10px; border-radius:999px; color:var(--text-dim); font-weight:600; }
	.back:hover { color:var(--text); background:var(--surface); }
	.heading { display:grid; gap:6px; }
	.eyebrow { margin:0; color:var(--accent-2); font-size:.8rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
	.heading h1 { overflow-wrap:anywhere; }
	.series-list { display:grid; gap:36px; }
	.profile-series { display:grid; gap:16px; }
	.series-title { display:grid; grid-template-columns:96px minmax(0,1fr); align-items:center; gap:14px; }
	.series-title :global(.series-card) { width:96px; }
	.series-title > div:last-child { display:grid; gap:5px; min-width:0; }
	.series-title strong { font-size:1.05rem; overflow-wrap:anywhere; }
	.series-title .muted { font-size:.86rem; }
	.issues { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); }
	.loading { display:grid; gap:12px; max-width:30rem; }
	.sk-title { width:60%; height:42px; border-radius:8px; }
	.sk-line { height:14px; border-radius:7px; }
	.sk-line.short { width:35%; }
	@media (min-width:700px) { .issues { grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); } }
</style>
