<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	/**
	 * Reader chrome: translucent top bar (back, title, page counter, settings) and bottom bar (direction-aware
	 * page slider, previous/next issue, fullscreen). Visibility is owned by the page; it auto-hides after 3 s there.
	 */
	interface Props {
		visible: boolean;
		backHref: string;
		title: string;
		/** "7 / 32" */
		counter: string;
		/** First page index of what is shown (slider value). */
		index: number;
		count: number;
		rtl: boolean;
		avifWarning: boolean;
		hasPrev: boolean;
		hasNext: boolean;
		prevTag: string;
		nextTag: string;
		canFullscreen: boolean;
		fullscreen: boolean;
		onsettings: () => void;
		/** `done` false while dragging (debounce it), true on release. */
		onseek: (page: number, done: boolean) => void;
		onprevissue: () => void;
		onnextissue: () => void;
		onfullscreen: () => void;
		/** Any touch on the bars: restart the auto-hide timer. */
		onactivity: () => void;
		/** Slider is being dragged: keep the bars up. */
		onhold: (held: boolean) => void;
	}
	let {
		visible,
		backHref,
		title,
		counter,
		index,
		count,
		rtl,
		avifWarning,
		hasPrev,
		hasNext,
		prevTag,
		nextTag,
		canFullscreen,
		fullscreen,
		onsettings,
		onseek,
		onprevissue,
		onnextissue,
		onfullscreen,
		onactivity,
		onhold
	}: Props = $props();

	/** Page the slider is being dragged to (shown live); null when idle. */
	let scrub = $state<number | null>(null);
	const label = $derived(scrub === null ? counter : `${scrub + 1} / ${count}`);
	const pct = $derived(count > 1 ? (((scrub ?? index) / (count - 1)) * 100).toFixed(2) : '100');
</script>

<div class="hud" class:hidden={!visible} inert={!visible} role="presentation" onpointerdown={onactivity}>
	<header class="bar top">
		<a class="btn btn-icon round" href={backHref} aria-label="Tillbaka till serien" title="Tillbaka till serien"><Icon name="arrow-left" size={22} /></a>
		<div class="heading">
			<strong class="clamp-1">{title}</strong>
			{#if avifWarning}
				<span class="warn"><Icon name="info" size={14} />AVIF-sidor kan inte visas i den här webbläsaren</span>
			{/if}
		</div>
		<span class="counter">{label}</span>
		<button class="btn btn-icon round" type="button" aria-label="Inställningar" title="Inställningar" onclick={onsettings}><Icon name="sliders" size={22} /></button>
	</header>

	<footer class="bar bottom">
		<div class="seek" class:rtl>
			<button class="btn round issue" type="button" aria-label="Föregående nummer" title="Föregående nummer" disabled={!hasPrev} onclick={onprevissue}>
				<Icon name={rtl ? 'chevron-right' : 'chevron-left'} size={20} />{#if prevTag}<span>{prevTag}</span>{/if}
			</button>
			<input
				class="range"
				class:rtl
				type="range"
				min="0"
				max={Math.max(0, count - 1)}
				step="1"
				value={scrub ?? index}
				disabled={count <= 1}
				style:--p="{pct}%"
				aria-label="Sida"
				aria-valuetext={label}
				oninput={(e) => {
					const to = e.currentTarget.valueAsNumber;
					scrub = to;
					onseek(to, false);
				}}
				onchange={(e) => {
					onseek(e.currentTarget.valueAsNumber, true);
					scrub = null;
					onhold(false);
				}}
				onpointerdown={() => onhold(true)}
				onpointerup={() => onhold(false)}
				onpointercancel={() => onhold(false)}
			/>
			<button class="btn round issue" type="button" aria-label="Nästa nummer" title="Nästa nummer" disabled={!hasNext} onclick={onnextissue}>
				{#if nextTag}<span>{nextTag}</span>{/if}<Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={20} />
			</button>
		</div>
		{#if canFullscreen}
			<button
				class="btn btn-icon round"
				type="button"
				aria-label={fullscreen ? 'Avsluta helskärm' : 'Helskärm'}
				title={fullscreen ? 'Avsluta helskärm' : 'Helskärm'}
				onclick={onfullscreen}
			>
				<Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} size={22} />
			</button>
		{/if}
	</footer>
</div>

<style>
	.hud {
		position: fixed;
		inset: 0;
		z-index: 10;
		pointer-events: none;
	}
	.bar {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding-inline: max(12px, env(safe-area-inset-left)) max(12px, env(safe-area-inset-right));
		background: color-mix(in srgb, var(--bg) 62%, transparent);
		-webkit-backdrop-filter: blur(16px) saturate(1.5);
		backdrop-filter: blur(16px) saturate(1.5);
		pointer-events: auto;
		transition:
			transform 0.22s var(--ease),
			opacity 0.22s var(--ease),
			visibility 0s;
	}
	.top {
		top: 0;
		padding-top: max(10px, env(safe-area-inset-top));
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}
	.bottom {
		bottom: 0;
		padding-top: 10px;
		padding-bottom: max(12px, env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
	}
	.hidden .bar {
		opacity: 0;
		visibility: hidden;
		transition:
			transform 0.22s var(--ease),
			opacity 0.22s var(--ease),
			visibility 0s linear 0.22s;
	}
	.hidden .top {
		transform: translateY(-100%);
	}
	.hidden .bottom {
		transform: translateY(100%);
	}

	.round {
		background: color-mix(in srgb, var(--surface) 70%, transparent);
	}
	.heading {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	.heading strong {
		font-size: 1rem;
		line-height: 1.2;
	}
	.warn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--warn);
		font-size: 0.8rem;
	}
	.counter {
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--surface) 75%, transparent);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.seek {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.seek.rtl {
		flex-direction: row-reverse;
	}
	.issue {
		min-width: 44px;
		padding: 0 10px;
		gap: 2px;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 520px) {
		.issue span {
			display: none;
		}
	}

	.range {
		-webkit-appearance: none;
		appearance: none;
		flex: 1;
		min-width: 0;
		height: 44px;
		margin: 0;
		background: transparent;
		cursor: pointer;
		touch-action: pan-y;
		accent-color: var(--accent);
	}
	.range.rtl {
		transform: scaleX(-1);
	}
	.range:disabled {
		opacity: 0.4;
	}
	.range::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 4px;
		background: linear-gradient(90deg, var(--accent), var(--accent-2) var(--p), rgba(255, 255, 255, 0.28) var(--p));
	}
	.range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 20px;
		height: 20px;
		margin-top: -8px;
		border-radius: 50%;
		border: 3px solid var(--accent);
		background: #fff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
	}
	.range::-moz-range-track {
		height: 4px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.28);
	}
	.range::-moz-range-progress {
		height: 4px;
		border-radius: 4px;
		background: linear-gradient(90deg, var(--accent), var(--accent-2));
	}
	.range::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 3px solid var(--accent);
		background: #fff;
	}
</style>
