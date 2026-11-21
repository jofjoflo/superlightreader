<script lang="ts">
	import Sheet from '$lib/components/Sheet.svelte';
	import { library } from '$lib/library.svelte';
	import type { ReaderSettings } from '$lib/types';

	/** Reading settings, saved straight away through the store (they apply live behind the sheet). */
	let { open, onclose }: { open: boolean; onclose: () => void } = $props();

	const r = $derived(library.settings.reader);
	const set = (patch: Partial<ReaderSettings>) => library.updateReader(patch);

	const fits = [
		['screen', 'Hela sidan'],
		['width', 'Bredd'],
		['height', 'Höjd']
	] as const;
	const spreads = [
		['auto', 'Auto'],
		['single', 'Enkel'],
		['double', 'Dubbel']
	] as const;
	const directions = [
		['auto', 'Auto'],
		['ltr', 'Vänster → höger'],
		['rtl', 'Höger → vänster']
	] as const;
	const backgrounds = [
		['#000000', 'Svart'],
		['#16181f', 'Mörk'],
		['#3a3d46', 'Grå'],
		['#f2ecdd', 'Papper'],
		['#ffffff', 'Vit']
	] as const;
	const hex = $derived(/^#[0-9a-f]{6}$/i.test(r.background) ? r.background : '#000000');
</script>

<Sheet {open} title="Läsinställningar" {onclose}>
	<div class="group">
		<h3>Anpassning</h3>
		<div class="seg" role="radiogroup" aria-label="Anpassning">
			{#each fits as [value, label] (value)}
				<button type="button" role="radio" aria-checked={r.fit === value} class:on={r.fit === value} onclick={() => set({ fit: value })}>{label}</button>
			{/each}
		</div>
		<p class="hint">Bredd och Höjd kan bli större än skärmen – dra för att rulla.</p>
	</div>

	<div class="group">
		<h3>Uppslag</h3>
		<div class="seg" role="radiogroup" aria-label="Uppslag">
			{#each spreads as [value, label] (value)}
				<button type="button" role="radio" aria-checked={r.spread === value} class:on={r.spread === value} onclick={() => set({ spread: value })}>{label}</button>
			{/each}
		</div>
		<p class="hint">Auto visar två sidor när skärmen ligger. Omslag och breda sidor visas alltid ensamma.</p>
	</div>

	<div class="group">
		<h3>Riktning</h3>
		<div class="seg" role="radiogroup" aria-label="Läsriktning">
			{#each directions as [value, label] (value)}
				<button type="button" role="radio" aria-checked={r.direction === value} class:on={r.direction === value} onclick={() => set({ direction: value })}>{label}</button>
			{/each}
		</div>
		<p class="hint">Auto läser höger → vänster för manga.</p>
	</div>

	<div class="group">
		<h3>Bakgrund</h3>
		<div class="swatches">
			{#each backgrounds as [color, label] (color)}
				<button
					type="button"
					class="swatch"
					class:on={r.background.toLowerCase() === color}
					style:background={color}
					role="radio"
					aria-checked={r.background.toLowerCase() === color}
					aria-label={label}
					title={label}
					onclick={() => set({ background: color })}
				></button>
			{/each}
			<label class="custom">
				<input type="color" value={hex} aria-label="Egen bakgrundsfärg" oninput={(e) => set({ background: e.currentTarget.value })} />
				<span>Egen</span>
			</label>
		</div>
	</div>

	<div class="group rows">
		<label class="row">
			<span class="grow"><strong>Tryckzoner</strong><small>Tryck på sidorna för att bläddra och i mitten för menyn</small></span>
			<input class="switch" type="checkbox" role="switch" checked={r.tapZones} onchange={(e) => set({ tapZones: e.currentTarget.checked })} />
		</label>
		<label class="row">
			<span class="grow"><strong>Håll skärmen på</strong><small>Skärmen släcks inte medan du läser</small></span>
			<input class="switch" type="checkbox" role="switch" checked={r.keepAwake} onchange={(e) => set({ keepAwake: e.currentTarget.checked })} />
		</label>
	</div>

	<div class="group">
		<div class="line"><h3>Förladdning</h3><span class="muted">{r.preload} {r.preload === 1 ? 'sida' : 'sidor'} framåt</span></div>
		<input class="slider" type="range" min="0" max="6" step="1" value={r.preload} aria-label="Antal sidor att förladda" oninput={(e) => set({ preload: e.currentTarget.valueAsNumber })} />
	</div>

	{#snippet footer()}
		<button class="btn btn-primary" type="button" onclick={onclose}>Klar</button>
	{/snippet}
</Sheet>

<style>
	.group {
		display: grid;
		gap: 10px;
		margin-bottom: 22px;
	}
	.group:last-child {
		margin-bottom: 0;
	}
	h3 {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.hint {
		font-size: 0.85rem;
		color: var(--text-faint);
	}
	.line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 4px;
		padding: 4px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.seg button {
		min-height: 44px;
		padding: 0 10px;
		border-radius: 999px;
		border: 1px solid transparent;
		color: var(--text-dim);
		font-weight: 600;
		font-size: 0.92rem;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.seg button.on {
		background: color-mix(in srgb, var(--accent) 22%, var(--surface));
		border-color: color-mix(in srgb, var(--accent) 70%, transparent);
		color: var(--text);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}
	.swatch {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px solid var(--border-strong);
		transition: transform 0.12s var(--ease);
	}
	.swatch:active {
		transform: scale(0.94);
	}
	.swatch.on {
		border-color: var(--accent-2);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.custom {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 14px 0 6px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font-weight: 600;
		cursor: pointer;
	}
	.custom input {
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		cursor: pointer;
	}

	.rows {
		gap: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 56px;
		padding: 8px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		cursor: pointer;
	}
	.grow {
		flex: 1;
		display: grid;
		gap: 2px;
	}
	.grow small {
		color: var(--text-faint);
		font-size: 0.82rem;
	}
	.switch {
		-webkit-appearance: none;
		appearance: none;
		position: relative;
		flex: none;
		width: 52px;
		height: 32px;
		margin: 0;
		border-radius: 999px;
		background: var(--surface-3);
		cursor: pointer;
		transition: background 0.18s;
	}
	.switch::after {
		content: '';
		position: absolute;
		top: 4px;
		left: 4px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
		transition: transform 0.18s var(--ease);
	}
	.switch:checked {
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
	}
	.switch:checked::after {
		transform: translateX(20px);
	}
	.slider {
		width: 100%;
		min-height: 44px;
		accent-color: var(--accent);
	}
</style>
