<script lang="ts">
	import { untrack } from 'svelte';
	import Sheet from './Sheet.svelte';
	import { library } from '$lib/library.svelte';
	import { toast } from '$lib/toast.svelte';
	import { normalizePublisher } from '$lib/parse/publishers';
	import { UNKNOWN_PUBLISHER } from '$lib/types';
	import type { Series, SeriesMeta } from '$lib/types';

	/** "Redigera uppgifter": name, publisher, genres (comma separated), description → library.setSeriesMeta (marks the meta userEdited). */
	let { open, series, onclose }: { open: boolean; series: Series; onclose: () => void } = $props();

	const FORM = 'edit-series-form';
	const parseList = (s: string) => {
		const seen = new Set<string>();
		return s
			.split(/[,;\n]/)
			.map((x) => x.trim())
			.filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
	};

	let name = $state('');
	let publisher = $state('');
	let genres = $state('');
	let description = $state('');
	let initial = { name: '', publisher: '', genres: '', description: '' };

	// Fill the form from the series each time the sheet opens.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			initial = {
				name: series.name,
				publisher: series.publisher === UNKNOWN_PUBLISHER ? '' : series.publisher,
				genres: series.genres.join(', '),
				description: series.description ?? ''
			};
			({ name, publisher, genres, description } = initial);
		});
	});

	const publishers = $derived(library.facets.publishers.map((f) => f.value).filter((p) => p !== UNKNOWN_PUBLISHER));

	function save(e: SubmitEvent) {
		e.preventDefault();
		// Only send what changed; an emptied field falls back to the automatic value.
		const patch: Partial<SeriesMeta> = {};
		if (name.trim() !== initial.name.trim()) patch.name = name.trim() || undefined;
		if (publisher.trim() !== initial.publisher.trim()) patch.publisher = normalizePublisher(publisher.trim());
		const g = parseList(genres);
		if (g.join('\n') !== parseList(initial.genres).join('\n')) patch.genres = g;
		if (description.trim() !== initial.description.trim()) patch.description = description.trim() || undefined;
		if (Object.keys(patch).length) {
			library.setSeriesMeta(series.id, patch);
			toast.show('Uppgifterna sparades', { kind: 'ok' });
		}
		onclose();
	}
</script>

<Sheet {open} title="Redigera uppgifter" {onclose}>
	<form id={FORM} class="form" onsubmit={save}>
		<label class="field">
			<span>Namn</span>
			<input bind:value={name} autocomplete="off" />
		</label>
		<label class="field">
			<span>Förlag</span>
			<input bind:value={publisher} list="edit-series-publishers" placeholder="Okänt förlag" autocomplete="off" />
			<datalist id="edit-series-publishers">
				{#each publishers as p (p)}<option value={p}></option>{/each}
			</datalist>
		</label>
		<label class="field">
			<span>Genrer</span>
			<input bind:value={genres} placeholder="Sci-fi, Äventyr, Superhjältar" autocomplete="off" />
			<small>Separera med komma.</small>
		</label>
		<label class="field">
			<span>Beskrivning</span>
			<textarea rows="6" bind:value={description}></textarea>
		</label>
	</form>
	{#snippet footer()}
		<button type="button" class="btn" onclick={onclose}>Avbryt</button>
		<button type="submit" form={FORM} class="btn btn-primary">Spara</button>
	{/snippet}
</Sheet>

<style>
	.form {
		display: grid;
		gap: 16px;
	}
	.field {
		display: grid;
		gap: 6px;
	}
	.field > span {
		font-size: 0.86rem;
		font-weight: 650;
		color: var(--text-dim);
	}
	.field small {
		color: var(--text-faint);
		font-size: 0.8rem;
	}
	input,
	textarea {
		width: 100%;
		min-height: 48px;
		padding: 10px 14px;
		border-radius: 12px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		line-height: 1.45;
	}
	textarea {
		resize: vertical;
		min-height: 120px;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--accent) 70%, transparent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
	}
</style>
