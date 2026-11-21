<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { openArchive } from '$lib/archive';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { checkImageSupport } from '$lib/imageSupport';
	import { library } from '$lib/library.svelte';
	import { attachGestures } from '$lib/reader/gestures';
	import type { GestureHost } from '$lib/reader/gestures';
	import { PageCache } from '$lib/reader/pageCache.svelte';
	import ReaderHud from '$lib/reader/ReaderHud.svelte';
	import ReaderSettings from '$lib/reader/ReaderSettings.svelte';
	import {
		lastStart,
		nextStart,
		pageLabel,
		preloadOrder,
		prevStart,
		resolveRtl,
		spreadFrom,
		spreadStartOf,
		swipeDirection,
		visualOrder,
		wantsSpread,
		zoneDirection
	} from '$lib/reader/spread';
	import type { Zone } from '$lib/reader/spread';
	import { anchorView, clampView, isZoomed, layoutPages, panBy, zoomAt } from '$lib/reader/view';
	import type { View } from '$lib/reader/view';
	import type { ComicArchive, Issue } from '$lib/types';

	type Phase = 'loading' | 'missing' | 'unsupported' | 'unlinked' | 'error' | 'ready';

	// ───────────────────────── what the store says ─────────────────────────
	const issueId = $derived(page.params.id ?? '');
	const issue = $derived(library.ready ? library.getIssue(issueId) : undefined);
	const series = $derived(issue ? library.getSeries(issue.seriesId) : undefined);
	const reader = $derived(library.settings.reader);
	const rtl = $derived(resolveRtl(reader.direction, issue?.rtl, series?.rtl));
	const backHref = $derived(issue ? `/series/${issue.seriesId}` : '/library');
	const wideSet = $derived(new Set(issue?.wide ?? []));
	const nav = $derived.by(() => {
		const list = series?.issues ?? [];
		const at = list.findIndex((i) => i.id === issueId);
		return { prev: at > 0 ? list[at - 1] : undefined, next: at >= 0 ? list[at + 1] : undefined };
	});

	/** "#20", or the label itself for "Annual 1" and the like. */
	function tagOf(it: Issue): string {
		const label = it.numberLabel?.trim();
		if (label && !/^\d+(\.\d+)?$/.test(label)) return label;
		if (it.number !== undefined) return `#${it.number}`;
		return label ? `#${label}` : '';
	}
	const heading = $derived.by(() => {
		if (!issue) return '';
		const name = series?.name ?? issue.seriesName;
		const tag = tagOf(issue);
		const title = issue.title && issue.title !== name ? issue.title : '';
		return [tag ? `${name} ${tag}` : name, title].filter(Boolean).join(' · ');
	});

	// ───────────────────────── reader state ─────────────────────────
	let stageEl = $state<HTMLDivElement>();
	let contentEl = $state<HTMLDivElement>();
	let vw = $state(0);
	let vh = $state(0);

	let phase = $state<Phase>('loading');
	let errorText = $state('');
	let relinking = $state(false);
	let relinkMiss = $state(false);
	let archive: ComicArchive | undefined;
	let cache = $state.raw<PageCache>();
	let count = $state(0);
	/** First page of the spread on screen; `shown` is the whole spread (reading order). */
	let index = $state(0);
	let shown = $state.raw<number[]>([]);
	let spreadKey = $state(0);
	let slide = $state(0);
	let ended = $state(false);
	let busy = $state(false);
	let avifOk = $state(true);
	let avifWarn = $state(false);
	let hud = $state(true);
	let settingsOpen = $state(false);
	let zoomed = $state(false);
	let fsSupported = $state(false);
	let isFs = $state(false);

	let navToken = 0;
	let openToken = 0;
	/** Where the latest navigation is heading (equals `index` once it has landed). */
	let target = 0;
	let committedPaired = false;

	const paired = $derived(wantsSpread(reader.spread, vw, vh));
	const isWide = (i: number) => wideSet.has(i) || !!cache?.isLandscape(i);
	const counter = $derived(pageLabel(shown, count));
	const failText = (i: number) =>
		!avifOk && archive?.pages[i]?.mime === 'image/avif' ? 'AVIF stöds inte i den här webbläsaren.' : 'Sidan kunde inte visas.';

	/** Pages on screen, left → right, with their pixel boxes (one shared height). */
	const boxes = $derived.by(() => {
		const order = visualOrder(shown, rtl);
		const ratios = order.map((i) => {
			const s = cache?.sizes[i];
			return s && s.h > 0 ? s.w / s.h : 0;
		});
		return { order, ...layoutPages(ratios, { w: vw, h: vh }, reader.fit) };
	});
	const contentW = $derived(boxes.content.w);
	const contentH = $derived(boxes.content.h);

	// ───────────────────────── view (zoom + pan), written straight to the DOM ─────────────────────────
	let view: View = { s: 1, x: 0, y: 0 };
	let raf = 0;
	let idleTimer = 0;
	let animateNext = false;

	const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

	function measure() {
		if (!stageEl) return;
		vw = stageEl.clientWidth;
		vh = stageEl.clientHeight;
	}

	function setView(next: View, animate = false) {
		const wasZoomed = zoomed;
		view = next;
		zoomed = isZoomed(next);
		if (zoomed && !wasZoomed && hud && !hudHeld) hideHud();
		animateNext = animate && !reducedMotion();
		if (!raf) raf = requestAnimationFrame(paint);
	}

	function paint() {
		raf = 0;
		const el = contentEl;
		if (!el) return;
		const dpr = window.devicePixelRatio || 1;
		const snap = (n: number) => Math.round(n * dpr) / dpr;
		el.style.transition = animateNext ? 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
		// Promote to a layer only while moving; dropping it afterwards lets the browser re-rasterise sharp at the new zoom.
		el.style.willChange = 'transform';
		el.style.transform = `translate3d(${snap(view.x)}px, ${snap(view.y)}px, 0) scale(${view.s})`;
		animateNext = false;
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(() => (el.style.willChange = 'auto'), 450);
	}

	/** Apply a pending transform now rather than next frame, so no frame shows new content at the old position. */
	function paintNow() {
		if (!raf) return;
		cancelAnimationFrame(raf);
		paint();
	}

	function resetView(animate = false) {
		setView(anchorView(boxes.content, { w: vw, h: vh }, rtl), animate);
	}

	function zoomBy(factor: number) {
		setView(zoomAt(view, view.s * factor, vw / 2, vh / 2, boxes.content, { w: vw, h: vh }), true);
	}

	// Layout changed (rotation, fit mode, a page finished loading): re-anchor, or keep a zoomed view inside bounds.
	$effect(() => {
		void contentW;
		void contentH;
		void vw;
		void vh;
		void rtl;
		untrack(() => {
			if (zoomed) setView(clampView(view, boxes.content, { w: vw, h: vh }));
			else resetView();
			paintNow();
		});
	});

	// ───────────────────────── controls (HUD) ─────────────────────────
	let hudTimer = 0;
	let hudHeld = false;
	function armHud() {
		window.clearTimeout(hudTimer);
		if (hud && !hudHeld && !settingsOpen) hudTimer = window.setTimeout(() => (hud = false), 3000);
	}
	function showHud() {
		hud = true;
		armHud();
	}
	function hideHud() {
		hud = false;
		window.clearTimeout(hudTimer);
	}
	function toggleHud() {
		if (hud) hideHud();
		else showHud();
	}
	function holdHud(held: boolean) {
		hudHeld = held;
		if (held) window.clearTimeout(hudTimer);
		else armHud();
	}
	function openSettings() {
		settingsOpen = true;
		window.clearTimeout(hudTimer);
	}
	let closedAt = 0;
	function closeSettings() {
		settingsOpen = false;
		closedAt = performance.now();
		armHud();
	}

	// ───────────────────────── opening an issue ─────────────────────────
	function teardown() {
		navToken++;
		window.clearTimeout(seekTimer);
		window.clearTimeout(hudTimer);
		cache?.destroy();
		cache = undefined;
		archive?.close();
		archive = undefined;
		busy = false;
		library.flushProgress();
	}

	async function open(id: string) {
		const token = ++openToken;
		teardown();
		phase = 'loading';
		errorText = '';
		ended = false;
		shown = [];
		index = 0;
		count = 0;
		target = 0;
		avifWarn = false;
		await library.init();
		if (token !== openToken) return;
		const found = library.getIssue(id);
		if (!found) {
			phase = 'missing';
			return;
		}
		if (found.unsupported) {
			phase = 'unsupported';
			return;
		}
		try {
			const file = await library.getFile(id);
			if (token !== openToken) return;
			if (!file) {
				phase = 'unlinked';
				return;
			}
			const opened = await openArchive(file);
			if (token !== openToken) {
				opened.close();
				return;
			}
			if (!opened.pages.length) {
				opened.close();
				errorText = 'Arkivet innehåller inga bilder.';
				phase = 'error';
				return;
			}
			archive = opened;
			cache = new PageCache(opened);
			count = opened.pages.length;
			void checkImageSupport().then((support) => {
				if (token !== openToken) return;
				avifOk = support.avif;
				avifWarn = !support.avif && opened.pages.some((p) => p.mime === 'image/avif');
			});
			const saved = library.progressOf(id);
			await goTo(saved && !saved.completed ? saved.page : 0, 0);
			if (token !== openToken) return;
			phase = 'ready';
			showHud();
		} catch (e) {
			if (token !== openToken) return;
			errorText = e instanceof Error && e.message ? e.message : 'Filen kunde inte öppnas.';
			phase = 'error';
		}
	}

	$effect(() => {
		const id = issueId;
		if (!id) return;
		untrack(() => void open(id));
		return () => {
			openToken++;
			teardown();
		};
	});

	/** The file is not linked to this session: let the user pick the folder again (must run inside the click). */
	function relink() {
		const picked = library.pick('folder');
		relinking = true;
		relinkMiss = false;
		void picked
			.catch(() => undefined)
			.then(() => open(issueId))
			.then(() => {
				relinking = false;
				if (phase === 'unlinked') relinkMiss = true;
			});
	}

	// ───────────────────────── navigation ─────────────────────────
	/**
	 * Show the spread containing page `request`. The old spread stays on screen until every page of the new one
	 * is decoded, so there is never a blank frame; a newer call (token) silently supersedes this one.
	 */
	async function goTo(request: number, dir: -1 | 0 | 1 = 0) {
		const c = cache;
		if (!c || !archive) return;
		measure();
		const token = ++navToken;
		const pairing = paired;
		const start = spreadStartOf(request, count, pairing, isWide);
		target = start;
		const slow = window.setTimeout(() => {
			if (token === navToken) busy = true;
		}, 200);
		try {
			// A page's width is only known once decoded, so the first two pages decide how the spread is cut.
			await c.ensure(pairing ? [start, start + 1] : [start]);
			if (token !== navToken) return;
			commit(spreadFrom(start, count, pairing, isWide), dir, pairing);
		} finally {
			window.clearTimeout(slow);
			if (token === navToken) busy = false;
		}
	}

	function commit(pages: number[], dir: -1 | 0 | 1, pairing: boolean) {
		if (!pages.length) return;
		shown = pages;
		index = pages[0];
		target = index;
		committedPaired = pairing;
		ended = false;
		slide = dir === 0 ? 0 : dir * (rtl ? -1 : 1);
		spreadKey++;
		cache?.focus(preloadOrder(pages, count, reader.preload, pairing));
		library.saveProgress(issueId, pages[pages.length - 1], count);
		void tick().then(() => {
			resetView();
			paintNow();
		});
	}

	function showEnd() {
		ended = true;
		library.saveProgress(issueId, count - 1, count);
		library.flushProgress();
	}

	/** +1 = forward in reading order, -1 = back. */
	function flip(dir: 1 | -1) {
		if (phase !== 'ready' || !archive) return;
		if (hud && !hudHeld && !settingsOpen) hideHud();
		if (ended) {
			if (dir < 0) ended = false;
			return;
		}
		if (dir > 0) {
			const next = nextStart(target, count, paired, isWide);
			if (next !== undefined) void goTo(next, 1);
			else if (target === index) showEnd(); // only once the last spread has actually landed
		} else {
			const prev = prevStart(target, count, paired, isWide);
			if (prev !== undefined) void goTo(prev, -1);
		}
	}

	function onTap(zone: Zone) {
		if (zone === 'center') {
			toggleHud();
			return;
		}
		const dir = zoneDirection(zone, rtl);
		if (dir) flip(dir);
	}

	let seekTimer = 0;
	function seek(to: number, done: boolean) {
		window.clearTimeout(seekTimer);
		if (phase !== 'ready') return;
		if (done) void goTo(to, 0);
		else seekTimer = window.setTimeout(() => void goTo(to, 0), 140);
	}

	function openIssue(it: Issue) {
		void goto(`/read/${it.id}`, { replaceState: true });
	}

	// Rotating the tablet (or changing "Uppslag") re-cuts the spreads around the page we are on.
	$effect(() => {
		const pairing = paired;
		untrack(() => {
			if (phase === 'ready' && shown.length && pairing !== committedPaired) void goTo(index, 0);
		});
	});

	// ───────────────────────── fullscreen, wake lock, keyboard ─────────────────────────
	let enteredFs = false;
	function toggleFullscreen() {
		if (!fsSupported) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => undefined);
			return;
		}
		enteredFs = true;
		void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
			enteredFs = false;
		});
	}

	$effect(() => {
		if (phase !== 'ready' || !reader.keepAwake || !('wakeLock' in navigator)) return;
		let lock: WakeLockSentinel | undefined;
		let stopped = false;
		const acquire = async () => {
			if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
			try {
				const sentinel = await navigator.wakeLock.request('screen');
				if (stopped) void sentinel.release().catch(() => undefined);
				else lock = sentinel;
			} catch {
				/* refused (battery saver, permissions policy): reading works without it */
			}
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') void acquire(); // the lock is dropped whenever the page is hidden
		};
		void acquire();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stopped = true;
			document.removeEventListener('visibilitychange', onVisible);
			void lock?.release().catch(() => undefined);
		};
	});

	function back() {
		void goto(backHref);
	}

	function onKey(e: KeyboardEvent) {
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || settingsOpen) return;
		if (e.key === 'Escape' && performance.now() - closedAt < 80) return; // that Esc just closed the settings sheet
		const t = e.target as HTMLElement | null;
		if (t?.matches?.('input, textarea, select')) return; // the slider handles its own arrows
		if (t?.closest?.('button, a') && (e.key === ' ' || e.key === 'Enter')) return; // let focused buttons activate
		if (phase !== 'ready') {
			if (e.key === 'Escape') back();
			return;
		}
		const forward = rtl ? -1 : 1;
		const overflowY = boxes.content.h * view.s > vh + 1;
		switch (e.key) {
			case 'ArrowRight':
				flip(forward);
				break;
			case 'ArrowLeft':
				flip(forward === 1 ? -1 : 1);
				break;
			case 'ArrowDown':
			case 'ArrowUp': {
				const down = e.key === 'ArrowDown';
				if (overflowY) setView(panBy(view, 0, down ? -vh * 0.4 : vh * 0.4, boxes.content, { w: vw, h: vh }).view);
				else flip(down ? 1 : -1);
				break;
			}
			case ' ':
				flip(e.shiftKey ? -1 : 1);
				break;
			case 'PageDown':
				flip(1);
				break;
			case 'PageUp':
				flip(-1);
				break;
			case 'Home':
				ended = false;
				void goTo(0, -1);
				break;
			case 'End':
				void goTo(lastStart(count, paired, isWide), 1);
				break;
			case 'Escape':
				back();
				break;
			case 'f':
			case 'F':
				toggleFullscreen();
				break;
			case 'm':
			case 'M':
				toggleHud();
				break;
			case '+':
			case '=':
				zoomBy(1.5);
				break;
			case '-':
				zoomBy(1 / 1.5);
				break;
			case '0':
				resetView(true);
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	// ───────────────────────── wiring ─────────────────────────
	const host: GestureHost = {
		state: () => ({ view, content: boxes.content, viewport: { w: vw, h: vh }, tapZones: reader.tapZones }),
		setView,
		reset: resetView,
		tap: onTap,
		swipe: (dx) => flip(swipeDirection(dx, rtl)),
		wheel: flip
	};

	onMount(() => {
		const stage = stageEl;
		if (!stage) return;
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(stage);
		const detach = attachGestures(stage, host);
		fsSupported = typeof document.documentElement.requestFullscreen === 'function';
		const onFullscreen = () => (isFs = !!document.fullscreenElement);
		const onHide = () => {
			if (document.visibilityState === 'hidden') library.flushProgress();
		};
		const flush = () => library.flushProgress();
		document.addEventListener('fullscreenchange', onFullscreen);
		document.addEventListener('visibilitychange', onHide);
		addEventListener('pagehide', flush);
		// No pull-to-refresh / back-swipe glow while reading.
		const root = document.documentElement.style;
		const overscroll = root.overscrollBehavior;
		root.overscrollBehavior = 'none';
		return () => {
			observer.disconnect();
			detach();
			document.removeEventListener('fullscreenchange', onFullscreen);
			document.removeEventListener('visibilitychange', onHide);
			removeEventListener('pagehide', flush);
			root.overscrollBehavior = overscroll;
			cancelAnimationFrame(raf);
			window.clearTimeout(idleTimer);
			window.clearTimeout(hudTimer);
			window.clearTimeout(seekTimer);
			if (enteredFs && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
		};
	});
</script>

<svelte:head><title>{heading ? `${heading} – SuperLight Reader` : 'SuperLight Reader'}</title></svelte:head>
<svelte:window onkeydown={onKey} />

<div class="reader" style:background={reader.background}>
	<div class="stage" role="application" aria-label="Serieläsare" bind:this={stageEl}>
		<div class="content" bind:this={contentEl} style:width="{boxes.content.w}px" style:height="{boxes.content.h}px">
			{#key spreadKey}
				<div class="spread" style:--slide="{slide * 28}px">
					{#each boxes.order as p, k (p)}
						{@const st = cache?.pages[p]}
						{#if st?.status === 'ready' && st.url}
							<img
								src={st.url}
								alt={`Sida ${p + 1}`}
								decoding="sync"
								draggable="false"
								style:width="{boxes.widths[k]}px"
								style:height="{boxes.height}px"
								onerror={() => cache?.markBroken(p)}
							/>
						{:else}
							<div class="ph" class:skeleton={st?.status !== 'error'} style:width="{boxes.widths[k]}px" style:height="{boxes.height}px">
								{#if st?.status === 'error'}
									<Icon name="info" size={28} />
									<p>{failText(p)}</p>
									<button class="btn" type="button" data-nogesture onclick={() => cache?.retry(p)}><Icon name="refresh" size={18} />Försök igen</button>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/key}
		</div>
	</div>

	{#if busy}
		<div class="busy" role="status" aria-label="Laddar sida"><span class="spin"></span></div>
	{/if}

	{#if zoomed && !hud && phase === 'ready'}
		<button class="zoom-reset btn" type="button" aria-label="Återställ zoom" onclick={() => resetView(true)}>
			<Icon name="zoom" size={18} />1×
		</button>
	{/if}

	{#if phase !== 'ready'}
		<div class="overlay">
			{#if phase === 'loading'}
				<div class="boot" role="status"><span class="spin big"></span><p>Öppnar…</p></div>
			{:else if phase === 'missing'}
				<EmptyState icon="book" title="Numret finns inte" text="Det finns inte längre i biblioteket.">
					<a class="btn btn-primary" href="/library">Till biblioteket</a>
				</EmptyState>
			{:else if phase === 'unsupported'}
				<EmptyState
					icon="info"
					title="Det här numret kan inte öppnas"
					text={`Arkivformatet (${issue?.unsupported ?? 'okänt'}) stöds inte av läsaren än. Konvertera filen till CBZ så fungerar den.`}
				>
					<a class="btn btn-primary" href={backHref}>Tillbaka</a>
				</EmptyState>
			{:else if phase === 'unlinked'}
				<EmptyState
					icon="cloud-off"
					title="Filen är inte länkad till den här sessionen"
					text={relinkMiss
						? 'Hittade inte filen i den valda mappen. Välj mappen där serierna ligger.'
						: 'Välj mappen där serierna ligger så hittar vi filen igen.'}
				>
					<button class="btn btn-primary" type="button" disabled={relinking} onclick={relink}>
						<Icon name="folder" size={20} />{relinking ? 'Söker…' : 'Välj mapp'}
					</button>
					<a class="btn" href={backHref}>Tillbaka</a>
				</EmptyState>
			{:else}
				<EmptyState icon="info" title="Kunde inte öppna numret" text={errorText}>
					<button class="btn btn-primary" type="button" onclick={() => open(issueId)}>Försök igen</button>
					<a class="btn" href={backHref}>Tillbaka</a>
				</EmptyState>
			{/if}
		</div>
	{:else}
		{#if ended}
			{@const next = nav.next}
			<div class="end">
				<div class="end-card" role="dialog" aria-label="Utläst">
					<span class="end-badge"><Icon name="check" size={30} /></span>
					<h2 class="h2">Utläst!</h2>
					<p class="muted">{heading}</p>
					<div class="end-actions">
						{#if next}
							<button class="btn btn-primary" type="button" onclick={() => openIssue(next)}>
								Nästa nummer: {series?.name ?? next.seriesName} {tagOf(next)}
							</button>
						{:else}
							<p class="muted">Det var det sista numret i serien.</p>
						{/if}
						<a class="btn" href={backHref}>Till serien</a>
					</div>
				</div>
			</div>
		{/if}

		<ReaderHud
			visible={hud}
			{backHref}
			title={heading}
			{counter}
			{index}
			{count}
			{rtl}
			avifWarning={avifWarn}
			hasPrev={!!nav.prev}
			hasNext={!!nav.next}
			prevTag={nav.prev ? tagOf(nav.prev) : ''}
			nextTag={nav.next ? tagOf(nav.next) : ''}
			canFullscreen={fsSupported}
			fullscreen={isFs}
			onsettings={openSettings}
			onseek={seek}
			onprevissue={() => nav.prev && openIssue(nav.prev)}
			onnextissue={() => nav.next && openIssue(nav.next)}
			onfullscreen={toggleFullscreen}
			onactivity={armHud}
			onhold={holdHud}
		/>
	{/if}

	<ReaderSettings open={settingsOpen} onclose={closeSettings} />
</div>

<style>
	.reader {
		position: fixed;
		inset: 0;
		z-index: 200;
		overflow: hidden;
		color: var(--text);
		overscroll-behavior: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.stage {
		position: absolute;
		inset: 0;
		overflow: hidden;
		touch-action: none;
		overscroll-behavior: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	/* Sized in px by layoutPages(); moved/zoomed with a transform written from script. */
	.content {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	.spread {
		display: flex;
		width: 100%;
		height: 100%;
		animation: enter 0.16s var(--ease) both;
	}
	@keyframes enter {
		from {
			opacity: 0.55;
			transform: translate3d(var(--slide, 0px), 0, 0);
		}
	}
	.spread img {
		flex: none;
		display: block;
		max-width: none;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}
	.ph {
		flex: none;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 12px;
		padding: 20px;
		text-align: center;
		color: var(--text-dim);
		background: color-mix(in srgb, var(--surface) 88%, transparent);
	}
	.ph:not(.skeleton) {
		background: var(--surface);
	}
	.ph p {
		max-width: 26ch;
	}

	.busy {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 6;
		display: grid;
		place-items: center;
		width: 52px;
		height: 52px;
		margin: -26px 0 0 -26px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--bg) 78%, transparent);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
		pointer-events: none;
	}
	.spin {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.22);
		border-top-color: var(--accent-2);
		animation: spin 0.8s linear infinite;
	}
	.spin.big {
		width: 40px;
		height: 40px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.zoom-reset {
		position: absolute;
		z-index: 7;
		right: max(14px, env(safe-area-inset-right));
		bottom: max(14px, env(safe-area-inset-bottom));
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 24px;
		overflow: auto;
		background: var(--bg);
	}
	.boot {
		display: grid;
		justify-items: center;
		gap: 14px;
		color: var(--text-dim);
	}

	/* "Utläst!" card: the wrapper lets taps through to the page (left side = back), the card itself is solid. */
	.end {
		position: absolute;
		inset: 0;
		z-index: 8;
		display: grid;
		place-items: center;
		padding: 24px;
		background: color-mix(in srgb, var(--bg) 58%, transparent);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		pointer-events: none;
	}
	.end-card {
		display: grid;
		justify-items: center;
		gap: 14px;
		width: min(420px, 100%);
		padding: 28px 24px;
		text-align: center;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-l);
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		box-shadow: var(--shadow-pop);
		pointer-events: auto;
		animation: pop 0.24s var(--ease) both;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.97);
		}
	}
	.end-badge {
		display: grid;
		place-items: center;
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		color: var(--accent-ink);
	}
	.end-actions {
		display: grid;
		gap: 10px;
		width: 100%;
	}
	.end-actions .btn {
		height: auto;
		padding-block: 10px;
		white-space: normal;
		text-align: center;
	}

	@media (prefers-reduced-motion: reduce) {
		.spread,
		.end-card {
			animation: none;
		}
	}
</style>
