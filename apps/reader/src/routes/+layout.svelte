<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { library } from '$lib/library.svelte';
	import { ui } from '$lib/ui.svelte';
	import { toast } from '$lib/toast.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import AddSheet from '$lib/components/AddSheet.svelte';
	import ScanBanner from '$lib/components/ScanBanner.svelte';

	let { children } = $props();
	let q = $state('');
	let install = $state<Event & { prompt: () => Promise<void> } | null>(null);
	const nav = [{ href:'/', label:'Hem', icon:'home' as const }, { href:'/library', label:'Bibliotek', icon:'library' as const }, { href:'/publishers', label:'Förlag', icon:'building' as const }, { href:'/reading-orders', label:'Läsordningar', icon:'library' as const }, { href:'/settings', label:'Inställningar', icon:'settings' as const }];
	const isRead = $derived(page.url.pathname.startsWith('/read/'));
	const active = (href: string) => href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	function search() { if (q.trim()) goto(`/library?q=${encodeURIComponent(q.trim())}`); }
	onMount(() => {
		void library.init();
		const before = (e: Event) => { e.preventDefault(); ui.installEvent = e as Event & { prompt: () => Promise<void> }; install = ui.installEvent; };
		const installed = () => { ui.installEvent = null; install = null; };
		addEventListener('beforeinstallprompt', before); addEventListener('appinstalled', installed);
		return () => { removeEventListener('beforeinstallprompt', before); removeEventListener('appinstalled', installed); };
	});
	async function installApp() { if (!install) return; await install.prompt(); install = null; ui.installEvent = null; }
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if isRead}{@render children?.()}{:else}
	<div class="app-shell" style:--card-min="{library.settings.cardSize}px">
		<aside class="rail"><a class="brand" href="/" aria-label="SuperLight Reader"><span>SL</span><strong>SuperLight</strong></a><nav>{#each nav as item}<a href={item.href} class:active={active(item.href)}><Icon name={item.icon} size={21} /><span>{item.label}</span></a>{/each}</nav><button class="btn btn-primary add" type="button" onclick={() => ui.addOpen = true}><Icon name="plus" size={20} /> Lägg till</button></aside>
		<header class="topbar">{#if !page.url.pathname.startsWith('/library')}<form onsubmit={(e) => { e.preventDefault(); search(); }}><Icon name="search" size={19} /><input bind:value={q} aria-label="Sök" placeholder="Sök serier, förlag, genre…" /></form>{/if}{#if install}<button class="chip" type="button" onclick={installApp}>Installera</button>{/if}</header>
		{#if library.unlinked > 0 && !library.scan.active && library.issues.length}<div class="relink"><Icon name="cloud-off" size={17} /><span>{library.unlinked} nummer är inte länkade till filer</span><button class="btn btn-ghost" type="button" onclick={() => library.pick('folder')}>Välj mapp</button></div>{/if}
		<main>{@render children?.()}</main>
		<nav class="bottom-nav">{#each nav as item}<a href={item.href} class:active={active(item.href)} aria-label={item.label}><Icon name={item.icon} size={21} /><span>{item.label}</span></a>{/each}<button class="add-fab" type="button" aria-label="Lägg till serier" onclick={() => ui.addOpen = true}><Icon name="plus" size={23} /></button></nav>
	</div>
	<ScanBanner /><AddSheet open={ui.addOpen} onclose={() => ui.addOpen = false} />
	<div class="toasts" aria-live="polite">{#each toast.items as item (item.id)}<div class:item-error={item.kind === 'error'} class:item-ok={item.kind === 'ok'}>{item.message}{#if item.action}<button type="button" onclick={item.action.run}>{item.action.label}</button>{/if}<button type="button" aria-label="Stäng" onclick={() => toast.dismiss(item.id)}>×</button></div>{/each}</div>
{/if}

<style>
	.app-shell { min-height:100dvh; }.rail { position:fixed; inset:0 auto 0 0; z-index:40; display:flex; width:var(--nav-w); flex-direction:column; padding:20px 10px; border-right:1px solid var(--border); background:var(--bg-raised); }.brand { display:grid; justify-items:center; gap:7px; margin-bottom:28px; font-size:.74rem; text-align:center; }.brand span { display:grid; place-items:center; width:42px; height:42px; border-radius:13px; background:linear-gradient(135deg,var(--accent),var(--accent-2)); color:var(--accent-ink); font-weight:900; }.rail nav { display:grid; gap:6px; }.rail nav a,.bottom-nav a { display:grid; justify-items:center; gap:4px; padding:9px 4px; border-radius:10px; color:var(--text-dim); font-size:.72rem; }.rail nav a:hover,.rail nav a.active,.bottom-nav a.active { color:var(--text); background:var(--surface); }.rail nav a.active { color:var(--accent-2); }.add { margin-top:auto; min-height:44px; padding:0 8px; font-size:.78rem; }.topbar { position:sticky; top:0; z-index:30; display:flex; align-items:center; justify-content:space-between; gap:12px; height:var(--topbar-h); padding:8px var(--gutter); margin-left:var(--nav-w); border-bottom:1px solid var(--border); background:color-mix(in srgb,var(--bg) 84%,transparent); backdrop-filter:blur(14px); }.topbar form { display:flex; align-items:center; gap:8px; width:min(560px,100%); color:var(--text-dim); }.topbar input { width:100%; border:0; outline:0; background:transparent; }.relink { display:flex; align-items:center; gap:10px; margin-left:var(--nav-w); padding:9px var(--gutter); background:color-mix(in srgb,var(--warn) 12%,var(--bg)); color:var(--text-dim); font-size:.9rem; }.relink .btn { margin-left:auto; min-height:36px; }.bottom-nav { display:none; }.toasts { position:fixed; right:20px; top:75px; z-index:120; display:grid; gap:8px; width:min(390px,calc(100vw - 40px)); }.toasts>div { display:flex; align-items:center; gap:10px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); box-shadow:var(--shadow-pop); }.toasts button:last-child { margin-left:auto; font-size:1.2rem; }.item-ok { border-color:color-mix(in srgb,var(--ok) 55%,transparent)!important; }.item-error { border-color:color-mix(in srgb,var(--danger) 55%,transparent)!important; }main { min-height:calc(100dvh - var(--topbar-h)); margin-left:var(--nav-w); }
	@media(max-width:899px){.rail{display:none}.topbar,main{margin-left:0}.topbar{height:56px}.bottom-nav{position:fixed; inset:auto 0 0; z-index:50; display:flex; align-items:center; justify-content:space-around; height:var(--nav-h); padding:4px 4px var(--safe-b); border-top:1px solid var(--border); background:color-mix(in srgb,var(--bg-raised) 92%,transparent); backdrop-filter:blur(14px)}.bottom-nav a{min-width:58px}.add-fab{display:grid;place-items:center;width:50px;height:50px;margin-top:-26px;border:4px solid var(--bg);border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--accent-ink)}.relink{margin-left:0}.toasts{right:10px;top:64px;width:calc(100vw - 20px)}}
</style>
