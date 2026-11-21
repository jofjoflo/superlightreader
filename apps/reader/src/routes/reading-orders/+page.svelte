<script lang="ts">
	import { onMount } from 'svelte';
	import { library } from '$lib/library.svelte';
	import { readingOrders } from '$lib/reading-orders.svelte';
	import { matchReadingOrder } from '$lib/reading-order';
	import type { ReadingOrder, ReadingOrderMatch } from '$lib/reading-order';
	import Icon from '$lib/components/Icon.svelte';

	let fileInput = $state<HTMLInputElement>();
	let importError = $state('');
	let selected = $state<string | null>(null);

	onMount(() => readingOrders.init());
	const matches = $derived.by(() => new Map(readingOrders.items.map((order) => [order.id, matchReadingOrder(order, library.series, library.progress)])));
	const current = $derived(selected ? readingOrders.items.find((x) => x.id === selected) : readingOrders.items[0]);
	const currentMatch = $derived(current ? matches.get(current.id) : undefined);

	function chooseFile() {
		fileInput?.click();
	}
	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		importError = '';
		try {
			if (file.size > 2_500_000) {
				importError = 'JSON-filen är för stor (högst 2,5 MB).';
				return;
			}
			const result = readingOrders.importJson(await file.text());
			if (!result.order) importError = result.errors.join(' ');
			else if (!result.saved) importError = 'Läsordningen visas tillfälligt men kunde inte sparas lokalt. Frigör lagringsutrymme och importera igen.';
			else selected = result.order.id;
		} catch {
			importError = 'Det gick inte att läsa filen.';
		}
	}
	function statusText(match: ReadingOrderMatch) {
		const matched = match.items.filter((x) => x.status === 'matched').length;
		const ambiguous = match.items.filter((x) => x.status === 'ambiguous').length;
		return `${matched}/${match.items.length} matchade${ambiguous ? ` · ${ambiguous} tvetydiga` : ''}`;
	}
	function progressLabel(issueId: string) {
		const p = library.progressOf(issueId);
		if (!p) return 'Oläst';
		if (p.completed) return 'Läst';
		return p.pageCount ? `Pågående · sida ${p.page + 1} av ${p.pageCount}` : 'Pågående';
	}
	function remove(order: ReadingOrder) {
		if (!confirm(`Ta bort läsordningen ”${order.title}”?`)) return;
		if (!readingOrders.remove(order.id)) {
			importError = 'Läsordningen kunde inte tas bort eftersom lokal lagring misslyckades.';
			return;
		}
		if (selected === order.id) selected = readingOrders.items[0]?.id ?? null;
	}
	function toggleRead(issueId: string) {
		library.markIssues([issueId], !library.progressOf(issueId)?.completed);
	}
</script>

<svelte:head><title>Läsordningar – SuperLight Reader</title></svelte:head>

<div class="page">
	<div class="heading"><div><p class="eyebrow">Import</p><h1 class="h1">Läsordningar</h1><p class="muted intro">Kuraterade ordningar sparas lokalt på den här enheten. Saknade nummer markeras i stället för att gissas.</p></div><button class="btn btn-primary" type="button" onclick={chooseFile}><Icon name="upload" size={18} /> Importera JSON</button></div>
	<input bind:this={fileInput} class="sr-only" type="file" accept="application/json,.json" onchange={importFile} />
	{#if importError}<p class="error" role="alert">{importError}</p>{/if}

	{#if !readingOrders.ready}
		<div class="empty" role="status">Laddar läsordningar…</div>
	{:else if !readingOrders.items.length}
		<div class="empty"><span class="empty-icon"><Icon name="list" size={32} /></span><h2 class="h2">Inga läsordningar ännu</h2><p class="muted">Importera en JSON-fil med title och items för att börja.</p><button class="btn btn-primary" type="button" onclick={chooseFile}>Välj JSON-fil</button></div>
	{:else}
		<div class="layout">
			<aside class="orders" aria-label="Sparade läsordningar">
				{#each readingOrders.items as order (order.id)}
					{@const match = matches.get(order.id)}
					<button class:chosen={current?.id === order.id} class="order" type="button" onclick={() => (selected = order.id)}><strong>{order.title}</strong><span>{match ? statusText(match) : ''}</span></button>
				{/each}
			</aside>
			{#if current && currentMatch}
				<section class="detail" aria-labelledby="order-title">
					<div class="detail-head"><div><h2 id="order-title" class="h2">{current.title}</h2>{#if current.description}<p class="muted desc">{current.description}</p>{/if}{#if current.characters?.length}<p class="faint">Karaktärer: {current.characters.join(', ')}</p>{/if}{#if current.sourceUrl}<a class="source" href={current.sourceUrl} target="_blank" rel="noreferrer">Källa <Icon name="external" size={14} /></a>{/if}</div><button class="btn btn-ghost" type="button" onclick={() => remove(current)}><Icon name="trash" size={17} /> Ta bort</button></div>
					<p class="summary">{statusText(currentMatch)}</p>
					<ol class="items">
						{#each currentMatch.items as row, index (index)}
							<li class:missing={row.status !== 'matched'} class="item">
								<span class="index">{index + 1}</span>
								<div class="item-body"><strong>{row.item.series}{row.item.issue !== undefined ? ` · #${row.item.issue}` : ''}{row.item.story ? ` · ${row.item.story}` : ''}</strong>{#if row.item.volume !== undefined || row.item.year !== undefined || row.item.essential}<span class="muted">{[row.item.volume !== undefined ? `Vol. ${row.item.volume}` : '', row.item.year !== undefined ? String(row.item.year) : '', row.item.essential ? 'Viktig' : ''].filter(Boolean).join(' · ')}</span>{/if}{#if row.item.note}<span class="muted">{row.item.note}</span>{/if}{#if row.status === 'matched' && row.issue && row.series}<span class="state">{progressLabel(row.issue.id)} · {row.series.name}</span>{:else}<span class="warning">{row.reason}</span>{/if}</div>
								{#if row.status === 'matched' && row.issue}<span class="actions"><a class="read" href={`/read/${encodeURIComponent(row.issue.id)}`} aria-label={`Läs ${row.item.series}`}><Icon name="play" size={17} /></a><button class="read" type="button" onclick={() => toggleRead(row.issue!.id)} aria-label={row.progress?.completed ? 'Markera som oläst' : 'Markera som läst'} title={row.progress?.completed ? 'Markera som oläst' : 'Markera som läst'}><Icon name={row.progress?.completed ? 'check' : 'bookmark'} size={17} /></button></span>{:else if row.item.url}<a class="read" href={row.item.url} target="_blank" rel="noreferrer" aria-label="Öppna extern länk"><Icon name="external" size={17} /></a>{/if}
							</li>
						{/each}
					</ol>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.intro{max-width:65ch;margin-top:10px}.eyebrow{color:var(--accent-2);font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.error{margin:12px 0;padding:12px;border:1px solid color-mix(in srgb,var(--danger) 60%,transparent);border-radius:var(--radius-s);color:var(--danger)}.layout{display:grid;grid-template-columns:minmax(180px,280px) minmax(0,1fr);gap:20px;align-items:start}.orders,.detail{border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);overflow:hidden}.order{display:grid;gap:3px;width:100%;padding:15px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-dim)}.order:last-child{border-bottom:0}.order strong{color:var(--text)}.order span{font-size:.82rem}.order:hover,.order.chosen{background:var(--surface-2)}.order.chosen{box-shadow:inset 3px 0 var(--accent)}.detail{padding:clamp(16px,3vw,28px)}.detail-head{display:flex;justify-content:space-between;gap:16px}.desc{margin-top:8px;max-width:70ch}.faint{margin-top:10px}.source{display:inline-flex;align-items:center;gap:5px;margin-top:10px;color:var(--accent-2);font-size:.9rem}.summary{margin:22px 0 10px;color:var(--text-dim);font-size:.9rem}.items{display:grid;gap:8px;margin:0;padding:0;list-style:none}.item{display:grid;grid-template-columns:28px minmax(0,1fr) 72px;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-s);background:var(--surface-2)}.item.missing{border-color:color-mix(in srgb,var(--warn) 45%,transparent)}.index{color:var(--text-faint);font-variant-numeric:tabular-nums;text-align:center}.item-body{display:grid;gap:3px;min-width:0}.item-body strong{overflow:hidden;text-overflow:ellipsis}.item-body span{font-size:.86rem}.state{color:var(--ok)}.warning{color:var(--warn)}.actions{display:flex;gap:4px}.read{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;color:var(--accent-2);background:var(--surface-3)}.read:hover{color:var(--text)}.empty{display:grid;justify-items:center;gap:12px;margin:clamp(40px,10vh,100px) auto;text-align:center}.empty-icon{display:grid;place-items:center;width:72px;height:72px;border-radius:50%;color:var(--text-dim);background:var(--surface)}
	@media(max-width:700px){.heading{display:grid}.heading .btn{width:100%}.layout{grid-template-columns:1fr}.orders{display:flex;overflow-x:auto}.order{min-width:190px;border-right:1px solid var(--border);border-bottom:0}.detail-head{display:grid}.detail-head .btn{justify-self:start}.item{grid-template-columns:24px minmax(0,1fr) 36px}.item-body strong{font-size:.94rem}}
</style>
