<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IconName } from './Icon.svelte';
	import Icon from './Icon.svelte';

	/** Centered empty/error state: big dim icon in a soft circle, title (.h2), muted text (max-width 44ch), then `children` (buttons). */
	let { icon = 'book', title, text, children }: { icon?: IconName; title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="empty"><span class="empty-icon"><Icon name={icon} size={34} /></span><h2 class="h2">{title}</h2>{#if text}<p class="muted">{text}</p>{/if}{#if children}<div class="empty-actions">{@render children()}</div>{/if}</div>

<style>
	.empty { display:grid; justify-items:center; gap:12px; max-width:44ch; margin:clamp(40px,10vh,120px) auto; text-align:center; }
	.empty-icon { display:grid; place-items:center; width:76px; height:76px; border-radius:50%; color:var(--text-dim); background:var(--surface); }
	.empty p { line-height:1.6; }
	.empty-actions { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; margin-top:8px; }
</style>
