<script lang="ts">
	/** Thin rounded progress track. value 0..1 (clamped). Fill uses the accent gradient. */
	let { value, height = 4, class: cls = '' }: { value: number; height?: number; class?: string } = $props();
</script>

	<div class={`progress ${cls}`} style:height="{height}px" role="progressbar" aria-valuenow={Math.round(Math.max(0, Math.min(1, value)) * 100)} aria-valuemin="0" aria-valuemax="100"><span style:width="{Math.max(0, Math.min(1, value)) * 100}%"></span></div>

<style>
	.progress { overflow: hidden; width: 100%; border-radius: 999px; background: var(--surface-3); }
	.progress span { display:block; height:100%; border-radius:inherit; background: linear-gradient(90deg,var(--accent),var(--accent-2)); transition: width .2s var(--ease); }
</style>
