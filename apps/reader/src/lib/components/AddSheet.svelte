<script lang="ts">
	/**
	 * "Lägg till serier" flow inside a Sheet. Rendered once by the root layout, opened via `ui.addOpen`.
	 * Content: big buttons "Välj mapp" (library.pick('folder')) and "Välj filer" (library.pick('files')) — each handler must
	 * call library.pick DIRECTLY (user-gesture requirement; do not await anything before it) and close the sheet after;
	 * checkbox bound to settings.persistFiles ("Spara kopior i appen – läs offline utan att välja om"; disabled with an
	 * explanation when !library.storage.opfs); small Android hint ("Fungerar inte mappval? Välj flera filer i stället.");
	 * link-button "Prova med demodata" → library.addDemo(). After a pick resolves, show toast "N nya nummer tillagda"
	 * (or errors: `failed.length` → "N filer kunde inte läsas") via `toast`.
	 */
	let { open, onclose }: { open: boolean; onclose: () => void } = $props();
	import { library } from '$lib/library.svelte';
	import { toast } from '$lib/toast.svelte';
	import { ui } from '$lib/ui.svelte';
	import { saveObjectUrl } from '$lib/export';
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	let busy = $state(false);
	let quality = $state(40);
	let maxWidth = $state(1400);
	const conversion = $derived(library.convert);
	async function pick(kind: 'folder'|'files') {
		const result = library.pick(kind);
		onclose();
		busy = true;
		try { const r = await result; if (r) { if (r.added) toast.show(`${r.added} nya nummer tillagda`, { kind:'ok' }); if (r.failed.length) toast.show(`${r.failed.length} filer kunde inte läsas`, { kind:'error' }); } } catch (e) { toast.show(e instanceof Error ? e.message : 'Kunde inte läsa filerna', { kind:'error' }); } finally { busy = false; }
	}
	async function demo() { onclose(); try { const r = await library.addDemo(); toast.show(`${r.added} nya nummer tillagda`, {kind:'ok'}); } catch { toast.show('Demodata kunde inte skapas', {kind:'error'}); } }
	async function convertRecent() {
		if (!library.lastImportedIds.length || conversion.active) return;
		busy = true;
		try {
			const result = await library.convertIssues(library.lastImportedIds, { quality, maxWidth });
			if (result.cancelled) toast.show('Konverteringen avbröts', { kind: 'info' });
			else if (result.failed.length) toast.show(`${result.failed.length} filer kunde inte konverteras`, { kind: 'error' });
			else toast.show(`${result.completed} AVIF-CBZ-filer är klara att hämta`, { kind: 'ok' });
		} catch { toast.show('Konverteringen misslyckades', { kind: 'error' }); }
		finally { busy = false; }
	}
	async function downloadConverted(output: (typeof conversion.downloads)[number]) {
		try {
			await saveObjectUrl(output.url, { fileName: output.fileName, mimeType: 'application/zip' });
		} catch (e) {
			toast.show(e instanceof Error ? e.message : 'CBZ-filen kunde inte sparas.', { kind: 'error' });
		}
	}
</script>

<Sheet {open} title="Lägg till serier" {onclose}>
	<div class="add-options"><button class="btn btn-primary" type="button" onclick={() => pick('folder')} disabled={busy}><Icon name="folder" size={21} /> Välj mapp</button><button class="btn" type="button" onclick={() => pick('files')} disabled={busy}><Icon name="file" size={21} /> Välj filer</button></div>
	<label class="persist"><input type="checkbox" checked={library.settings.persistFiles} disabled={!library.storage.opfs} onchange={(e) => library.updateSettings({ persistFiles: e.currentTarget.checked })} /><span><strong>Spara kopior i appen</strong><small>Läs offline utan att välja om</small></span></label>
	{#if !library.storage.opfs}<p class="muted hint">Offline-lagring kräver säker anslutning (https). Du får välja mappen igen efter omstart.</p>{/if}
	<p class="muted hint">Fungerar inte mappval? Välj flera filer i stället.</p>
	{#if library.lastImportedIds.length}
		<div class="convert-box">
			<strong>AVIF-kopior av senaste importen</strong>
			<p class="muted hint">Originalen och biblioteket ändras inte. Varje ny CBZ blir en separat klickbar hämtning. Konverteringen är lossy; ComicInfo.xml bevaras, men annan arkivmetadata kan saknas.</p>
			<div class="convert-fields">
				<label>Kvalitet <input type="number" min="1" max="100" step="1" bind:value={quality} /></label>
				<label>Maxbredd <input type="number" min="0" max="10000" step="100" bind:value={maxWidth} /><small>0 = originalbredd</small></label>
			</div>
			<button class="btn" type="button" disabled={busy || conversion.active} onclick={convertRecent}><Icon name="download" size={18} />Konvertera {library.lastImportedIds.length} valda filer</button>
			{#if conversion.active}
				<div class="convert-progress" role="status" aria-live="polite">
					<span>{conversion.done} av {conversion.total}: {conversion.current}</span>
					{#if conversion.pageTotal}<small>Sida {conversion.pageDone} av {conversion.pageTotal}</small>{/if}
					<button class="btn btn-ghost" type="button" onclick={() => library.cancelConvert()}>Avbryt</button>
				</div>
			{:else if conversion.cancelled || conversion.failed.length}
				<div class="convert-progress" role="status" aria-live="polite">
					<span>{conversion.cancelled ? `Avbröts efter ${conversion.completed} nedladdningar.` : `${conversion.failed.length} filer kunde inte konverteras.`}</span>
					{#each conversion.failed as failure (failure.id)}<small>{failure.name}: {failure.error}</small>{/each}
				</div>
			{/if}
			{#if conversion.downloads.length}
				<div class="convert-downloads" aria-label="Konverterade filer">
					<strong>Färdiga filer</strong>
					<p class="muted hint">Webbläsaren sparar till vald hämtningsmapp eller visar en fråga. Om inget händer, kontrollera webbläsarens nedladdningsbehörighet. Resultaten ligger kvar här tills nästa konvertering.</p>
					{#each conversion.downloads as output (output.id)}<button type="button" class="btn" onclick={() => downloadConverted(output)} aria-label={`Hämta ${output.fileName}`}>Hämta {output.fileName}</button>{/each}
				</div>
			{/if}
		</div>
	{/if}
	<button class="demo" type="button" onclick={demo}><Icon name="sparkles" size={18} /> Prova med demodata</button>
</Sheet>

<style>
	.add-options { display:grid; grid-template-columns:1fr 1fr; gap:10px; }.add-options .btn { min-height:58px; }.persist { display:flex; gap:12px; align-items:flex-start; margin:24px 0 8px; padding:14px; border-radius:var(--radius); background:var(--surface); }.persist input { width:20px; height:20px; accent-color:var(--accent); }.persist span { display:grid; gap:2px; }.persist small { color:var(--text-dim); }.hint { font-size:.88rem; margin-top:10px; }.demo { display:inline-flex; align-items:center; gap:8px; min-height:44px; margin-top:14px; color:var(--accent-2); font-weight:650; }
	.convert-box { display:grid; gap:10px; margin-top:18px; padding:14px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); }.convert-box p { margin:0; }.convert-fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }.convert-fields label { display:grid; gap:4px; font-size:.86rem; color:var(--text-dim); }.convert-fields input { width:100%; min-height:40px; padding:0 10px; border:1px solid var(--border-strong); border-radius:var(--radius-s); background:var(--bg-raised); color:var(--text); }.convert-fields small { font-size:.76rem; }.convert-progress { display:grid; gap:6px; font-size:.86rem; }.convert-progress span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.convert-progress small { color:var(--text-dim); }.convert-downloads { display:grid; gap:6px; }.convert-downloads button { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
