<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Modal: bottom sheet on narrow screens (<700px), centered dialog (max-width ~560px) on wide screens.
	 * Backdrop click / Escape / ✕ button call `onclose`. Locks body scroll while open. Focus moves into the sheet and
	 * returns on close. Slide/fade transition (respect reduced motion). Content scrolls inside (max-height 85dvh).
	 * Render nothing when !open. `footer` snippet is a sticky action row.
	 */
	let {
		open,
		title,
		onclose,
		children,
		footer
	}: { open: boolean; title?: string; onclose: () => void; children: Snippet; footer?: Snippet } = $props();
	let dialog = $state<HTMLDivElement>();
	let previous: HTMLElement | null = null;
	$effect(() => {
		if (!open) return;
		previous = document.activeElement as HTMLElement;
		document.body.style.overflow = 'hidden';
		queueMicrotask(() => dialog?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex]')?.focus());
		return () => { document.body.style.overflow = ''; previous?.focus(); };
	});
	const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') onclose(); };
</script>

<svelte:window onkeydown={keydown} />

{#if open}
	<div class="backdrop" role="presentation" onclick={(e) => e.currentTarget === e.target && onclose()}>
		<div class="sheet" bind:this={dialog} role="dialog" aria-modal="true" aria-labelledby={title ? 'sheet-title' : undefined}>
			<header>{#if title}<h2 id="sheet-title" class="h2">{title}</h2>{/if}<button class="btn btn-icon btn-ghost" type="button" aria-label="Stäng" onclick={onclose}>×</button></header>
			<div class="sheet-body">{@render children()}</div>{#if footer}<footer>{@render footer()}</footer>{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:20px; background:rgba(3,5,10,.74); backdrop-filter:blur(7px); animation:fade .16s ease; }.sheet { width:min(560px,100%); max-height:85dvh; overflow:hidden; border:1px solid var(--border-strong); border-radius:var(--radius-l); background:var(--bg-raised); box-shadow:var(--shadow-pop); animation:up .2s var(--ease); }.sheet header,.sheet footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px; border-bottom:1px solid var(--border); }.sheet footer { border-top:1px solid var(--border); border-bottom:0; justify-content:flex-end; }.sheet-body { max-height:calc(85dvh - 120px); overflow:auto; padding:20px; }@media(max-width:699px){.backdrop{align-items:end;padding:0}.sheet{border-radius:var(--radius-l) var(--radius-l) 0 0;max-height:88dvh}}@keyframes fade{from{opacity:0}}@keyframes up{from{transform:translateY(18px);opacity:0}}
</style>
