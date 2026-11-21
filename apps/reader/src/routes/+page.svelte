<script lang="ts">
	import { library } from '$lib/library.svelte';
	import { toast } from '$lib/toast.svelte';
	import { UNKNOWN_PUBLISHER } from '$lib/types';
	import type { Issue, Series } from '$lib/types';
	import Hero from '$lib/components/Hero.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IssueCard from '$lib/components/IssueCard.svelte';
	import PublisherTile from '$lib/components/PublisherTile.svelte';
	import SeriesCard from '$lib/components/SeriesCard.svelte';
	import Shelf from '$lib/components/Shelf.svelte';

	const fmt = new Intl.NumberFormat('sv-SE');
	const collator = new Intl.Collator('sv');

	type HeroPick = { mode: 'continue' | 'start'; series: Series; issue?: Issue; note?: string };
	/** "Fortsätt läsa" wins; otherwise the top recommendation, then the first starter, then any series shelf. */
	const hero = $derived.by((): HeroPick | undefined => {
		const rows = library.homeRows;
		const cont = rows.find((r) => r.id === 'continue');
		if (cont?.kind === 'issues' && cont.items[0]) return { mode: 'continue', series: cont.items[0].series, issue: cont.items[0].issue };
		const ordered = [...['foryou', 'starters'].map((id) => rows.find((r) => r.id === id)), ...rows];
		for (const row of ordered) {
			if (row?.kind === 'series' && row.items[0]) return { mode: 'start', series: row.items[0].series, note: row.items[0].note };
		}
		return undefined;
	});

	const stats = $derived({
		series: library.series.length,
		issues: library.issues.length,
		publishers: library.facets.publishers.filter((p) => p.value !== UNKNOWN_PUBLISHER).length
	});

	/** Top 12 known publishers by series count, one pass over the series. */
	const publisherTiles = $derived.by(() => {
		const byName = new Map<string, { name: string; seriesCount: number; issueCount: number; covers: string[] }>();
		for (const s of library.series) {
			if (s.publisher === UNKNOWN_PUBLISHER) continue;
			let t = byName.get(s.publisher);
			if (!t) byName.set(s.publisher, (t = { name: s.publisher, seriesCount: 0, issueCount: 0, covers: [] }));
			t.seriesCount++;
			t.issueCount += s.issueCount;
			if (t.covers.length < 3 && library.coverUrl(s.coverIssueId)) t.covers.push(s.coverIssueId);
		}
		return [...byName.values()].sort((a, b) => b.seriesCount - a.seriesCount || collator.compare(a.name, b.name)).slice(0, 12);
	});

	const genres = $derived(library.facets.genres.slice(0, 16));

	/** Both pickers must be started synchronously inside the click handler (user-gesture requirement). */
	async function pick(kind: 'folder' | 'files') {
		try {
			const res = await library.pick(kind);
			if (!res) return;
			if (res.added) toast.show(res.added === 1 ? '1 nytt nummer tillagt' : `${res.added} nya nummer tillagda`, { kind: 'ok' });
			if (res.failed.length) toast.show(`${res.failed.length} filer kunde inte läsas`, { kind: 'error' });
		} catch {
			toast.show('Det gick inte att läsa in filerna. Försök igen.', { kind: 'error' });
		}
	}
	async function demo() {
		try {
			const res = await library.addDemo();
			if (res.added) toast.show('Demodata tillagd', { kind: 'ok' });
		} catch {
			toast.show('Det gick inte att skapa demodata.', { kind: 'error' });
		}
	}
</script>

<svelte:head><title>Hem – SuperLight Reader</title></svelte:head>

<div class="page">
	<h1 class="sr-only">Hem</h1>

	{#if !library.ready}
		<div class="sk" role="status" aria-label="Laddar biblioteket">
			<div class="skeleton sk-hero"></div>
			<div class="skeleton sk-stats"></div>
			{#each [0, 1, 2] as r (r)}
				<section class="sk-shelf">
					<div class="skeleton sk-title"></div>
					<div class="scroll-x sk-row">
						{#each [0, 1, 2, 3, 4, 5, 6, 7] as c (c)}
							<div class="cell">
								<div class="skeleton sk-cover"></div>
								<div class="skeleton sk-line"></div>
								<div class="skeleton sk-line short"></div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{:else if library.issues.length === 0}
		<section class="welcome">
			<svg class="glyph" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
				<defs>
					<linearGradient id="slr-glyph" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" style="stop-color: var(--accent)" />
						<stop offset="1" style="stop-color: var(--accent-2)" />
					</linearGradient>
				</defs>
				<rect x="4" y="4" width="88" height="88" rx="26" fill="url(#slr-glyph)" />
				<path d="M56 12 26 54h19l-7 30 32-44H51z" style="fill: var(--accent-ink)" />
			</svg>
			<h2 class="h1">Välkommen till SuperLight Reader</h2>
			<p class="muted lead">Välj mappen där dina serier ligger. Filerna stannar på din enhet. Serienamn kan skickas till metadatatjänster.</p>
			<div class="actions">
				<button class="btn btn-primary big" onclick={() => pick('folder')} disabled={library.scan.active}>
					<Icon name="folder" size={20} />Välj mapp
				</button>
				<button class="btn big" onclick={() => pick('files')} disabled={library.scan.active}>
					<Icon name="file" size={20} />Välj filer
				</button>
			</div>
			<button class="link" onclick={demo} disabled={library.scan.active}>Prova med demodata</button>
			<p class="tip faint">Fungerar inte mappval? Välj flera filer i stället.</p>
		</section>
	{:else}
		{#if hero}
			<Hero mode={hero.mode} series={hero.series} issue={hero.issue} note={hero.note} />
		{/if}

		<ul class="stats" aria-label="Ditt bibliotek">
			<li><b>{fmt.format(stats.series)}</b> {stats.series === 1 ? 'serie' : 'serier'}</li>
			<li><b>{fmt.format(stats.issues)}</b> nummer</li>
			<li><b>{fmt.format(stats.publishers)}</b> förlag</li>
		</ul>

		{#each library.homeRows as row (row.id)}
			{#if row.items.length}
				{#if row.kind === 'issues'}
					<Shelf title={row.title} subtitle={row.subtitle}>
						{#each row.items as it (it.issue.id)}
							<div class="cell"><IssueCard issue={it.issue} series={it.series} note={it.note} showSeries /></div>
						{/each}
					</Shelf>
				{:else}
					<Shelf title={row.title} subtitle={row.subtitle} href={row.href}>
						{#each row.items as it (it.series.id)}
							<div class="cell"><SeriesCard series={it.series} note={it.note} /></div>
						{/each}
					</Shelf>
				{/if}
			{/if}
		{/each}

		{#if publisherTiles.length}
			<Shelf title="Förlag" href="/publishers">
				{#each publisherTiles as p (p.name)}
					<div class="cell pub">
						<PublisherTile name={p.name} seriesCount={p.seriesCount} issueCount={p.issueCount} coverIssueIds={p.covers} />
					</div>
				{/each}
			</Shelf>
		{/if}

		{#if genres.length}
			<section class="genres">
				<h2 class="h2">Genrer</h2>
				<div class="genre-chips">
					{#each genres as g (g.value)}
						<a class="chip genre" href="/library?genre={encodeURIComponent(g.value)}">{g.value}<span class="count">{g.count}</span></a>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	/* shelf cells: fixed width so cards keep their size inside the horizontal scrollers */
	.cell {
		width: var(--shelf-card-w, calc(var(--card-min, 170px) * 0.92));
	}
	.cell.pub {
		width: clamp(230px, 24vw, 300px);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 0;
		margin: 18px 2px 28px;
		padding: 0;
		list-style: none;
		color: var(--text-dim);
		font-size: 0.97rem;
	}
	.stats li + li::before {
		content: '·';
		margin: 0 14px;
		color: var(--text-faint);
	}
	.stats b {
		color: var(--text);
		font-weight: 750;
		font-variant-numeric: tabular-nums;
	}

	.genres {
		margin-bottom: 12px;
	}
	.genre-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 12px;
	}
	.chip.genre {
		min-height: 44px;
		padding-inline: 16px;
	}

	/* ── skeleton ── */
	.sk-hero {
		height: clamp(300px, 42vh, 460px);
		border-radius: var(--radius-l);
	}
	.sk-stats {
		width: 260px;
		max-width: 70%;
		height: 20px;
		margin: 22px 2px 30px;
		border-radius: 8px;
	}
	.sk-shelf {
		margin-bottom: 28px;
	}
	.sk-title {
		width: 220px;
		max-width: 60%;
		height: 24px;
		margin-bottom: 10px;
		border-radius: 8px;
	}
	.sk-row {
		overflow: hidden;
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

	/* ── welcome (empty library) ── */
	.welcome {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 16px;
		min-height: min(72vh, 600px);
		padding: 40px 22px;
		text-align: center;
		border: 1px solid var(--border);
		border-radius: var(--radius-l);
		background:
			radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 70%),
			radial-gradient(50% 40% at 85% 100%, color-mix(in srgb, var(--accent-2) 12%, transparent), transparent 70%),
			var(--surface);
		animation: rise 0.5s var(--ease) both;
	}
	.glyph {
		filter: drop-shadow(0 14px 32px color-mix(in srgb, var(--accent) 45%, transparent));
	}
	.welcome .h1 {
		max-width: 20ch;
		text-wrap: balance;
	}
	.lead {
		max-width: 44ch;
		font-size: 1.08rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 8px;
	}
	.btn.big {
		min-height: 52px;
		padding-inline: 26px;
		font-size: 1.02rem;
	}
	.link {
		min-height: 44px;
		padding: 0 14px;
		border-radius: 999px;
		color: var(--accent-2);
		font-weight: 650;
	}
	.link:hover {
		text-decoration: underline;
	}
	.link[disabled] {
		opacity: 0.45;
		pointer-events: none;
	}
	.tip {
		max-width: 44ch;
		font-size: 0.88rem;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
</style>
