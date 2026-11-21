<script lang="ts">
	import { library } from '$lib/library.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import Icon from './Icon.svelte';
	let showErrors = false;
	let dismissed = false;

	/**
	 * Floating status pill/card (bottom-left above the bottom nav on phones, bottom-right on wide screens). Shows, when active:
	 *  - library.scan.active: "Läser in 34 / 120" or "Kopierar …" (phase 'copy') + current file name (clamp-1) + ProgressBar (done/total)
	 *  - library.metaJob.active: "Hämtar metadata 5 / 40 · {label}" + a "Avbryt" button (library.cancelMeta())
	 *  - when a scan just finished with failures (library.scan.failed.length) show a dismissible notice "N filer kunde inte läsas" with a
	 *    "Visa" toggle listing path + error.
	 * Nothing rendered when idle.
	 */
</script>

{#if library.scan.active || library.metaJob.active || (library.scan.failed.length > 0 && !dismissed)}
	<div class="scan-banner" aria-live="polite">
		{#if library.scan.active}<div class="row"><Icon name={library.scan.phase === 'copy' ? 'download' : 'refresh'} size={18} /><strong>{library.scan.phase === 'copy' ? 'Kopierar' : 'Läser in'} {library.scan.done} / {library.scan.total}</strong></div><p class="clamp-1">{library.scan.label}</p><ProgressBar value={library.scan.total ? library.scan.done / library.scan.total : 0} />{/if}
		{#if library.metaJob.active}<div class="row"><Icon name="sparkles" size={18} /><strong>Hämtar metadata {library.metaJob.done} / {library.metaJob.total}</strong><button class="btn btn-ghost" type="button" onclick={() => library.cancelMeta()}>Avbryt</button></div><p class="clamp-1 muted">{library.metaJob.label}</p><ProgressBar value={library.metaJob.total ? library.metaJob.done / library.metaJob.total : 0} />{/if}
		{#if library.scan.failed.length && !library.scan.active}<div class="row"><strong>{library.scan.failed.length} filer kunde inte läsas</strong><button class="btn btn-ghost" type="button" onclick={() => showErrors = !showErrors}>{showErrors ? 'Dölj' : 'Visa'}</button><button class="btn btn-icon btn-ghost" aria-label="Stäng" type="button" onclick={() => dismissed = true}>×</button></div>{#if showErrors}<ul>{#each library.scan.failed as fail}<li><strong>{fail.path}</strong><span>{fail.error}</span></li>{/each}</ul>{/if}{/if}
	</div>
{/if}

<style>
	.scan-banner { position:fixed; z-index:80; right:20px; bottom:20px; width:min(390px,calc(100vw - 40px)); padding:14px 16px; border:1px solid var(--border-strong); border-radius:var(--radius); background:color-mix(in srgb,var(--surface) 94%,transparent); box-shadow:var(--shadow-pop); backdrop-filter:blur(14px); }.row { display:flex; align-items:center; gap:8px; }.row .btn { margin-left:auto; min-height:36px; padding-inline:10px; font-size:.85rem; }.scan-banner p { margin:5px 0 9px; color:var(--text-dim); font-size:.85rem; }.scan-banner ul { display:grid; gap:8px; max-height:180px; overflow:auto; margin:10px 0 0; padding-left:18px; font-size:.8rem; }.scan-banner li span { display:block; color:var(--danger); }.scan-banner li strong { overflow-wrap:anywhere; }@media(max-width:699px){.scan-banner{right:10px;bottom:calc(var(--nav-h) + var(--safe-b) + 10px);width:calc(100vw - 20px)}}
</style>
