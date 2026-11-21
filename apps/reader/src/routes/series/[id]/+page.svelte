<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { library } from '$lib/library.svelte';
	import { toast } from '$lib/toast.svelte';
	import { similarSeries } from '$lib/recommend';
	import { profileHref } from '$lib/profile';
	import type { Issue, Series } from '$lib/types';
	import Cover from '$lib/components/Cover.svelte';
	import EditSeriesSheet from '$lib/components/EditSeriesSheet.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IssueCard from '$lib/components/IssueCard.svelte';
	import MetaPicker from '$lib/components/MetaPicker.svelte';
	import MetronIssuePicker from '$lib/components/MetronIssuePicker.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import RatingStars from '$lib/components/RatingStars.svelte';
	import SeriesCard from '$lib/components/SeriesCard.svelte';
	import Shelf from '$lib/components/Shelf.svelte';
	import Sheet from '$lib/components/Sheet.svelte';

	type IssueStatus = { text: string; value: number; done: boolean };

	const VIEW_KEY = 'slr.issueView';
	const STATE_TEXT = { unread: 'Oläst', reading: 'Pågående', done: 'Läst' } as const;
	const SOURCES: Record<string, string> = {
		wikipedia: 'Wikipedia',
		anilist: 'AniList',
		googlebooks: 'Google Books',
		openlibrary: 'Open Library',
		user: 'Egna uppgifter'
	};

	const series = $derived(library.getSeries(page.params.id ?? ''));
	const similar = $derived(series ? similarSeries(series, library.series, 12) : []);
	const genres = $derived([...new Set(series?.genres ?? [])]);

	// ───────── formatting helpers ─────────
	/** Only http(s) links from online sources are rendered as links. */
	const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);
	const creatorHref = (creator: string) => profileHref('creators', creator);
	const characterHref = (character: string) => profileHref('characters', character);
	type MetronBatchItem = { issueId: string; status: string; error?: string; candidates?: unknown[] };
	type MetronBatchProgress = { done?: number; total?: number; currentIssueId?: string; matched?: number; ambiguous?: number; notFound?: number; skipped?: number; failed?: number; rateLimited?: number };
	type MetronBatchJob = {
		active?: boolean;
		seriesId?: string;
		done?: number;
		total?: number;
		progress?: MetronBatchProgress;
		items?: MetronBatchItem[];
		result?: { items?: MetronBatchItem[]; progress?: MetronBatchProgress };
	};
	type MetronBatchApi = {
		fetchMetronBatch?: (seriesId: string) => Promise<unknown>;
		cancelMetronBatch?: () => void;
		metronBatch?: MetronBatchJob;
	};
	const batchApi = library as typeof library & MetronBatchApi;

	function yearText(s: Series): string {
		const a = s.startYear;
		const b = s.endYear;
		if (!a) return b ? `${b}` : 'År okänt';
		if (b && b !== a) return `${a}–${b}`;
		return s.status === 'ongoing' && !b ? `${a} – pågår` : `${a}`;
	}
	const issueNum = (i: Issue) => (i.number != null ? `#${i.number}` : (i.numberLabel ?? ''));
	function issueName(i: Issue): string {
		const n = issueNum(i);
		if (n && i.title) return `${n} ${i.title}`;
		return n || i.title || i.fileName.replace(/\.[a-z0-9]{2,4}$/i, '');
	}
	function unsupportedText(i: Issue): string {
		switch (i.unsupported) {
			case 'rar':
				return 'RAR/CBR stöds inte på den här enheten än';
			case 'encrypted':
				return 'Krypterad – kan inte öppnas';
			case 'corrupt':
				return 'Skadad – kan inte öppnas';
			default:
				return 'Kan inte öppnas på den här enheten';
		}
	}
	function status(i: Issue): IssueStatus {
		const p = library.progressOf(i.id);
		if (p?.completed) return { text: 'Läst', value: 1, done: true };
		if (p && p.page > 0 && p.pageCount) {
			return { text: `Pågående · sida ${p.page + 1} av ${p.pageCount}`, value: (p.page + 1) / p.pageCount, done: false };
		}
		return { text: 'Oläst', value: 0, done: false };
	}

	// ───────── read button ─────────
	const target = $derived(series?.nextIssueId ?? series?.issues[0]?.id);
	const playable = $derived(!!series?.issues.some((i) => !i.unsupported));
	const readLabel = $derived(
		series?.inProgressIssueId || series?.state === 'reading' ? 'Fortsätt läsa' : series?.state === 'done' ? 'Läs om' : 'Börja läsa'
	);
	const readHint = $derived.by(() => {
		const s = series;
		const i = target ? library.getIssue(target) : undefined;
		if (!s || !i) return '';
		const label = issueNum(i) || issueName(i);
		const p = library.progressOf(i.id);
		if (p && !p.completed && p.page > 0 && p.pageCount) return `${label} · sida ${p.page + 1} av ${p.pageCount}`;
		return s.state === 'done' ? `Börjar om på ${label}` : s.state === 'reading' ? `Nästa: ${label}` : `Börjar på ${label}`;
	});

	// ───────── ui state ─────────
	let menuOpen = $state(false);
	let pickerOpen = $state(false);
	let editOpen = $state(false);
	let confirmRemove = $state(false);
	let removing = $state(false);
	let fetching = $state(false);
	let canGoBack = $state(false);
	let moreBtn = $state<HTMLButtonElement>();
	let menuEl = $state<HTMLDivElement>();
	let metronIssue = $state<Issue>();
	let batchFetching = $state(false);
	let batchResult = $state<{ items?: MetronBatchItem[] }>();
	const batchJob = $derived(batchApi.metronBatch);
	const batchForSeries = $derived.by(() => {
		const job = batchJob;
		const id = series?.id;
		return job && (!job.seriesId || !id || job.seriesId === id) ? job : undefined;
	});
	const batchProgress = $derived(batchForSeries?.progress ?? batchForSeries);
	const batchItems = $derived(batchResult?.items ?? batchForSeries?.result?.items ?? batchForSeries?.items ?? []);
	const batchReviewItems = $derived(batchItems.filter((item) => item.status === 'ambiguous' || item.status === 'failed' || item.status === 'not-found'));
	const batchVisible = $derived(!!batchForSeries && (!!batchForSeries.active || batchItems.length > 0));

	// description: clamped to 4 lines, "Läs mer" only when the text really overflows
	let expanded = $state<string | null>(null); // id of the series whose description is open
	const descOpen = $derived(!!series && expanded === series.id);
	let descEl = $state<HTMLElement>();
	let overflowing = $state(false);
	$effect(() => {
		const el = descEl;
		void series?.description; // re-measure when the text changes
		if (!el) {
			overflowing = false;
			return;
		}
		const measure = () => {
			if (!descOpen) overflowing = el.scrollHeight > el.clientHeight + 1;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});
	function toggleDesc() {
		expanded = descOpen || !series ? null : series.id;
	}

	// issue list: view + order (the view choice is remembered per device)
	let view = $state<'grid' | 'list'>('grid');
	let desc = $state(false);
	try {
		const v = localStorage.getItem(VIEW_KEY);
		if (v === 'grid' || v === 'list') view = v;
	} catch {
		/* storage unavailable */
	}
	function setView(v: 'grid' | 'list') {
		view = v;
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			/* ignore */
		}
	}
	const issues = $derived(series ? (desc ? [...series.issues].reverse() : series.issues) : []);

	// "Tillbaka" only goes back when the user arrived from inside the app
	afterNavigate((nav) => {
		canGoBack = nav.from !== null;
	});
	function back() {
		if (canGoBack) history.back();
		else void goto('/library');
	}

	// focus the first menu item when the menu opens; Escape closes it
	$effect(() => {
		if (menuOpen) menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	});
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuOpen) {
			e.preventDefault();
			menuOpen = false;
			moreBtn?.focus();
		}
	}
	function menuDo(fn: () => unknown) {
		menuOpen = false;
		fn();
	}

	// ───────── actions ─────────
	async function fetchMeta() {
		const s = series;
		if (!s || fetching) return;
		fetching = true;
		try {
			const m = await library.enrichSeries(s.id, { force: true });
			if (!m || m.notFound) toast.show('Ingen träff – prova ’Fel match?’');
			else toast.show(`Matchad mot ’${m.matchedTitle ?? s.name}’`, { kind: 'ok' });
		} catch {
			toast.show('Det gick inte att hämta metadata. Kontrollera anslutningen.', { kind: 'error' });
		} finally {
			fetching = false;
		}
	}

	function toggleAllRead() {
		const s = series;
		if (!s) return;
		const read = s.state !== 'done';
		library.markSeriesRead(s.id, read);
		toast.show(read ? 'Alla nummer markerades som lästa' : 'Alla nummer markerades som olästa', { kind: 'ok' });
	}

	function toggleRead(i: Issue) {
		library.markIssues([i.id], !library.progressOf(i.id)?.completed);
	}

	function openMetron(i: Issue) {
		metronIssue = i;
	}

	async function fetchBatch() {
		const s = series;
		if (!s || batchFetching || batchForSeries?.active || !batchApi.fetchMetronBatch) return;
		batchFetching = true;
		batchResult = undefined;
		try {
			batchResult = (await batchApi.fetchMetronBatch(s.id)) as { items?: MetronBatchItem[] };
			const reviewCount = batchResult.items?.filter((item) => item.status === 'ambiguous' || item.status === 'failed' || item.status === 'not-found').length ?? 0;
			toast.show(reviewCount ? `${reviewCount} nummer behöver granskas.` : 'Metron-data hämtad för serien.', { kind: reviewCount ? 'error' : 'ok' });
		} catch (e) {
			toast.show(e instanceof Error ? e.message : 'Det gick inte att hämta Metron-data.', { kind: 'error' });
		} finally {
			batchFetching = false;
		}
	}

	function cancelBatch() {
		batchApi.cancelMetronBatch?.();
	}

	function batchStatus(item: MetronBatchItem): string {
		if (item.status === 'ambiguous') return item.candidates?.length ? `Tvetydig (${item.candidates.length} träffar)` : 'Tvetydig';
		if (item.status === 'not-found') return 'Ingen träff';
		return item.error ? `Misslyckad · ${item.error}` : 'Misslyckad';
	}

	async function remove() {
		const s = series;
		if (!s || removing) return;
		confirmRemove = false;
		removing = true; // shows the skeleton instead of a flash of "Serien finns inte"
		try {
			await library.removeSeries(s.id);
			toast.show(`’${s.name}’ togs bort från biblioteket`, { kind: 'ok' });
			await goto('/library', { replaceState: true });
		} catch {
			toast.show('Det gick inte att ta bort serien. Försök igen.', { kind: 'error' });
		} finally {
			removing = false;
		}
	}
</script>

<svelte:head><title>{series ? `${series.name} – SuperLight Reader` : 'Serie – SuperLight Reader'}</title></svelte:head>
<svelte:window onkeydown={onKey} />

{#snippet rowBody(issue: Issue, st: IssueStatus, links = true)}
	<span class="thumb"><Cover issueId={issue.id} alt="" /></span>
	<span class="rt">
		<span class="rname clamp-1">{issueName(issue)}</span>
		<span class="rsub">
			{#if issue.pageCount}<span>{issue.pageCount} sidor</span>{/if}
			<span class="st" class:done={st.done}>{st.text}</span>
			{#if issue.unsupported}
				<span class="warn"><Icon name="cloud-off" size={14} />{unsupportedText(issue)}</span>
			{:else if !library.isLinked(issue.id)}
				<span class="warn" title="Filen är inte länkad"><Icon name="cloud-off" size={14} />Ej länkad – välj mappen igen</span>
			{/if}
		</span>
		{#if issue.characters?.length}<span class="issue-characters"><b>Karaktärer</b> {#each issue.characters as character, i}{#if links}<a href={characterHref(character)}>{character}</a>{:else}{character}{/if}{#if i < issue.characters.length - 1}, {/if}{/each}</span>{/if}
		{#if issue.metron?.characters.length}<span class="issue-characters metron-data"><b>Metron-karaktärer</b> {#each issue.metron.characters as character, i}{#if links}<a href={characterHref(character)}>{character}</a>{:else}{character}{/if}{#if i < issue.metron.characters.length - 1}, {/if}{/each}</span>{/if}
		{#if issue.metron?.creators.length}<span class="issue-characters metron-data"><b>Metron-skapare</b> {#each issue.metron.creators as creator, i}{#if links}<a href={creatorHref(creator)}>{creator}</a>{:else}{creator}{/if}{#if i < issue.metron.creators.length - 1}, {/if}{/each}</span>{/if}
		{#if issue.metron}<span class="metron-match"><Icon name="check" size={13} /> Metron-match · id {issue.metron.id}{#if safeUrl(issue.metron.sourceUrl)} · <a href={safeUrl(issue.metron.sourceUrl)} target="_blank" rel="noopener noreferrer">Källa</a>{/if}</span>{/if}
		{#if !st.done && st.value > 0}<ProgressBar value={st.value} height={3} />{/if}
	</span>
{/snippet}

{#if !library.ready || removing}
	<div class="page" role="status" aria-label="Laddar serien">
		<div class="top">
			<div class="skeleton sk-cover"></div>
			<div class="sk-info">
				<div class="skeleton sk-line sk-title"></div>
				<div class="skeleton sk-line w50"></div>
				<div class="skeleton sk-btn"></div>
				<div class="skeleton sk-line"></div>
				<div class="skeleton sk-line"></div>
				<div class="skeleton sk-line w70"></div>
			</div>
		</div>
	</div>
{:else if !series}
	<div class="page">
		<EmptyState icon="book" title="Serien finns inte" text="Den kan ha tagits bort från biblioteket.">
			<a class="btn btn-primary" href="/library">Till biblioteket</a>
		</EmptyState>
	</div>
{:else}
	{@const cover = library.coverUrl(series.coverIssueId)}
	{@const m = series.matched ? series.meta : undefined}
	{@const srcUrl = safeUrl(m?.sourceUrl)}
	<div class="page series-page">
		<div class="backdrop" aria-hidden="true" style:--tint={series.color ?? 'var(--surface-3)'}>
			{#if cover}<img src={cover} alt="" decoding="async" />{/if}
		</div>

		<button type="button" class="back" onclick={back}>
			<Icon name="arrow-left" size={18} />{canGoBack ? 'Tillbaka' : 'Bibliotek'}
		</button>

		<section class="top" aria-labelledby="series-title">
			<div class="cover"><Cover issueId={series.coverIssueId} alt={`Omslag: ${series.name}`} /></div>

			<div class="info">
				<h1 class="h1 title" id="series-title">{series.name}</h1>

				<div class="facts">
					<a class="chip pub" href={`/library?publisher=${encodeURIComponent(series.publisher)}`}>
						<Icon name="building" size={16} />{series.publisher}
					</a>
					<span>{yearText(series)}</span>
					<span>{series.issueCount} nummer</span>
					<span class="state" data-s={series.state}>{STATE_TEXT[series.state]}</span>
				</div>

				<div class="actions">
					{#if target && playable}
						<a class="btn btn-primary cta" href={`/read/${encodeURIComponent(target)}`}>
							<Icon name="play" size={20} />{readLabel}
						</a>
					{:else}
						<button type="button" class="btn btn-primary cta" disabled><Icon name="play" size={20} />{readLabel}</button>
					{/if}
					<button
						type="button"
						class="btn btn-icon"
						class:fav={series.favorite}
						aria-label="Favorit"
						aria-pressed={series.favorite}
						title={series.favorite ? 'Ta bort från favoriter' : 'Lägg till i favoriter'}
						onclick={() => library.toggleFavorite(series.id)}
					>
						<Icon name={series.favorite ? 'heart-fill' : 'heart'} size={22} />
					</button>
					<button
						type="button"
						class="btn btn-icon"
						class:on={series.state === 'done'}
						aria-label={series.state === 'done' ? 'Markera alla nummer som olästa' : 'Markera alla nummer som lästa'}
						title={series.state === 'done' ? 'Markera alla som olästa' : 'Markera alla som lästa'}
						onclick={toggleAllRead}
					>
						<Icon name="check" size={22} />
					</button>
					<div class="more">
						<button
							type="button"
							class="btn btn-icon"
							bind:this={moreBtn}
							aria-label="Fler åtgärder"
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							onclick={() => (menuOpen = !menuOpen)}
						>
							<Icon name="more" size={22} />
						</button>
						{#if menuOpen}
							<button type="button" class="scrim" tabindex="-1" aria-label="Stäng menyn" onclick={() => (menuOpen = false)}></button>
							<div class="menu" role="menu" aria-label="Åtgärder för serien" bind:this={menuEl}>
								<button type="button" role="menuitem" class="mi" disabled={fetching} onclick={() => menuDo(fetchMeta)}>
									<Icon name="refresh" size={20} /><span>Hämta metadata igen</span>
								</button>
								<button type="button" role="menuitem" class="mi" onclick={() => menuDo(() => (pickerOpen = true))}>
									<Icon name="search" size={20} /><span>Fel match? Sök manuellt</span>
								</button>
								<button type="button" role="menuitem" class="mi" onclick={() => menuDo(() => (editOpen = true))}>
									<Icon name="edit" size={20} /><span>Redigera uppgifter</span>
								</button>
								<div class="sep" role="separator"></div>
								<button type="button" role="menuitem" class="mi danger" onclick={() => menuDo(() => (confirmRemove = true))}>
									<Icon name="trash" size={20} /><span>Ta bort från biblioteket</span>
								</button>
							</div>
						{/if}
					</div>
				</div>
				{#if !playable}
					<p class="hint">Inga nummer i serien kan öppnas på den här enheten än.</p>
				{:else if readHint}
					<p class="hint clamp-1">{readHint}</p>
				{/if}

				<div class="meter">
					<div class="rate">
						<span class="k">Ditt betyg</span>
						<RatingStars value={series.rating} onchange={(n) => library.setRating(series.id, n || undefined)} />
					</div>
					<div class="prog">
						<span class="k"><b>{series.completedCount}</b> av {series.issueCount} {series.issueCount === 1 ? 'läst' : 'lästa'}</span>
						<ProgressBar value={series.progress} height={6} />
					</div>
				</div>

				<div class="about">
					{#if series.description}
						<div class="desc">
							<p bind:this={descEl} class:clamped={!descOpen}>{series.description}</p>
							{#if overflowing || descOpen}
								<button type="button" class="link" aria-expanded={descOpen} onclick={toggleDesc}>
									{descOpen ? 'Visa mindre' : 'Läs mer'}
								</button>
							{/if}
						</div>
					{:else}
						<p class="muted">Ingen beskrivning tillgänglig ännu.</p>
					{/if}

					{#if genres.length}
						<ul class="chips" aria-label="Genrer">
							{#each genres as g (g)}
								<li><a class="chip" href={`/library?genre=${encodeURIComponent(g)}`}>{g}</a></li>
							{/each}
						</ul>
					{/if}

					{#if series.creators.length}
						<p class="creators">
							<b>Skapare</b>
							{#each series.creators.slice(0, 6) as creator, i}
								{#if i}, {/if}<a class="creator" href={creatorHref(creator)}>{creator}</a>
							{/each}
							{#if series.creators.length > 6}
								+{series.creators.length - 6}{/if}
						</p>
					{/if}

					<div class="source">
						{#if m}
							<span class="src-text">
								Källa: {SOURCES[m.source ?? ''] ?? m.source ?? 'okänd'}{#if m.matchedTitle}
									–
									{#if srcUrl}<a href={srcUrl} target="_blank" rel="noopener noreferrer">’{m.matchedTitle}’</a>{:else}’{m.matchedTitle}’{/if}
								{/if}
							</span>
							<button type="button" class="btn small" onclick={() => (pickerOpen = true)}>Fel match?</button>
						{:else}
							<span class="src-text">{series.meta?.notFound ? 'Ingen träff online ännu.' : 'Ingen metadata hämtad ännu.'}</span>
							<button type="button" class="btn small" disabled={fetching} onclick={fetchMeta}>
								<span class="spin" class:on={fetching}><Icon name="refresh" size={18} /></span>{fetching ? 'Hämtar…' : 'Hämta metadata'}
							</button>
							<button type="button" class="btn btn-ghost small" onclick={() => (pickerOpen = true)}>Fel match?</button>
						{/if}
					</div>
				</div>
			</div>
		</section>

		<section class="issues-sec" aria-labelledby="issues-h">
			<div class="issues-head">
				<h2 class="h2" id="issues-h">Nummer<span class="count">{series.issueCount}</span></h2>
				<div class="tools">
					<button type="button" class="btn small" disabled={batchFetching || !!batchForSeries?.active || !batchApi.fetchMetronBatch} onclick={fetchBatch} title={!batchApi.fetchMetronBatch ? 'Batchhämtning laddas snart' : 'Hämta Metron-data för alla nummer'}>
						<Icon name="refresh" size={17} />{#if batchForSeries?.active}{batchProgress?.done ?? 0} / {batchProgress?.total ?? 0}{:else if batchFetching}Hämtar…{:else}Hämta alla Metron{/if}
					</button>
					<button
						type="button"
						class="btn small"
						aria-label={desc ? 'Sorterat fallande – byt till stigande' : 'Sorterat stigande – byt till fallande'}
						onclick={() => (desc = !desc)}
					>
						<span class="flip" class:on={desc}><Icon name="sort" size={18} /></span>{desc ? 'Fallande' : 'Stigande'}
					</button>
					<div class="seg" role="group" aria-label="Visa nummer som">
						<button type="button" class:on={view === 'grid'} aria-pressed={view === 'grid'} aria-label="Rutnät" onclick={() => setView('grid')}>
							<Icon name="grid" size={20} />
						</button>
						<button type="button" class:on={view === 'list'} aria-pressed={view === 'list'} aria-label="Lista" onclick={() => setView('list')}>
							<Icon name="list" size={20} />
						</button>
					</div>
				</div>
			</div>
			{#if batchVisible}
				{@const batchDone = batchProgress?.done ?? 0}
				{@const batchTotal = batchProgress?.total ?? 0}
				{@const current = batchProgress?.currentIssueId ? library.getIssue(batchProgress.currentIssueId) : undefined}
				<div class="batch-status" role="status" aria-live="polite">
					<div class="batch-status-head">
						<strong>{batchForSeries?.active ? `Hämtar Metron ${batchDone} / ${batchTotal}` : 'Senaste Metron-hämtning'}</strong>
						{#if batchForSeries?.active}<button type="button" class="btn btn-ghost small" onclick={cancelBatch}>Avbryt</button>{/if}
					</div>
					{#if batchTotal}<ProgressBar value={batchDone / batchTotal} height={5} />{/if}
					{#if current}<p class="batch-current">{current.fileName}</p>{/if}
					<div class="batch-stats">
						<span class="ok">{batchProgress?.matched ?? 0} matchade</span>
						<span>{batchProgress?.skipped ?? 0} redan matchade</span>
						<span>{batchProgress?.ambiguous ?? 0} tvetydiga</span>
						<span>{batchProgress?.notFound ?? 0} utan träff</span>
						<span class="bad">{batchProgress?.failed ?? 0} misslyckade</span>
						{#if batchProgress?.rateLimited}<span>{batchProgress.rateLimited} väntade på Metron</span>{/if}
					</div>
					{#if batchReviewItems.length}
						<details class="batch-review">
							<summary>Visa {batchReviewItems.length} nummer att granska</summary>
							<ul>
								{#each batchReviewItems as item (item.issueId)}
									{@const reviewIssue = library.getIssue(item.issueId)}
									{#if reviewIssue}<li><span>{issueName(reviewIssue)}</span><span class:item-bad={item.status === 'failed'}>{batchStatus(item)}</span></li>{/if}
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			{/if}

			{#if view === 'grid'}
				<div class="grid-cards issues">
					{#each issues as issue (issue.id)}
						{@const st = status(issue)}
						<div class="gi" class:off={!!issue.unsupported}>
							<div class="gcard" inert={!!issue.unsupported}><IssueCard {issue} {series} /></div>
							{#if issue.characters?.length}<p class="issue-characters"><b>Karaktärer</b> {#each issue.characters as character, i}<a href={characterHref(character)}>{character}</a>{#if i < issue.characters.length - 1}, {/if}{/each}</p>{/if}
							{#if issue.metron?.characters.length}<p class="issue-characters metron-data"><b>Metron-karaktärer</b> {#each issue.metron.characters as character, i}<a href={characterHref(character)}>{character}</a>{#if i < issue.metron.characters.length - 1}, {/if}{/each}</p>{/if}
							{#if issue.metron?.creators.length}<p class="issue-characters metron-data"><b>Metron-skapare</b> {#each issue.metron.creators as creator, i}<a href={creatorHref(creator)}>{creator}</a>{#if i < issue.metron.creators.length - 1}, {/if}{/each}</p>{/if}
							{#if issue.metron}<p class="metron-match"><Icon name="check" size={13} /> Metron-match · id {issue.metron.id}{#if safeUrl(issue.metron.sourceUrl)} · <a href={safeUrl(issue.metron.sourceUrl)} target="_blank" rel="noopener noreferrer">Källa</a>{/if}</p>{/if}
							<button
								type="button"
								class="qa"
								class:on={st.done}
								aria-pressed={st.done}
								aria-label={`${issueName(issue)} – läst`}
								title={st.done ? 'Markera som oläst' : 'Markera som läst'}
								onclick={() => toggleRead(issue)}
							>
								<span><Icon name="check" size={16} /></span>
							</button>
							<button type="button" class="btn btn-ghost metron-action" aria-label={`Sök Metron-match för ${issueName(issue)}`} onclick={() => openMetron(issue)}><Icon name="search" size={15} /> {issue.metron ? 'Ändra Metron-match' : 'Hämta Metron-data'}</button>
							{#if issue.unsupported}
								<p class="why"><Icon name="cloud-off" size={14} />{issueNum(issue) ? `${issueNum(issue)} · ` : ''}{unsupportedText(issue)}</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<ul class="list">
					{#each issues as issue (issue.id)}
						{@const st = status(issue)}
						<li class="row" class:off={!!issue.unsupported}>
							{#if issue.unsupported}
								<div class="rowmain">{@render rowBody(issue, st, false)}</div>
							{:else}
								<a class="rowmain" href={`/read/${encodeURIComponent(issue.id)}`}>{@render rowBody(issue, st)}</a>
							{/if}
							<button
								type="button"
								class="btn btn-ghost rq"
								aria-label={`${issueName(issue)}: ${st.done ? 'markera som oläst' : 'markera som läst'}`}
								onclick={() => toggleRead(issue)}
							>
								<Icon name="check" size={18} /><span class="lbl">{st.done ? 'Markera oläst' : 'Markera läst'}</span>
							</button>
							<button type="button" class="btn btn-ghost rq" aria-label={`Sök Metron-match för ${issueName(issue)}`} onclick={() => openMetron(issue)}><Icon name="search" size={18} /><span class="lbl">Metron</span></button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if similar.length}
			<div class="similar">
				<Shelf title="Liknande serier">
					{#each similar as s (s.series.id)}
						<div class="cell"><SeriesCard series={s.series} note={s.why} /></div>
					{/each}
				</Shelf>
			</div>
		{/if}
	</div>

	<MetaPicker open={pickerOpen} {series} onclose={() => (pickerOpen = false)} />
	{#if metronIssue}<MetronIssuePicker open={true} issue={metronIssue} onclose={() => (metronIssue = undefined)} />{/if}
	<EditSeriesSheet open={editOpen} {series} onclose={() => (editOpen = false)} />
	<Sheet open={confirmRemove} title="Ta bort serien?" onclose={() => (confirmRemove = false)}>
		<p class="confirm-text">
			’{series.name}’ och dess {series.issueCount} nummer tas bort från biblioteket, även sparade kopior i appen. Läshistorik och betyg
			försvinner också. Dina originalfiler på enheten påverkas inte.
		</p>
		{#snippet footer()}
			<button type="button" class="btn" onclick={() => (confirmRemove = false)}>Avbryt</button>
			<button type="button" class="btn danger" onclick={remove}><Icon name="trash" size={18} />Ta bort</button>
		{/snippet}
	</Sheet>
{/if}

<style>
	/* ───────── page + blurred backdrop ───────── */
	.series-page {
		position: relative;
		isolation: isolate;
	}
	.backdrop {
		position: absolute;
		z-index: -1;
		inset: calc(var(--topbar-h) * -1) 0 auto 0; /* tucked under the translucent top bar */
		height: calc(60vh + var(--topbar-h));
		overflow: hidden;
		pointer-events: none;
		background: radial-gradient(75% 90% at 18% 0%, color-mix(in srgb, var(--tint) 50%, transparent), transparent 72%);
		-webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent 100%);
		mask-image: linear-gradient(to bottom, #000 30%, transparent 100%);
	}
	.backdrop img {
		position: absolute;
		inset: -12%;
		width: 124%;
		height: 124%;
		object-fit: cover;
		filter: blur(48px) saturate(1.5);
		opacity: 0.5;
	}
	@media (min-width: 1900px) {
		/* very wide screens: also fade the sides so the page box edge is not visible */
		.backdrop {
			-webkit-mask-image:
				linear-gradient(to bottom, #000 30%, transparent 100%), linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
			-webkit-mask-composite: source-in;
			mask-image:
				linear-gradient(to bottom, #000 30%, transparent 100%), linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
			mask-composite: intersect;
		}
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		margin: -6px 0 6px -10px;
		padding: 0 14px 0 10px;
		border-radius: 999px;
		color: var(--text-dim);
		font-weight: 600;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.back:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--surface) 70%, transparent);
	}

	/* ───────── top section ───────── */
	.top {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: clamp(20px, 4vw, 48px);
		align-items: start;
		padding: 6px 0 10px;
	}
	/* no animation on .top/.actions: it would trap the popover menu in a lower stacking context */
	.title,
	.facts {
		animation: fade 0.35s var(--ease) both;
	}
	.cover {
		width: clamp(150px, 22vw, 260px);
		border-radius: var(--radius);
		overflow: hidden;
		box-shadow:
			0 28px 60px rgba(0, 0, 0, 0.6),
			0 4px 14px rgba(0, 0, 0, 0.4);
		animation: rise 0.5s var(--ease) both;
	}
	.info {
		display: grid;
		gap: 14px;
		align-content: start;
		min-width: 0;
	}
	.title {
		font-size: clamp(1.8rem, 3.4vw, 3rem);
		text-wrap: balance;
		overflow-wrap: anywhere;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		color: var(--text-dim);
	}
	.chip.pub {
		min-height: 44px;
		padding-inline: 16px;
		color: var(--accent-2);
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
	}
	.chip.pub:hover {
		color: var(--text);
	}
	.state {
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.82rem;
		font-weight: 700;
	}
	.state[data-s='reading'] {
		color: var(--accent-2);
		border-color: color-mix(in srgb, var(--accent) 50%, transparent);
	}
	.state[data-s='done'] {
		color: var(--ok);
		border-color: color-mix(in srgb, var(--ok) 45%, transparent);
	}

	/* ───────── actions ───────── */
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-top: 4px;
	}
	.cta {
		min-height: 52px;
		padding-inline: 28px;
		font-size: 1.05rem;
	}
	.btn-icon {
		width: 52px;
		min-height: 52px;
		background: color-mix(in srgb, var(--surface-2) 85%, transparent);
	}
	.btn-icon.fav {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 45%, transparent);
	}
	.btn-icon.on {
		color: var(--ok);
		border-color: color-mix(in srgb, var(--ok) 45%, transparent);
	}
	.small {
		padding-inline: 14px;
		font-size: 0.92rem;
	}
	.hint {
		margin-top: -4px;
		color: var(--text-dim);
		font-size: 0.9rem;
	}
	.more {
		position: relative;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 19;
		background: transparent;
		cursor: default;
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 8px);
		right: 0;
		min-width: 280px;
		padding: 6px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface-2);
		box-shadow: var(--shadow-pop);
		animation: pop 0.16s var(--ease) both;
	}
	.mi {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 48px;
		padding: 0 14px;
		border-radius: 10px;
		text-align: left;
		font-weight: 600;
		transition: background 0.12s;
	}
	.mi:hover {
		background: var(--surface-3);
	}
	.mi[disabled] {
		opacity: 0.5;
		pointer-events: none;
	}
	.mi.danger {
		color: var(--danger);
	}
	.sep {
		height: 1px;
		margin: 6px 8px;
		background: var(--border);
	}

	/* ───────── rating + progress ───────── */
	.meter {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px 44px;
	}
	.rate,
	.prog {
		display: grid;
		gap: 6px;
	}
	.prog {
		flex: 1 1 240px;
		max-width: 420px;
	}
	.k {
		color: var(--text-dim);
		font-size: 0.88rem;
	}
	.k b {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	/* ───────── description, chips, source ───────── */
	.about {
		display: grid;
		gap: 16px;
		margin-top: 6px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}
	.desc p {
		max-width: 72ch;
		color: var(--text-dim);
		line-height: 1.6;
	}
	.desc p.clamped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
	}
	.link {
		min-height: 44px;
		padding: 0 4px;
		color: var(--accent-2);
		font-weight: 650;
	}
	.link:hover {
		text-decoration: underline;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chips .chip {
		min-height: 44px;
		padding-inline: 16px;
	}
	.creators {
		color: var(--text-dim);
		font-size: 0.95rem;
	}
	.creators b {
		margin-right: 10px;
		color: var(--text-faint);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.creator {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
	}
	.creator:hover {
		color: var(--accent-2);
	}
	.source {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		color: var(--text-dim);
		font-size: 0.9rem;
	}
	.source a {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
	}
	.spin {
		display: inline-flex;
	}
	.spin.on {
		animation: spin 0.9s linear infinite;
	}

	/* ───────── issue list ───────── */
	.issues-sec {
		margin-top: 38px;
	}
	.issues-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 18px;
	}
	.count {
		margin-left: 8px;
		color: var(--text-faint);
		font-size: 0.9em;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.flip {
		display: inline-flex;
		transition: transform 0.2s var(--ease);
	}
	.flip.on {
		transform: scaleY(-1);
	}
	.seg {
		display: inline-flex;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
	}
	.seg button {
		display: grid;
		place-items: center;
		width: 50px;
		height: 44px;
		color: var(--text-dim);
		transition:
			background 0.15s,
			color 0.15s;
	}
	.seg button:focus-visible {
		outline-offset: -4px;
	}
	.seg button.on {
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		color: var(--accent-ink);
	}

	/* grid mode */
	.issues {
		--card-min: 140px;
		gap: 26px 16px;
	}
	.gi {
		position: relative;
		min-width: 0;
	}
	.qa {
		position: absolute;
		z-index: 2;
		top: 0;
		left: 0;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
	}
	.qa span {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 50%;
		background: rgba(10, 12, 18, 0.8);
		color: var(--text-dim);
		transition:
			background 0.15s,
			color 0.15s,
			transform 0.12s var(--ease);
	}
	.qa:active span {
		transform: scale(0.9);
	}
	.qa.on span {
		border-color: transparent;
		background: var(--ok);
		color: #05210f;
	}
	.gi.off .gcard {
		opacity: 0.45;
		filter: grayscale(0.7);
	}
	.metron-action { margin-top: 6px; min-height: 40px; font-size: 0.8rem; }
	.batch-status { display:grid; gap:10px; margin:0 0 20px; padding:14px 16px; border:1px solid var(--border); border-radius:var(--radius-s); background:color-mix(in srgb,var(--surface-2) 86%,transparent); }
	.batch-status-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
	.batch-status-head .btn { min-height:36px; }
	.batch-current { margin:0; overflow:hidden; color:var(--text-dim); font-size:.82rem; text-overflow:ellipsis; white-space:nowrap; }
	.batch-stats { display:flex; flex-wrap:wrap; gap:6px 12px; color:var(--text-dim); font-size:.8rem; }
	.batch-stats .ok { color:var(--ok); }
	.batch-stats .bad, .item-bad { color:var(--danger); }
	.batch-review { border-top:1px solid var(--border); padding-top:8px; color:var(--text-dim); font-size:.84rem; }
	.batch-review summary { cursor:pointer; color:var(--text); font-weight:650; }
	.batch-review ul { display:grid; gap:5px; margin:8px 0 0; padding:0; list-style:none; }
	.batch-review li { display:flex; justify-content:space-between; gap:12px; }
	.issue-characters {
		margin: 8px 0 0;
		color: var(--text-dim);
		font-size: 0.8rem;
		line-height: 1.35;
	}
	.issue-characters b {
		color: var(--text-faint);
		font-weight: 700;
	}
	.issue-characters a {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 2px;
	}
	.issue-characters a:hover {
		color: var(--accent-2);
	}
	.why {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin-top: 6px;
		color: var(--warn);
		font-size: 0.8rem;
		line-height: 1.35;
	}

	/* list mode */
	.list {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		content-visibility: auto;
		contain-intrinsic-size: auto 84px;
		transition: background 0.15s;
	}
	.row:hover {
		background: var(--surface-2);
	}
	.rowmain {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: 1;
		min-width: 0;
		min-height: 68px;
		border-radius: var(--radius-s);
	}
	.thumb {
		flex: none;
		width: 46px;
		overflow: hidden;
		border-radius: 6px;
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
	}
	.rt {
		display: grid;
		flex: 1;
		gap: 5px;
		min-width: 0;
	}
	.rname {
		font-weight: 700;
	}
	.rsub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 14px;
		color: var(--text-dim);
		font-size: 0.84rem;
	}
	.st.done {
		color: var(--ok);
		font-weight: 650;
	}
	.warn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--warn);
	}
	.row.off .thumb,
	.row.off .rname {
		opacity: 0.5;
	}
	.rq {
		flex: none;
		color: var(--text-dim);
	}
	@media (max-width: 560px) {
		.rq {
			width: 44px;
			padding: 0;
		}
		.rq .lbl {
			display: none;
		}
	}

	/* ───────── similar series ───────── */
	.similar {
		margin-top: 40px;
	}
	.cell {
		width: var(--shelf-card-w, calc(var(--card-min, 170px) * 0.92));
	}

	/* ───────── confirm sheet ───────── */
	.confirm-text {
		color: var(--text-dim);
		line-height: 1.55;
	}
	.btn.danger {
		border-color: transparent;
		background: var(--danger);
		color: #1c070b;
	}
	.btn.danger:hover {
		background: var(--danger);
		filter: brightness(1.08);
	}

	/* ───────── skeleton ───────── */
	.sk-cover {
		width: clamp(150px, 22vw, 260px);
		aspect-ratio: 2 / 3;
	}
	.sk-info {
		display: grid;
		gap: 14px;
		align-content: start;
	}
	.sk-line {
		height: 14px;
		border-radius: 7px;
	}
	.sk-title {
		width: 62%;
		height: 38px;
		border-radius: 10px;
	}
	.sk-btn {
		width: 220px;
		max-width: 100%;
		height: 52px;
		border-radius: 999px;
	}
	.w50 {
		width: 50%;
	}
	.w70 {
		width: 70%;
	}

	/* ───────── narrow screens ───────── */
	@media (max-width: 640px) {
		.top {
			grid-template-columns: minmax(0, 1fr);
			justify-items: center;
		}
		.info {
			justify-self: stretch;
		}
		.title {
			font-size: 1.7rem;
		}
		.cta {
			flex: 1 1 100%;
		}
		.scrim {
			background: rgba(0, 0, 0, 0.4);
		}
		.menu {
			position: fixed;
			top: auto;
			right: var(--gutter);
			bottom: calc(var(--nav-h) + var(--safe-b) + 14px);
			left: var(--gutter);
			min-width: 0;
		}
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.98);
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
