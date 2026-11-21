<script lang="ts">
	import { library } from '$lib/library.svelte';
	import { UNKNOWN_PUBLISHER } from '$lib/types';
	import type { Issue, Series } from '$lib/types';
	import { publisherColor } from '$lib/parse/publishers';
	import Icon from './Icon.svelte';
	import ProgressBar from './ProgressBar.svelte';

	/**
	 * Home hero: blurred cover backdrop, sharp 2:3 cover on the left, text on the right (stacked on phones).
	 * mode 'continue' resumes `issue` (number, "Sida X av Y", progress bar); mode 'start' introduces `series`
	 * (recommendation `note`, description, "Läs nr N").
	 */
	let {
		series,
		issue,
		mode,
		note
	}: { series: Series; issue?: Issue; mode: 'continue' | 'start'; note?: string } = $props();

	/** The issue the primary button opens. */
	const target = $derived(issue ?? series.issues.find((i) => i.id === series.nextIssueId) ?? series.issues[0]);
	const coverUrl = $derived(
		mode === 'continue'
			? (library.coverUrl(target?.id) ?? library.coverUrl(series.coverIssueId))
			: (library.coverUrl(series.coverIssueId) ?? library.coverUrl(target?.id))
	);
	const bg = $derived(coverUrl ? `url("${coverUrl}")` : undefined);

	const progress = $derived(target ? library.progressOf(target.id) : undefined);
	const pageCount = $derived(progress?.pageCount || target?.pageCount || 0);
	const pageNo = $derived(progress ? Math.min(progress.page + 1, pageCount || progress.page + 1) : 0);
	const fraction = $derived(pageCount ? Math.min(1, pageNo / pageCount) : 0);
	const issueLine = $derived(
		[
			target?.number != null ? `Nummer ${target.number}` : target?.title,
			pageNo && pageCount ? `Sida ${pageNo} av ${pageCount}` : undefined
		]
			.filter(Boolean)
			.join(' · ')
	);
	const ctaLabel = $derived(
		mode === 'continue' ? 'Fortsätt läsa' : target?.number != null && !series.oneShot ? `Läs nr ${target.number}` : 'Läs'
	);
	const genres = $derived(series.genres.slice(0, 3));
	const showPublisher = $derived(series.publisher !== UNKNOWN_PUBLISHER);
</script>

<section class="hero" aria-labelledby="hero-title" style:--tint={series.color}>
	<div class="bg" style:background-image={bg} aria-hidden="true"></div>
	<div class="scrim" aria-hidden="true"></div>

	<a class="cover" href="/series/{series.id}" tabindex="-1" aria-hidden="true">
		{#if coverUrl}<img src={coverUrl} alt="" decoding="async" />{/if}
	</a>

	<div class="body">
		<p class="eyebrow">
			<Icon name={mode === 'continue' ? 'play' : 'sparkles'} size={14} />
			{mode === 'continue' ? 'Fortsätt läsa' : 'Börja läsa'}
		</p>
		<h2 id="hero-title" class="title clamp-2">{series.name}</h2>

		{#if showPublisher || genres.length}
			<div class="tags">
				{#if showPublisher}
					<a class="tag" href="/library?publisher={encodeURIComponent(series.publisher)}">
						<span class="dot" style:background={publisherColor(series.publisher)} aria-hidden="true"></span>{series.publisher}
					</a>
				{/if}
				{#each genres as g (g)}
					<a class="tag" href="/library?genre={encodeURIComponent(g)}">{g}</a>
				{/each}
			</div>
		{/if}

		{#if mode === 'continue'}
			{#if issueLine}<p class="sub">{issueLine}</p>{/if}
			<div class="progress"><ProgressBar value={fraction} height={6} /></div>
		{:else}
			{#if note}<p class="note"><Icon name="sparkles" size={14} />{note}</p>{/if}
			{#if series.description}<p class="desc clamp-3">{series.description}</p>{/if}
		{/if}

		<div class="actions">
			{#if target}
				<a class="btn btn-primary cta" href="/read/{target.id}"><Icon name="play" size={18} />{ctaLabel}</a>
			{/if}
			<a class="btn cta glass" href="/series/{series.id}">Till serien</a>
		</div>
	</div>
</section>

<style>
	.hero {
		--hero-h: clamp(300px, 42vh, 460px);
		--pad: clamp(18px, 2.8vw, 40px);
		position: relative;
		isolation: isolate;
		overflow: hidden;
		display: flex;
		align-items: center;
		gap: clamp(20px, 3.2vw, 48px);
		min-height: var(--hero-h);
		padding: var(--pad);
		border: 1px solid var(--border);
		border-radius: var(--radius-l);
		background: var(--surface);
		box-shadow: var(--shadow-card);
		animation: rise 0.55s var(--ease) both;
	}
	/* blurred, saturated cover; scaled up so the blur's soft edges stay outside the rounded clip */
	.bg {
		position: absolute;
		inset: 0;
		z-index: -2;
		background-color: var(--tint, var(--surface-3));
		background-position: center;
		background-size: cover;
		filter: blur(48px) saturate(1.5);
		transform: scale(1.3);
	}
	.scrim {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(0deg, rgb(8 10 16 / 0.5), transparent 55%),
			linear-gradient(90deg, rgb(8 10 16 / 0.92), rgb(8 10 16 / 0.66) 55%, rgb(8 10 16 / 0.42));
	}

	.cover {
		position: relative;
		flex: none;
		display: block;
		height: calc(var(--hero-h) - 2 * var(--pad));
		aspect-ratio: 2 / 3;
		border-radius: 12px;
		overflow: hidden;
		background: color-mix(in srgb, var(--tint, #3a3f55) 55%, var(--surface-2));
		box-shadow:
			0 28px 60px -12px rgb(0 0 0 / 0.65),
			0 8px 20px rgb(0 0 0 / 0.4),
			0 0 0 1px rgb(255 255 255 / 0.1);
		transition: transform 0.2s var(--ease);
	}
	.cover:active {
		transform: scale(0.97);
	}
	.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.cover::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(115deg, rgb(255 255 255 / 0.16), transparent 38%);
		pointer-events: none;
	}

	.body {
		flex: 1;
		min-width: 0;
		max-width: 64ch;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		text-shadow: 0 1px 14px rgb(0 0 0 / 0.45);
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 0.78rem;
		font-weight: 750;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent-2);
	}
	.title {
		font-size: clamp(1.75rem, 1.1rem + 2.4vw, 3rem);
		font-weight: 800;
		letter-spacing: -0.025em;
		line-height: 1.05;
		text-wrap: balance;
		overflow-wrap: anywhere;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.tag {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 32px;
		padding: 0 13px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.1);
		border: 1px solid rgb(255 255 255 / 0.16);
		font-size: 0.85rem;
		font-weight: 600;
		color: rgb(255 255 255 / 0.92);
		text-shadow: none;
		transition: background 0.15s;
	}
	.tag::after {
		/* grows the tap area to ≥ 44px without changing the look */
		content: '';
		position: absolute;
		inset: -6px -2px;
	}
	.tag:hover {
		background: rgb(255 255 255 / 0.18);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
	.sub {
		font-size: 1rem;
		font-weight: 600;
		color: rgb(255 255 255 / 0.86);
		font-variant-numeric: tabular-nums;
	}
	.progress {
		width: min(380px, 100%);
	}
	.note {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--accent-2);
	}
	.desc {
		max-width: 60ch;
		font-size: 1rem;
		line-height: 1.5;
		color: rgb(255 255 255 / 0.82);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 6px;
		text-shadow: none;
	}
	.cta {
		min-height: 48px;
		padding-inline: 22px;
		font-size: 1rem;
	}
	.glass {
		background: rgb(255 255 255 / 0.12);
		border-color: rgb(255 255 255 / 0.2);
		color: #fff;
	}
	.glass:hover {
		background: rgb(255 255 255 / 0.2);
	}

	@media (max-width: 640px) {
		.hero {
			flex-direction: column;
			min-height: 0;
			gap: 18px;
			padding: 22px 18px 24px;
			text-align: center;
		}
		.scrim {
			background: linear-gradient(180deg, rgb(8 10 16 / 0.5), rgb(8 10 16 / 0.88));
		}
		.cover {
			height: 210px;
		}
		.body {
			align-items: center;
			max-width: none;
			width: 100%;
		}
		.tags,
		.actions {
			justify-content: center;
		}
		.progress {
			width: 100%;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}
</style>
