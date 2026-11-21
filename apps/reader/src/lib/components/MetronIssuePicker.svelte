<script lang="ts">
	import type { Issue, MetronIssue } from '$lib/types';
	import { searchMetronPage } from '$lib/metadata/metron';
	import type { MetronIssueCandidate } from '$lib/metadata/metron';
	import { library } from '$lib/library.svelte';
	import { toast } from '$lib/toast.svelte';
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';

	let { open, issue, onclose, onselected }: { open: boolean; issue: Issue; onclose: () => void; onselected?: (match: MetronIssue) => void } = $props();
	let query = $state('');
	let numberQuery = $state('');
	let rows = $state<MetronIssueCandidate[]>([]);
	let page = $state(1);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let selected = $state<MetronIssueCandidate>();
	let detail = $state<MetronIssue>();
	let phase = $state<'idle' | 'searching' | 'loading' | 'done' | 'error'>('idle');
	let message = $state('');
	let controller: AbortController | undefined;
	let moreController: AbortController | undefined;
	let run = 0;

	$effect(() => {
		if (!open) return;
		query = issue.seriesName;
		numberQuery = issue.number != null ? String(issue.number) : issue.numberLabel ?? '';
		rows = [];
		page = 1;
		hasMore = false;
		loadingMore = false;
		selected = undefined;
		detail = undefined;
		void search();
		return () => { run++; controller?.abort(); moreController?.abort(); };
	});
	async function search() {
		const q = query.trim();
		if (!q) return;
		controller?.abort();
		moreController?.abort();
		loadingMore = false;
		const mine = (controller = new AbortController());
		const token = ++run;
		phase = 'searching'; message = '';
		try {
			const result = await library.searchMetron({ name: q, number: numberQuery.trim() || undefined, volume: issue.volume, year: issue.year ?? issue.volumeYear }, mine.signal);
			if (token !== run) return;
			rows = result;
			page = 1;
			hasMore = !!result.hasMore;
			phase = 'done';
			if (!rows.length) message = hasMore ? 'Ingen träff på denna sida. Visa fler för att fortsätta.' : 'Ingen Metron-träff för serien och numret.';
		}
		catch (e) { if (token !== run) return; phase = 'error'; message = e instanceof Error ? e.message : 'Metron-sökningen misslyckades.'; }
	}
	async function loadMore() {
		if (!hasMore || loadingMore) return;
		const q = query.trim();
		if (!q) return;
		moreController?.abort();
		const mine = (moreController = new AbortController());
		loadingMore = true;
		try {
			const result = await searchMetronPage({ name: q, number: numberQuery.trim() || undefined, volume: issue.volume, year: issue.year ?? issue.volumeYear }, page + 1, mine.signal);
			if (mine.signal.aborted) return;
			const seen = new Set(rows.map((row) => row.id));
			rows = [...rows, ...result.filter((row) => !seen.has(row.id))];
			page++;
			hasMore = !!result.hasMore;
		} catch (e) {
			if (!mine.signal.aborted) message = e instanceof Error ? e.message : 'Fler Metron-träffar kunde inte hämtas.';
		} finally {
			if (!mine.signal.aborted) loadingMore = false;
		}
	}
	async function preview(candidate: MetronIssueCandidate) {
		selected = candidate;
		detail = undefined;
		phase = 'loading'; message = '';
		try { detail = await library.metronDetail(candidate.id, controller?.signal, candidate); phase = 'done'; }
		catch (e) { phase = 'error'; message = e instanceof Error ? e.message : 'Kunde inte läsa Metron-numret.'; }
	}
	async function apply() {
		if (!detail) return;
		const match = await library.applyMetronMatch(issue.id, detail);
		if (!match) { message = 'Metron-träffen saknar ett giltigt id.'; return; }
		onselected?.(match);
		toast.show(`Metron-match sparad för ${issue.fileName}`, { kind: 'ok' });
		onclose();
	}
	const years = (candidate: MetronIssueCandidate) => candidate.year ? String(candidate.year) : '';
</script>

<Sheet {open} title={`Metron · ${issue.fileName}`} {onclose}>
	<form class="search" onsubmit={(event) => { event.preventDefault(); void search(); }}>
		<div class="labels"><label for="metron-query">Sök serie</label><label for="metron-number">Nummer</label></div><div class="search-row"><input id="metron-query" bind:value={query} maxlength="120" /><input id="metron-number" class="number-input" bind:value={numberQuery} maxlength="24" placeholder="alla" /><button class="btn btn-primary" type="submit" disabled={phase === 'searching'}><Icon name="search" size={17} /> Sök</button></div>
	</form>
	{#if phase === 'searching'}<p class="muted status">Söker i Metron…</p>{:else if phase === 'error'}<p class="error" role="alert">{message}</p>{:else if !rows.length}<p class="muted status">{message || (hasMore ? 'Ingen träff på denna sida. Visa fler för att fortsätta.' : 'Sök efter rätt nummer i Metron.')}</p>{:else}<div class="results" aria-label="Metron-träffar">{#each rows as row (row.id)}<button class:selected={selected?.id === row.id} class="result" type="button" onclick={() => void preview(row)}><span class="result-main"><strong>{row.seriesName ?? 'Okänd serie'} #{row.number ?? '—'}</strong><span class="muted">{#if row.volume}Volym {row.volume} · {/if}{years(row)}{#if row.title} · {row.title}{/if}</span></span><Icon name="chevron-right" size={18} /></button>{/each}</div>{/if}
	{#if hasMore}<div class="more"><p class="muted">Fler träffar finns på nästa sida.</p><button class="btn btn-ghost" type="button" onclick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Hämtar…' : 'Visa fler'}</button></div>{/if}
		{#if selected && detail}<section class="detail"><h3>{detail.seriesName ?? 'Okänd serie'} #{detail.number ?? '—'}</h3><p class="muted">{#if detail.volume}Volym {detail.volume} · {/if}{#if detail.year}{detail.year}{/if}{#if detail.title} · {detail.title}{/if}</p>{#if detail.characters.length}<p><b>Karaktärer</b> {detail.characters.join(', ')}</p>{/if}{#if detail.creators.length}<p><b>Skapare</b> {detail.creators.join(', ')}</p>{/if}<p class="source"><Icon name="external" size={14} /> <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">Källa: Metron · id {detail.id}</a></p><button class="btn btn-primary" type="button" onclick={() => void apply()}>Välj denna match</button></section>{:else if selected && phase === 'loading'}<p class="muted status">Hämtar detaljer från Metron…</p>{/if}
</Sheet>

<style>
	.search{display:grid;gap:7px}.labels{display:grid;grid-template-columns:minmax(0,1fr) 110px 76px;gap:8px}.search label{font-weight:650}.search-row{display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:8px}.search-row input{min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-s);background:var(--surface);outline:0}.status,.error{margin:18px 0}.error{color:var(--danger)}.results{display:grid;gap:6px;max-height:42dvh;overflow:auto;margin-top:18px}.more{display:grid;justify-items:center;gap:6px;margin:12px 0}.more p{margin:0}.result{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:12px;border:1px solid var(--border);border-radius:var(--radius-s);background:var(--surface);text-align:left}.result:hover,.result.selected{border-color:var(--accent);background:var(--surface-2)}.result-main{display:grid;gap:4px;min-width:0}.result-main strong,.result-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.result-main span{font-size:.85rem}.detail{display:grid;gap:9px;margin-top:16px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:var(--radius);background:color-mix(in srgb,var(--accent) 8%,var(--surface))}.detail h3{font-size:1.05rem}.detail p{font-size:.9rem}.source{display:flex;align-items:center;gap:5px;color:var(--text-dim);font-size:.8rem!important}.source a{color:inherit}@media(max-width:520px){.labels{grid-template-columns:minmax(0,1fr) 76px 62px}.search-row{grid-template-columns:minmax(0,1fr) 76px auto}.search-row .number-input{width:76px}.more{margin-inline:4px}}
</style>
