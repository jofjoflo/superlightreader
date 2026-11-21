<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One row inside a settings card: label + help text on the left, control (`children`) on the right.
	 * The control wraps below the text on narrow widths (always with `stack`). `children` receives the id of the
	 * label element so the control can use aria-labelledby.
	 */
	let {
		label,
		help,
		stack = false,
		children
	}: { label: string; help?: string; stack?: boolean; children?: Snippet<[string]> } = $props();

	const uid = $props.id();
</script>

<div class="row" class:stack>
	<div class="txt">
		<div class="label" id="{uid}-l">{label}</div>
		{#if help}<p class="help">{help}</p>{/if}
	</div>
	{#if children}<div class="ctl">{@render children(`${uid}-l`)}</div>{/if}
</div>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 24px;
		padding: 14px 18px;
		min-height: 64px;
		border-top: 1px solid var(--border);
	}
	.txt {
		flex: 1 1 240px;
		min-width: 0;
	}
	.label {
		font-weight: 650;
	}
	.help {
		margin-top: 2px;
		max-width: 62ch;
		font-size: 0.88rem;
		line-height: 1.4;
		color: var(--text-dim);
	}
	.ctl {
		display: flex;
		flex: 0 1 auto;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 10px;
		min-width: 0;
		max-width: 100%;
	}
	.stack .ctl {
		flex-basis: 100%;
		justify-content: flex-start;
	}
</style>
