<script lang="ts">
	import { onMount } from 'svelte';
	import { library } from '$lib/library.svelte';
	import type { LibraryBackup } from '$lib/backup';
	import { toast } from '$lib/toast.svelte';
	import { ui } from '$lib/ui.svelte';
	import { UNKNOWN_PUBLISHER } from '$lib/types';
	import { saveObjectUrl } from '$lib/export';
	import type { ReaderSettings } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/components/Icon.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import { clearMetronToken, isMetronNative, metronTokenStatus, setMetronToken } from '$lib/metadata/metron';

	type Choice = { value: string | number; label: string };

	const nf = new Intl.NumberFormat('sv-SE');
	const nf1 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 });
	const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${nf1.format(n / 1024 ** 3)} GB` : `${nf1.format(n / 1024 ** 2)} MB`);
	/** '#FFF' / '#FFFFFF' → '#ffffff' so stored colours match the swatches. */
	const canonColor = (c: string) => {
		const s = c.trim().toLowerCase();
		return /^#[0-9a-f]{3}$/.test(s) ? `#${[...s.slice(1)].map((x) => x + x).join('')}` : s;
	};

	const FIT: Choice[] = [
		{ value: 'screen', label: 'Hela sidan' },
		{ value: 'width', label: 'Bredd' },
		{ value: 'height', label: 'Höjd' }
	];
	const SPREAD: Choice[] = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'single', label: 'Enkel' },
		{ value: 'double', label: 'Dubbel' }
	];
	const DIRECTION: Choice[] = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'ltr', label: 'Vänster → höger' },
		{ value: 'rtl', label: 'Höger → vänster' }
	];
	const PRELOAD: Choice[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
	const BACKGROUNDS: Choice[] = [
		{ value: '#000000', label: 'Svart' },
		{ value: '#1a1a1a', label: 'Mörkgrå' },
		{ value: '#f4ecd8', label: 'Sepia' }
	];
	const SOURCE_LINKS = [
		{ name: 'Wikipedia', href: 'https://www.wikipedia.org' },
		{ name: 'Wikidata', href: 'https://www.wikidata.org' },
		{ name: 'AniList', href: 'https://anilist.co' },
		{ name: 'Google Books', href: 'https://books.google.com' },
		{ name: 'Open Library', href: 'https://openlibrary.org' }
	];

	// ───────── derived numbers ─────────
	const cfg = $derived(library.settings);
	const reader = $derived(library.settings.reader);
	const opfs = $derived(library.storage.opfs);
	const stats = $derived({
		series: library.series.length,
		issues: library.issues.length,
		publishers: library.facets.publishers.filter((p) => p.value !== UNKNOWN_PUBLISHER).length
	});
	const linkedCount = $derived(library.issues.reduce((n, i) => n + (library.linked[i.id] ? 1 : 0), 0));
	const unsupportedCount = $derived(library.issues.reduce((n, i) => n + (i.unsupported ? 1 : 0), 0));
	const copies = $derived(library.issues.reduce((n, i) => n + (i.persisted ? 1 : 0), 0));
	/** At least a sliver of the bar is drawn as soon as anything is stored. */
	const usedFrac = $derived(
		library.storage.quota > 0 && library.storage.usage > 0 ? Math.min(1, Math.max(0.02, library.storage.usage / library.storage.quota)) : 0
	);
	const job = $derived(library.metaJob);

	// card size: the label follows the thumb live, the setting is saved when the thumb is released
	let liveSize = $state<number | null>(null);
	const cardSize = $derived(liveSize ?? cfg.cardSize);

	let confirmCopies = $state(false);
	let confirmAll = $state(false);
	let busy = $state(false);
	let cancelled = false;
	let selectedConvert = $state<string[]>([]);
	let backupInput = $state<HTMLInputElement>();
	let backupBusy = $state(false);
	let pendingBackup = $state<{ text: string; fileName: string; data: LibraryBackup }>();
	let importSettings = $state(false);
	const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
	let convertQuality = $state(40);
	let convertWidth = $state(1400);
	const nativeMetron = isMetronNative();
	let metronToken = $state('');
	let metronStatus = $state<'loading' | 'configured' | 'missing' | 'unavailable'>(nativeMetron ? 'loading' : 'unavailable');
	let metronBusy = $state(false);
	let metronMessage = $state('');
	const conversion = $derived(library.convert);
	const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;

	onMount(() => {
		if (nativeMetron) void refreshMetronStatus();
	});
	async function refreshMetronStatus() {
		metronStatus = 'loading';
		metronMessage = '';
		const status = await metronTokenStatus();
		metronStatus = status;
		if (status === 'unavailable') metronMessage = 'Android-integrationen kunde inte laddas. Uppdatera appen och försök igen.';
	}
	async function saveMetronToken() {
		if (metronBusy) return;
		metronBusy = true;
		metronMessage = '';
		try {
			await setMetronToken(metronToken);
			metronToken = '';
			metronStatus = 'configured';
			toast.show('Metron-token sparad säkert på enheten.', { kind: 'ok' });
		} catch (e) {
			metronMessage = e instanceof Error ? e.message : 'Metron-token kunde inte sparas.';
		} finally { metronBusy = false; }
	}
	async function removeMetronToken() {
		if (metronBusy) return;
		metronBusy = true;
		metronMessage = '';
		try {
			await clearMetronToken();
			metronStatus = 'missing';
			metronToken = '';
			toast.show('Metron-token togs bort från enheten.', { kind: 'ok' });
		} catch (e) {
			metronMessage = e instanceof Error ? e.message : 'Metron-token kunde inte tas bort.';
		} finally { metronBusy = false; }
	}

	async function downloadBackupFile() {
		try {
			const started = await library.downloadBackup();
			toast.show(started ? 'Backupfilen är redo för hämtning. Den innehåller inga filer.' : 'Hämtning stöds inte i denna miljö.', { kind: started ? 'ok' : 'error' });
		} catch { toast.show('Backupen kunde inte exporteras.', { kind: 'error' }); }
	}
	async function readBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > MAX_BACKUP_BYTES) { toast.show('Backupfilen är för stor (max 10 MB).', { kind: 'error' }); return; }
		try {
			const parsed = await library.readBackupFile(file);
			if (!parsed.backup) { toast.show(parsed.errors.join(' ') || 'Backupfilen kunde inte valideras.', { kind: 'error' }); return; }
			pendingBackup = { text: await file.text(), fileName: file.name, data: parsed.backup };
		} catch (e) { toast.show(e instanceof Error ? e.message : 'Backupfilen kunde inte valideras.', { kind: 'error' }); }
	}
	async function importPending() {
		if (!pendingBackup || backupBusy) return;
		backupBusy = true;
		try {
			const result = await library.importBackup(pendingBackup.text, { importSettings });
			if (!result.ok) throw new Error(result.errors.join(' ') || 'Backupen kunde inte importeras.');
			toast.show(`${result.added.issues} nya nummer importerade. Befintliga uppgifter behölls.`, { kind: 'ok' });
			if (result.orphaned.length || result.warnings.length) toast.show(`${result.orphaned.length} poster kunde inte kopplas automatiskt.`, { kind: 'info' });
			pendingBackup = undefined;
		} catch (e) { toast.show(e instanceof Error ? e.message : 'Backupen kunde inte importeras.', { kind: 'error' }); }
		finally { backupBusy = false; }
	}

	// ───────── actions ─────────
	/** Both pickers must be started synchronously inside the click handler (user-gesture requirement). */
	async function pick(kind: 'folder' | 'files') {
		try {
			const res = await library.pick(kind);
			if (!res) return;
			if (res.added) toast.show(res.added === 1 ? '1 nytt nummer tillagt' : `${res.added} nya nummer tillagda`, { kind: 'ok' });
			else if (!res.failed.length) toast.show(res.skipped ? 'Inga nya nummer – allt fanns redan i biblioteket.' : 'Inga serier hittades.');
			if (res.failed.length) toast.show(`${res.failed.length} filer kunde inte läsas`, { kind: 'error' });
		} catch {
			toast.show('Det gick inte att läsa in filerna. Försök igen.', { kind: 'error' });
		}
	}
	async function demo() {
		try {
			const res = await library.addDemo();
			toast.show(res.added ? 'Demodata tillagd' : 'Demodatan finns redan i biblioteket', { kind: res.added ? 'ok' : 'info' });
		} catch {
			toast.show('Det gick inte att skapa demodata.', { kind: 'error' });
		}
	}
	function toggleConvert(id: string) {
		selectedConvert = selectedConvert.includes(id) ? selectedConvert.filter((x) => x !== id) : [...selectedConvert, id];
	}
	function selectAllConvert() {
		selectedConvert = library.issues.filter((i) => !i.unsupported).map((i) => i.id);
	}
	async function runConversion() {
		if (!selectedConvert.length || conversion.active) return;
		try {
			const result = await library.convertIssues(selectedConvert, { quality: convertQuality, maxWidth: convertWidth });
			if (result.cancelled) toast.show('Konverteringen avbröts', { kind: 'info' });
			else if (result.failed.length) toast.show(`${result.failed.length} filer kunde inte konverteras`, { kind: 'error' });
			else toast.show(`${result.completed} AVIF-CBZ-filer är klara att hämta`, { kind: 'ok' });
			// Results are separate downloads. Require a fresh selection before
			// starting another conversion, so the result cannot be reconverted by
			// clicking the primary action again.
			selectedConvert = [];
		} catch {
			toast.show('Konverteringen misslyckades. Originalen är oförändrade.', { kind: 'error' });
		}
	}
	async function downloadConverted(output: (typeof conversion.downloads)[number]) {
		try {
			await saveObjectUrl(output.url, { fileName: output.fileName, mimeType: 'application/zip' });
		} catch (e) {
			toast.show(e instanceof Error ? e.message : 'CBZ-filen kunde inte sparas.', { kind: 'error' });
		}
	}
	async function askPersist() {
		await library.persistStorage();
		const ok = library.storage.persisted;
		toast.show(ok ? 'Lagringen är nu beständig' : 'Webbläsaren avslog begäran. Prova igen efter att du installerat appen.', {
			kind: ok ? 'ok' : 'info'
		});
	}
	async function enrichAll() {
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			toast.show('Du verkar vara offline. Försök igen när du har anslutning.', { kind: 'error' });
			return;
		}
		cancelled = false;
		const before = library.metaJob;
		try {
			await library.enrichMissing(true);
			if (cancelled) return;
			const j = library.metaJob;
			if (j !== before) toast.show(`Klart – ${nf.format(j.done)} av ${nf.format(j.total)} serier kontrollerade`, { kind: 'ok' });
			else toast.show('Det finns inget att hämta just nu.');
		} catch {
			toast.show('Det gick inte att hämta metadata. Kontrollera anslutningen.', { kind: 'error' });
		}
	}
	function cancelEnrich() {
		cancelled = true;
		library.cancelMeta();
		toast.show('Hämtningen avbröts');
	}
	async function install() {
		const ev = ui.installEvent;
		if (!ev) return;
		try {
			await ev.prompt();
		} catch {
			/* the prompt can only be used once per event */
		}
		ui.installEvent = null;
	}
	async function doClearCopies() {
		if (busy) return;
		busy = true;
		try {
			await library.clearCopies();
			confirmCopies = false;
			toast.show('Sparade kopior togs bort', { kind: 'ok' });
		} catch {
			toast.show('Det gick inte att ta bort kopiorna. Försök igen.', { kind: 'error' });
		} finally {
			busy = false;
		}
	}
	async function doClearAll() {
		if (busy) return;
		busy = true;
		try {
			await library.clearAll();
			confirmAll = false;
			toast.show('Biblioteket rensades', { kind: 'ok' });
		} catch {
			toast.show('Det gick inte att rensa biblioteket. Försök igen.', { kind: 'error' });
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Inställningar – SuperLight Reader</title></svelte:head>

<!-- accessible switch: <button role="switch"> labelled by the row's label element -->
{#snippet toggle(labelId: string, on: boolean, set: (v: boolean) => void, disabled = false)}
	<button type="button" role="switch" class="switch" aria-checked={on} aria-labelledby={labelId} {disabled} onclick={() => set(!on)}>
		<span class="track"><span class="knob"></span></span>
	</button>
{/snippet}

<!-- segmented control built from native radios (keyboard + screen reader support for free) -->
{#snippet segmented(name: string, labelId: string, options: Choice[], current: string | number, set: (v: string | number) => void)}
	<div class="segs" role="radiogroup" aria-labelledby={labelId}>
		{#each options as o (o.value)}
			<label class="segopt">
				<input type="radio" {name} value={o.value} checked={current === o.value} onchange={() => set(o.value)} />
				<span>{o.label}</span>
			</label>
		{/each}
	</div>
{/snippet}

{#snippet groupHead(icon: IconName, id: string, title: string)}
	<header class="gh">
		<span class="gi"><Icon name={icon} size={20} /></span>
		<h2 class="h2" {id}>{title}</h2>
	</header>
{/snippet}

<div class="page settings">
	<header class="head">
		<h1 class="h1">Inställningar</h1>
		<p class="muted">Anpassa biblioteket, lagringen och läsaren.</p>
	</header>

	<!-- ───────── Bibliotek ───────── -->
	<section class="card group" aria-labelledby="g-lib">
		{@render groupHead('library', 'g-lib', 'Bibliotek')}
		<ul class="stats" aria-label="Biblioteket i siffror">
			<li><b>{nf.format(stats.series)}</b><span>{stats.series === 1 ? 'serie' : 'serier'}</span></li>
			<li><b>{nf.format(stats.issues)}</b><span>nummer</span></li>
			<li><b>{nf.format(stats.publishers)}</b><span>förlag</span></li>
		</ul>
		<SettingRow
			label="Lägg till mapp"
			help={library.scan.active
				? `Läser in ${nf.format(library.scan.done)} av ${nf.format(library.scan.total)}…`
				: 'Välj mappen där dina serier ligger. Undermappar ingår.'}
		>
			<button type="button" class="btn btn-primary" disabled={library.scan.active} onclick={() => pick('folder')}>
				<Icon name="folder" size={18} />Lägg till mapp
			</button>
		</SettingRow>
		<SettingRow label="Lägg till filer" help="Välj enskilda CBZ-filer. Bra när mappval inte fungerar på enheten.">
			<button type="button" class="btn" disabled={library.scan.active} onclick={() => pick('files')}>
				<Icon name="file" size={18} />Lägg till filer
			</button>
		</SettingRow>
		<SettingRow label="Prova demodata" help="Lägger till några exempelserier så att du kan prova appen.">
			<button type="button" class="btn" disabled={library.scan.active} onclick={demo}>
				<Icon name="sparkles" size={18} />Prova demodata
			</button>
		</SettingRow>
	</section>

	<!-- ───────── AVIF ───────── -->
	<section class="card group" aria-labelledby="g-avif">
		{@render groupHead('download', 'g-avif', 'Konvertera till AVIF')}
		<div class="note" role="note">
			<Icon name="info" size={18} />
			<p>Välj importerade nummer eller filer som redan finns i biblioteket. Originalen behålls och nya CBZ-filer erbjuds som klickbara hämtningar – inga dubbletter skapas i biblioteket. AVIF med vald kvalitet är lossy; ComicInfo.xml bevaras, men annan arkivmetadata kan saknas.</p>
		</div>
		<SettingRow label="Kvalitet" help="1–100. Högre värde ger större filer och mindre kvalitetsförlust.">
			<div class="convert-number"><input type="number" min="1" max="100" step="1" bind:value={convertQuality} aria-label="AVIF-kvalitet" /><span>/ 100</span></div>
		</SettingRow>
		<SettingRow label="Maximal bildbredd" help="Bilder bredare än värdet skalas ned. Sätt 0 för att behålla originalbredden.">
			<div class="convert-number"><input type="number" min="0" max="10000" step="100" bind:value={convertWidth} aria-label="Maximal bildbredd" /><span>px</span></div>
		</SettingRow>
		<SettingRow label="Filer att konvertera" help="Välj flera nummer. Olänkade eller format som inte kan öppnas rapporteras som fel.">
			<div class="convert-actions">
				<span class="pill" class:ok={selectedConvert.length > 0}>{nf.format(selectedConvert.length)} valda</span>
				<button type="button" class="btn btn-ghost" disabled={!library.issues.length || conversion.active} onclick={selectAllConvert}>Välj alla</button>
				<button type="button" class="btn btn-ghost" disabled={!selectedConvert.length || conversion.active} onclick={() => (selectedConvert = [])}>Rensa</button>
			</div>
		</SettingRow>
		{#if library.issues.length}
			<div class="convert-list" aria-label="Välj filer för AVIF-konvertering">
				{#each library.issues as issue (issue.id)}
					<label class="convert-item" class:disabled={!!issue.unsupported}>
						<input type="checkbox" checked={selectedConvert.includes(issue.id)} disabled={!!issue.unsupported || conversion.active} onchange={() => toggleConvert(issue.id)} />
						<span>{issue.fileName}<small>{issue.pageCount} sidor{issue.unsupported ? ` – ${issue.unsupported}` : ''}</small></span>
					</label>
				{/each}
			</div>
		{/if}
		{#if conversion.active}
			<div class="convert-job" role="status" aria-live="polite">
				<div class="job-top"><span><b>{nf.format(conversion.done)}</b> av {nf.format(conversion.total)} filer</span><span class="faint clamp-1">{conversion.current}</span></div>
				{#if conversion.pageTotal}<ProgressBar value={conversion.pageTotal ? conversion.pageDone / conversion.pageTotal : 0} height={6} />{/if}
				<div class="convert-job-bottom"><span class="muted">{#if conversion.pageTotal}Sida {conversion.pageDone} av {conversion.pageTotal}{:else}Förbereder…{/if}</span><button type="button" class="btn" onclick={() => library.cancelConvert()}>Avbryt</button></div>
			</div>
		{:else if conversion.completed || conversion.failed.length || conversion.cancelled}
			<div class="convert-result" role="status">
				{#if conversion.cancelled}<span>Konverteringen avbröts efter {conversion.completed} färdiga filer.</span>{:else}<span>{conversion.completed} nya filer är klara att hämta.</span>{/if}
				{#if conversion.failed.length}<ul>{#each conversion.failed as failure (failure.id)}<li>{failure.name}: {failure.error}</li>{/each}</ul>{/if}
			</div>
		{/if}
		{#if conversion.downloads.length}
			<div class="convert-downloads" aria-label="Konverterade filer">
				<strong>Färdiga filer</strong>
				<p class="muted">Webbläsaren sparar till vald hämtningsmapp eller visar en fråga. Om inget händer, kontrollera webbläsarens nedladdningsbehörighet. Resultaten ligger kvar här tills nästa konvertering.</p>
					{#each conversion.downloads as output (output.id)}<button type="button" class="btn" onclick={() => downloadConverted(output)} aria-label={`Hämta ${output.fileName}`}>Hämta {output.fileName}</button>{/each}
			</div>
		{/if}
		<div class="convert-submit"><button type="button" class="btn btn-primary" disabled={!selectedConvert.length || conversion.active} onclick={runConversion}><Icon name="download" size={18} />Konvertera valda</button></div>
	</section>

	<!-- ───────── Lagring ───────── -->
	<section class="card group" aria-labelledby="g-store">
		{@render groupHead('folder', 'g-store', 'Lagring')}
		<SettingRow
			label="Spara kopior i appen (offline)"
			help="Gör att serierna fungerar offline och efter omstart utan att du behöver välja mappen igen. Kopiorna tar plats på enheten."
		>
			{#snippet children(id: string)}
				{@render toggle(id, opfs && cfg.persistFiles, (v) => library.updateSettings({ persistFiles: v }), !opfs)}
			{/snippet}
		</SettingRow>
		{#if !opfs}
			<div class="note" role="note">
				<Icon name="info" size={18} />
				<p>Offline-lagring kräver säker anslutning (https) och stöds inte här – du får välja mappen igen efter omstart.</p>
			</div>
		{/if}
		{#if library.storage.quota > 0}
			<SettingRow label="Använt utrymme" help="Gäller all lagring som appen använder i webbläsaren." stack>
				<div class="usage">
					<div class="usage-top">
						<b>{fmtBytes(library.storage.usage)}</b><span class="muted">av {fmtBytes(library.storage.quota)}</span>
					</div>
					<ProgressBar value={usedFrac} height={6} />
				</div>
			</SettingRow>
		{/if}
		{#if opfs}
			<SettingRow
				label={`Beständig lagring: ${library.storage.persisted ? 'ja' : 'nej'}`}
				help="Beständig lagring hindrar webbläsaren från att rensa dina sparade serier när utrymmet blir knappt."
			>
				{#if library.storage.persisted}
					<span class="pill ok"><Icon name="check" size={16} />Aktiverad</span>
				{:else}
					<button type="button" class="btn" onclick={askPersist}>Be om beständig lagring</button>
				{/if}
			</SettingRow>
		{/if}
		<SettingRow
			label="Länkade och olänkade nummer"
			help="Länkade nummer går att läsa direkt. Olänkade finns i biblioteket men filen måste väljas igen – använd ”Lägg till mapp”."
		>
			<span class="pill ok">{nf.format(linkedCount)} länkade</span>
			<span class="pill" class:warn={library.unlinked > 0}>{nf.format(library.unlinked)} olänkade</span>
			{#if unsupportedCount}<span class="pill">{nf.format(unsupportedCount)} stöds inte</span>{/if}
		</SettingRow>
		{#if opfs}
			<SettingRow
				label="Ta bort sparade kopior"
				help={copies
					? `${nf.format(copies)} nummer är sparade i appen. Biblioteket och dina originalfiler påverkas inte.`
					: 'Inga kopior är sparade i appen just nu.'}
			>
				<button type="button" class="btn danger-outline" disabled={copies === 0} onclick={() => (confirmCopies = true)}>
					<Icon name="trash" size={18} />Ta bort kopior
				</button>
			</SettingRow>
		{/if}
	</section>

	<!-- ───────── Metadata ───────── -->
	<section class="card group" aria-labelledby="g-meta">
		{@render groupHead('sparkles', 'g-meta', 'Metadata')}
		<SettingRow label="Hämta metadata automatiskt" help="Hämtar beskrivning, förlag, år och genrer för nya serier när de läggs till.">
			{#snippet children(id: string)}
				{@render toggle(id, cfg.autoMetadata, (v) => library.updateSettings({ autoMetadata: v }))}
			{/snippet}
		</SettingRow>
		<SettingRow
			label="Hämta för alla serier nu"
			help="Uppdaterar metadata för hela biblioteket. Serier du redigerat själv hoppas över."
			stack={job.active}
		>
			{#if job.active}
				<div class="job" role="group" aria-label="Förlopp för metadatahämtning">
					<div class="job-top">
						<span><b>{nf.format(job.done)}</b> av {nf.format(job.total)} serier</span>
						<span class="faint clamp-1">{job.label}</span>
					</div>
					<ProgressBar value={job.total ? job.done / job.total : 0} height={6} />
				</div>
				<button type="button" class="btn" onclick={cancelEnrich}>Avbryt</button>
			{:else}
				<button type="button" class="btn" disabled={stats.series === 0} onclick={enrichAll}>
					<Icon name="refresh" size={18} />Hämta nu
				</button>
			{/if}
		</SettingRow>
		<div class="note" role="note">
			<Icon name="info" size={18} />
			<p>Serienamn skickas till Wikipedia/Wikidata, AniList, Google Books och Open Library.</p>
		</div>
	</section>

	<!-- ───────── Metron ───────── -->
	<section class="card group" aria-labelledby="g-metron">
		{@render groupHead('link', 'g-metron', 'Metron')}
		{#if nativeMetron}
			<SettingRow
				label="API-token"
				help="Tokenen lagras endast i Androids säkra app-lagring. Den visas inte i backup, loggar eller webb-bundle."
				stack
			>
				<div class="metron-token">
					<div class="metron-token-row">
						<input
							type="password"
							bind:value={metronToken}
							placeholder="Klistra in Metron-token"
							autocomplete="off"
							spellcheck="false"
							maxlength="512"
							aria-label="Metron API-token"
							disabled={metronBusy}
						/>
						<button type="button" class="btn btn-primary" disabled={metronBusy || !metronToken.trim()} onclick={saveMetronToken}>
							{metronBusy ? 'Sparar…' : 'Spara token'}
						</button>
					</div>
					{#if metronStatus === 'loading'}<span class="muted" role="status">Kontrollerar tokenstatus…</span>
					{:else if metronStatus === 'configured'}<span class="pill ok" role="status"><Icon name="check" size={16} />Token konfigurerad</span>
					{:else if metronStatus === 'missing'}<span class="pill warn" role="status">Ingen token konfigurerad</span>
					{:else}<span class="error" role="alert">{metronMessage}</span>{/if}
				</div>
			</SettingRow>
			<SettingRow label="Ta bort token" help="Tar bort den lokalt lagrade tokenen. Befintliga Metron-matchningar i biblioteket påverkas inte.">
				<button type="button" class="btn danger-outline" disabled={metronBusy || metronStatus !== 'configured'} onclick={removeMetronToken}>
					<Icon name="trash" size={18} />Ta bort token
				</button>
			</SettingRow>
			{#if metronMessage && metronStatus !== 'unavailable'}<p class="metron-error" role="alert">{metronMessage}</p>{/if}
		{:else}
			<div class="note" role="note">
				<Icon name="info" size={18} />
				<p>Webbversionen använder lokalhost-proxyn. Ange token i proxyns servermiljö; användarhemligheter lagras inte i webbläsaren.</p>
			</div>
		{/if}
	</section>

	<!-- ───────── Läsaren ───────── -->
	<section class="card group" aria-labelledby="g-reader">
		{@render groupHead('book', 'g-reader', 'Läsaren')}
		<SettingRow label="Anpassning" help="Hur sidan passas in på skärmen.">
			{#snippet children(id: string)}
				{@render segmented('reader-fit', id, FIT, reader.fit, (v) => library.updateReader({ fit: v as ReaderSettings['fit'] }))}
			{/snippet}
		</SettingRow>
		<SettingRow label="Uppslag" help="Visa en eller två sidor åt gången.">
			{#snippet children(id: string)}
				{@render segmented('reader-spread', id, SPREAD, reader.spread, (v) => library.updateReader({ spread: v as ReaderSettings['spread'] }))}
			{/snippet}
		</SettingRow>
		<SettingRow label="Läsriktning" help="Auto följer serien – manga läses till exempel från höger till vänster.">
			{#snippet children(id: string)}
				{@render segmented('reader-dir', id, DIRECTION, reader.direction, (v) =>
					library.updateReader({ direction: v as ReaderSettings['direction'] })
				)}
			{/snippet}
		</SettingRow>
		<SettingRow label="Bakgrund" help="Färgen bakom sidorna.">
			{#snippet children(id: string)}
				<div class="swatches" role="radiogroup" aria-labelledby={id}>
					{#each BACKGROUNDS as b (b.value)}
						<label class="sw">
							<input
								type="radio"
								name="reader-bg"
								value={b.value}
								checked={canonColor(reader.background) === b.value}
								onchange={() => library.updateReader({ background: String(b.value) })}
							/>
							<span class="dot" style:--c={String(b.value)}></span>
							<span class="nm">{b.label}</span>
						</label>
					{/each}
				</div>
			{/snippet}
		</SettingRow>
		<SettingRow label="Tryckzoner" help="Tryck till vänster eller höger på sidan för att bläddra.">
			{#snippet children(id: string)}
				{@render toggle(id, reader.tapZones, (v) => library.updateReader({ tapZones: v }))}
			{/snippet}
		</SettingRow>
		<SettingRow label="Håll skärmen på" help="Förhindrar att skärmen släcks medan du läser.">
			{#snippet children(id: string)}
				{@render toggle(id, reader.keepAwake, (v) => library.updateReader({ keepAwake: v }))}
			{/snippet}
		</SettingRow>
		<SettingRow label="Förladdning" help="Antal sidor som läses in i förväg. Fler ger mjukare bläddring men använder mer minne.">
			{#snippet children(id: string)}
				{@render segmented('reader-preload', id, PRELOAD, reader.preload, (v) => library.updateReader({ preload: Number(v) }))}
			{/snippet}
		</SettingRow>
	</section>

	<!-- ───────── Utseende ───────── -->
	<section class="card group" aria-labelledby="g-look">
		{@render groupHead('sliders', 'g-look', 'Utseende')}
		<SettingRow label="Kortstorlek" help="Minsta bredd på omslagen i rutnäten. Större kort ger färre kolumner." stack>
			{#snippet children(id: string)}
				<div class="range">
					<input
						type="range"
						min="120"
						max="260"
						step="10"
						value={cardSize}
						aria-labelledby={id}
						aria-valuetext={`${cardSize} pixlar`}
						oninput={(e) => (liveSize = Number(e.currentTarget.value))}
						onchange={(e) => {
							library.updateSettings({ cardSize: Number(e.currentTarget.value) });
							liveSize = null;
						}}
					/>
					<output>{cardSize} px</output>
				</div>
			{/snippet}
		</SettingRow>
	</section>

	<!-- ───────── Installera ───────── -->
	<section class="card group" aria-labelledby="g-install">
		{@render groupHead('download', 'g-install', 'Installera')}
		{#if ui.installEvent}
			<SettingRow label="Installera appen" help="Lägg till SuperLight Reader på hemskärmen för helskärmsläge och snabb start.">
				<button type="button" class="btn btn-primary" onclick={install}><Icon name="download" size={18} />Installera</button>
			</SettingRow>
		{:else if standalone}
			<SettingRow label="Appen är installerad" help="Du använder redan SuperLight Reader som installerad app." />
		{:else}
			<SettingRow label="Installera appen" help="Android/Chrome: ⋮ → Lägg till på startskärmen" />
		{/if}
	</section>

	<!-- ───────── Backup ───────── -->
	<section class="card group" aria-labelledby="g-backup">
		{@render groupHead('download', 'g-backup', 'Backup')}
		<SettingRow label="Exportera backup" help="Skapar en flyttbar JSON-fil med bibliotek, metadata, lässtatus, inställningar och läsordningar. Originalfiler och sparade kopior ingår aldrig.">
			<button type="button" class="btn" onclick={downloadBackupFile}><Icon name="download" size={18} />Exportera JSON</button>
		</SettingRow>
		<SettingRow label="Importera backup" help="Importen slår ihop data utan att skriva över befintliga poster med samma id. Filer måste väljas igen efter import.">
			<input class="sr-only" bind:this={backupInput} type="file" accept="application/json,.json" onchange={readBackup} />
			<button type="button" class="btn" onclick={() => backupInput?.click()}><Icon name="upload" size={18} />Välj JSON-fil</button>
		</SettingRow>
		<div class="note" role="note"><Icon name="info" size={18} /><p>Importen är icke-destruktiv: befintliga uppgifter vinner vid id-krockar. Importerade nummer blir olänkade tills du väljer mappen igen. Inställningar importeras bara efter bekräftelse.</p></div>
	</section>

	<!-- ───────── Rensa ───────── -->
	<section class="card group danger-zone" aria-labelledby="g-clear">
		{@render groupHead('trash', 'g-clear', 'Rensa')}
		<SettingRow
			label="Rensa biblioteket"
			help="Tar bort alla serier, läshistorik, betyg och sparade kopior från appen. Dina originalfiler på enheten påverkas inte. Det går inte att ångra."
		>
			<button type="button" class="btn danger" onclick={() => (confirmAll = true)}>
				<Icon name="trash" size={18} />Rensa hela biblioteket
			</button>
		</SettingRow>
	</section>

	<!-- ───────── Om ───────── -->
	<section class="card group" aria-labelledby="g-about">
		{@render groupHead('info', 'g-about', 'Om')}
		<SettingRow label="SuperLight Reader 1.0" help="Lätt serieläsare som körs i webbläsaren. Filerna och biblioteket stannar på din enhet. Om metadata aktiveras skickas serienamn till angivna metadatatjänster." />
		<SettingRow label="Metadatakällor" help="Beskrivningar och uppgifter om serier hämtas från:" stack>
			<ul class="links">
				{#each SOURCE_LINKS as l (l.name)}
					<li>
						<a class="chip" href={l.href} target="_blank" rel="noopener noreferrer">{l.name}<Icon name="external" size={14} /></a>
					</li>
				{/each}
			</ul>
		</SettingRow>
	</section>
</div>

<Sheet open={confirmCopies} title="Ta bort sparade kopior?" onclose={() => (confirmCopies = false)}>
	<p class="confirm-text">
		Kopiorna i appen ({nf.format(copies)} nummer) tas bort. Biblioteket och dina originalfiler påverkas inte, men nummer som bara fanns som kopia
		måste du välja mappen för igen innan du kan läsa dem.
	</p>
	{#snippet footer()}
		<button type="button" class="btn" onclick={() => (confirmCopies = false)}>Avbryt</button>
		<button type="button" class="btn danger" disabled={busy} onclick={doClearCopies}>Ta bort kopior</button>
	{/snippet}
</Sheet>

<Sheet open={confirmAll} title="Rensa hela biblioteket?" onclose={() => (confirmAll = false)}>
	<p class="confirm-text">
		Alla serier, all läshistorik, alla betyg och alla sparade kopior tas bort från appen. Dina originalfiler på enheten påverkas inte. Det
		går inte att ångra.
	</p>
	{#snippet footer()}
		<button type="button" class="btn" onclick={() => (confirmAll = false)}>Avbryt</button>
		<button type="button" class="btn danger" disabled={busy} onclick={doClearAll}>Rensa allt</button>
	{/snippet}
</Sheet>

<Sheet open={!!pendingBackup} title="Importera backup?" onclose={() => (pendingBackup = undefined)}>
	{#if pendingBackup}<p class="confirm-text"><b>{pendingBackup.fileName}</b> innehåller {nf.format(pendingBackup.data.issues.length)} nummer, {nf.format(pendingBackup.data.seriesMeta.length)} metadatafält och {nf.format(pendingBackup.data.progress.length)} lässtatusposter.</p><p class="confirm-text">Befintliga poster skrivs inte över. Inga filer importeras och importerade nummer måste länkas om.</p><label class="backup-option"><input type="checkbox" bind:checked={importSettings} /> Importera även läsar- och appinställningar</label>{/if}
	{#snippet footer()}<button type="button" class="btn" onclick={() => (pendingBackup = undefined)}>Avbryt</button><button type="button" class="btn btn-primary" disabled={backupBusy} onclick={importPending}>{backupBusy ? 'Importerar…' : 'Importera'}</button>{/snippet}
</Sheet>

<style>
	.settings {
		display: grid;
		gap: 18px;
		align-content: start;
		max-width: 880px;
	}
	.head {
		display: grid;
		gap: 4px;
		padding: 4px 2px 2px;
	}

	/* ───────── group cards ───────── */
	.group {
		animation: rise 0.4s var(--ease) both;
	}
	.gh {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 18px 12px;
	}
	.gi {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 11px;
		background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
		color: var(--accent-2);
	}
	.danger-zone {
		border-color: color-mix(in srgb, var(--danger) 38%, var(--border));
	}
	.danger-zone .gi {
		background: color-mix(in srgb, var(--danger) 16%, var(--surface-2));
		color: var(--danger);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin: 0;
		padding: 0 18px 16px;
		list-style: none;
	}
	.stats li {
		display: grid;
		gap: 2px;
		padding: 12px 14px;
		border-radius: var(--radius-s);
		background: var(--surface-2);
	}
	.stats b {
		font-size: 1.55rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}
	.stats span {
		color: var(--text-dim);
		font-size: 0.86rem;
	}

	.note {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 14px 18px 16px;
		border-top: 1px solid var(--border);
		color: var(--text-dim);
		font-size: 0.9rem;
		line-height: 1.45;
	}
	.note :global(svg) {
		flex: none;
		margin-top: 1px;
		color: var(--accent-2);
	}
	.metron-token { display:grid; gap:10px; width:min(100%, 620px); }
	.metron-token-row { display:flex; flex-wrap:wrap; gap:8px; }
	.metron-token-row input { flex:1 1 260px; min-width:0; min-height:44px; padding:0 12px; border:1px solid var(--border-strong); border-radius:var(--radius-s); background:var(--bg-raised); }
	.metron-token-row input::placeholder { color:var(--text-faint); }
	.metron-error, .error { color:var(--danger); font-size:.9rem; }
	.metron-error { margin:0 18px 14px; }
	.backup-option { display:flex; align-items:center; gap:10px; min-height:44px; margin-top:14px; color:var(--text-dim); }
	.backup-option input { width:19px; height:19px; accent-color:var(--accent); }
	.convert-number { display:flex; align-items:center; gap:8px; color:var(--text-dim); }
	.convert-number input { width:7.5rem; min-height:42px; padding:0 10px; border:1px solid var(--border-strong); border-radius:var(--radius-s); background:var(--bg-raised); color:var(--text); font:inherit; font-variant-numeric:tabular-nums; }
	.convert-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
	.convert-list { display:grid; gap:2px; max-height:18rem; overflow:auto; padding:0 18px 12px; border-top:1px solid var(--border); }
	.convert-item { display:flex; align-items:flex-start; gap:10px; padding:9px 4px; border-bottom:1px solid color-mix(in srgb, var(--border) 60%, transparent); cursor:pointer; }
	.convert-item input { width:19px; height:19px; flex:none; margin-top:2px; accent-color:var(--accent); }
	.convert-item span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.convert-item small { display:block; margin-top:2px; color:var(--text-dim); font-size:.78rem; }
	.convert-item.disabled { opacity:.5; cursor:not-allowed; }
	.convert-job { display:grid; gap:9px; margin:4px 18px 14px; padding:14px; border:1px solid var(--border); border-radius:var(--radius-s); background:var(--surface-2); }
	.convert-job-bottom { display:flex; align-items:center; justify-content:space-between; gap:10px; }
	.convert-result { margin:4px 18px 14px; padding:12px 14px; border-radius:var(--radius-s); background:var(--surface-2); color:var(--text-dim); font-size:.9rem; }
	.convert-result ul { margin:8px 0 0; padding-left:1.2rem; color:var(--danger); }
	.convert-downloads { display:grid; gap:8px; margin:4px 18px 14px; padding:12px 14px; border-radius:var(--radius-s); background:var(--surface-2); }
	.convert-downloads button { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.convert-submit { display:flex; justify-content:flex-start; padding:0 18px 18px; }

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-dim);
		font-size: 0.88rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.pill.ok {
		border-color: color-mix(in srgb, var(--ok) 40%, transparent);
		color: var(--ok);
	}
	.pill.warn {
		border-color: color-mix(in srgb, var(--warn) 45%, transparent);
		color: var(--warn);
	}

	/* ───────── storage + metadata progress ───────── */
	.usage,
	.job {
		display: grid;
		flex: 1 1 280px;
		gap: 8px;
		min-width: 0;
		width: min(100%, 520px);
	}
	.usage-top,
	.job-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		font-size: 0.92rem;
		font-variant-numeric: tabular-nums;
	}
	.job-top span:last-child {
		min-width: 0;
		text-align: right;
	}

	/* ───────── controls ───────── */
	.switch {
		display: grid;
		place-items: center;
		width: 60px;
		height: 44px;
		border-radius: 999px;
	}
	.track {
		position: relative;
		width: 52px;
		height: 30px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface-3);
		transition:
			background 0.18s,
			border-color 0.18s;
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		transition: transform 0.2s var(--ease);
	}
	.switch[aria-checked='true'] .track {
		border-color: transparent;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
	}
	.switch[aria-checked='true'] .knob {
		transform: translateX(22px);
	}
	.switch[disabled] {
		opacity: 0.45;
		pointer-events: none;
	}

	.segs {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		max-width: 100%;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 24px;
		background: var(--bg-raised);
	}
	.segopt {
		position: relative;
	}
	.segopt input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.segopt span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 46px;
		min-height: 44px;
		padding: 0 16px;
		border-radius: 999px;
		color: var(--text-dim);
		font-size: 0.94rem;
		font-weight: 650;
		white-space: nowrap;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.segopt:hover input:not(:checked) + span {
		background: var(--surface-2);
		color: var(--text);
	}
	.segopt input:checked + span {
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		color: var(--accent-ink);
	}
	.segopt input:focus-visible + span {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.sw {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 6px;
		min-width: 68px;
		padding: 4px 6px;
		cursor: pointer;
	}
	.sw input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.dot {
		width: 44px;
		height: 44px;
		border: 2px solid var(--border-strong);
		border-radius: 50%;
		background: var(--c);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.nm {
		color: var(--text-dim);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.sw input:checked ~ .dot {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.sw input:checked ~ .nm {
		color: var(--text);
	}
	.sw input:focus-visible ~ .dot {
		outline: 2px solid var(--accent-2);
		outline-offset: 3px;
	}

	.range {
		display: flex;
		align-items: center;
		gap: 14px;
		width: min(100%, 460px);
	}
	.range input {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		accent-color: var(--accent);
	}
	.range output {
		min-width: 4.6ch;
		text-align: right;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.links .chip {
		min-height: 44px;
		padding-inline: 16px;
	}

	/* ───────── danger + confirm ───────── */
	.btn.danger {
		border-color: transparent;
		background: var(--danger);
		color: #1c070b;
	}
	.btn.danger:hover {
		background: var(--danger);
		filter: brightness(1.08);
	}
	.btn.danger-outline {
		border-color: color-mix(in srgb, var(--danger) 55%, transparent);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		color: var(--danger);
	}
	.confirm-text {
		color: var(--text-dim);
		line-height: 1.55;
	}

	@media (max-width: 520px) {
		.stats {
			gap: 8px;
		}
		.stats li {
			padding: 10px;
		}
		.stats b {
			font-size: 1.3rem;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
