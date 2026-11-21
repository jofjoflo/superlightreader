<script lang="ts" module>
	export type IconName =
		| 'home' | 'library' | 'building' | 'settings' | 'search' | 'play' | 'heart' | 'heart-fill'
		| 'star' | 'star-fill' | 'check' | 'plus' | 'chevron-right' | 'chevron-left' | 'chevron-down'
		| 'x' | 'filter' | 'sort' | 'book' | 'download' | 'refresh' | 'fullscreen' | 'fullscreen-exit'
		| 'rtl' | 'spread' | 'zoom' | 'info' | 'folder' | 'file' | 'trash' | 'sparkles' | 'clock'
		| 'grid' | 'more' | 'link' | 'cloud-off' | 'arrow-left' | 'arrow-right' | 'edit' | 'eye'
		| 'bookmark' | 'list' | 'upload' | 'external' | 'sliders';
</script>

<script lang="ts">
	/** Small inline SVG icon set. Paths are static, so {@html} is safe here. */
	let { name, size = 24 }: { name: IconName; size?: number } = $props();
	const paths: Record<IconName, string> = {
		home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
		library: '<path d="M4 4h16v16H4z"/><path d="M8 4v16M4 8h4M4 12h4"/>',
		building: '<path d="M4 21V5l8-3 8 3v16"/><path d="M8 8h1m6 0h1M8 12h1m6 0h1M8 16h1m6 0h1M10 21v-4h4v4"/>',
		settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4V19a2 2 0 0 1-4 0v-.1a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a2 2 0 0 0-1.4-3.4H1.6a2 2 0 0 1 0-4h.1a2 2 0 0 0 1.4-3.4L3 3.8A2 2 0 1 1 5.8 1l.1.1a2 2 0 0 0 3.4-1.4V-.4a2 2 0 0 1 4 0v.1a2 2 0 0 0 3.4 1.4l.1-.1A2 2 0 1 1 19.6 3l-.1.1a2 2 0 0 0 1.4 3.4h.1a2 2 0 0 1 0 4h-.1a2 2 0 0 0-1.5 4.5Z"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', play: '<path d="m8 5 11 7-11 7z"/>',
		heart: '<path d="M20.8 8.7c0 5.4-8.8 10.3-8.8 10.3S3.2 14.1 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z"/>',
		'heart-fill': '<path fill="currentColor" stroke="none" d="M20.8 8.7c0 5.4-8.8 10.3-8.8 10.3S3.2 14.1 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z"/>',
		star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
		'star-fill': '<path fill="currentColor" stroke="none" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
		check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', 'chevron-right': '<path d="m9 18 6-6-6-6"/>', 'chevron-left': '<path d="m15 18-6-6 6-6"/>', 'chevron-down': '<path d="m6 9 6 6 6-6"/>', x: '<path d="m6 6 12 12M18 6 6 18"/>',
		filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>', sort: '<path d="M8 6h12M8 12h8M8 18h4M4 6h.01M4 12h.01M4 18h.01"/>', book: '<path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2z"/><path d="M4 5v15M6 20h13"/>', download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.7-4L3 10m0 0V4m0 6h6M4 13a8 8 0 0 0 14.7 4L21 14m0 0v6m0-6h-6"/>', fullscreen: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m18 0v5h-5"/>', 'fullscreen-exit': '<path d="M9 3v6H3m12-6v6h6M9 21v-6H3m18 0h-6v6"/>', rtl: '<path d="M20 7H4m16 5H4m16 5H4M8 4l-3 3 3 3"/>', spread: '<path d="M3 4h8v16H3zM13 4h8v16h-8z"/>', zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10.5h5M10.5 8v5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>', folder: '<path d="M3 6h7l2 2h9v11H3z"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>', trash: '<path d="M4 7h16M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14"/>', sparkles: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>', more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>', link: '<path d="m10 13 4-4m-6 8-2 2a4 4 0 0 1-6-6l3-3a4 4 0 0 1 6 0m1-3 2-2a4 4 0 0 1 6 6l-3 3a4 4 0 0 1-6 0"/>', 'cloud-off': '<path d="m1 1 22 22M17 17h3a4 4 0 0 0 0-8h-1.2A7 7 0 0 0 6.3 7.3M5 17H4a4 4 0 0 1 0-8h1"/>', 'arrow-left': '<path d="M19 12H5m6-6-6 6 6 6"/>', 'arrow-right': '<path d="M5 12h14m-6-6 6 6-6 6"/>', edit: '<path d="m4 16-1 5 5-1L20 8l-4-4zM14 6l4 4"/>', eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2"/>', bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"/>', external: '<path d="M14 4h6v6m0-6-9 9M19 13v6H5V5h6"/>', sliders: '<path d="M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-5 4v4"/>'
	};
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-icon={name}>{@html paths[name]}</svg>
