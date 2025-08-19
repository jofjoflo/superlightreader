<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { readCbz, createPageUrl, cleanupUrls, type ComicPage } from '$lib/archive';
	import { mimeFor } from '$lib/mime';
	import { checkImageSupport } from '$lib/imageSupport';
	import { loadSettings, saveSettings, type ReaderSettings } from '$lib/settings';

	// State
	let pages: ComicPage[] = [];
	let pageUrls: string[] = [];
	let currentPageIndex = 0;
	let isLoading = false;
	let error = '';
	let settings: ReaderSettings;
	let imageSupport: any = {};
	let showWarning = false;

	// File input reference
	let fileInput: HTMLInputElement;

	// Prefetch cache
	let prefetchedUrls = new Map<number, string>();

	onMount(async () => {
		settings = await loadSettings();
		imageSupport = await checkImageSupport();
		
		// Show warning if AVIF is not supported
		if (!imageSupport.avif) {
			showWarning = true;
			console.warn('AVIF support not detected. AVIF images may not display properly.');
		}
	});

	onDestroy(() => {
		cleanup();
	});

	function cleanup() {
		cleanupUrls(pageUrls);
		pageUrls = [];
		
		// Clean up prefetch cache
		for (const url of prefetchedUrls.values()) {
			URL.revokeObjectURL(url);
		}
		prefetchedUrls.clear();
	}

	async function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		
		if (!file) return;
		
		const fileName = file.name.toLowerCase();
		if (!fileName.endsWith('.cbz') && !fileName.endsWith('.cbr')) {
			error = 'Please select a CBZ or CBR file';
			return;
		}

		await loadComic(file);
	}

	async function loadComic(file: File) {
		isLoading = true;
		error = '';
		cleanup();

		try {
			pages = await readCbz(file);
			
			if (pages.length === 0) {
				error = 'No images found in the CBZ file';
				return;
			}

			// Create URLs for visible pages
			pageUrls = pages.map((page) => createPageUrl(page, mimeFor(page.name)));
			currentPageIndex = 0;

			// Start prefetching
			prefetchPages();

		} catch (err) {
			error = `Failed to load comic: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			isLoading = false;
		}
	}

	function prefetchPages() {
		const start = Math.max(0, currentPageIndex - 1);
		const end = Math.min(pages.length, currentPageIndex + settings.maxPrefetchPages + 1);

		for (let i = start; i < end; i++) {
			if (!prefetchedUrls.has(i) && i < pages.length) {
				const url = createPageUrl(pages[i], mimeFor(pages[i].name));
				prefetchedUrls.set(i, url);
				
				// Preload the image
				const img = new Image();
				img.src = url;
			}
		}
	}

	function goToPage(index: number) {
		if (index >= 0 && index < pages.length) {
			currentPageIndex = index;
			prefetchPages();
		}
	}

	function nextPage() {
		goToPage(currentPageIndex + 1);
	}

	function prevPage() {
		goToPage(currentPageIndex - 1);
	}

	function handleKeydown(event: KeyboardEvent) {
		switch (event.code) {
			case 'ArrowRight':
			case 'Space':
				event.preventDefault();
				nextPage();
				break;
			case 'ArrowLeft':
				event.preventDefault();
				prevPage();
				break;
			case 'Home':
				event.preventDefault();
				goToPage(0);
				break;
			case 'End':
				event.preventDefault();
				goToPage(pages.length - 1);
				break;
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const files = event.dataTransfer?.files;
		
		if (files && files.length > 0) {
			const file = files[0];
			const fileName = file.name.toLowerCase();
			if (fileName.endsWith('.cbz') || fileName.endsWith('.cbr')) {
				loadComic(file);
			} else {
				error = 'Please drop a CBZ or CBR file';
			}
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
	}

	$: currentPage = pages[currentPageIndex];
	$: currentUrl = pageUrls[currentPageIndex];
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
	<header>
		<h1>AVIF Comic Reader</h1>
		
		{#if showWarning}
			<div class="warning">
				⚠️ AVIF support not detected. Some images may not display properly.
			</div>
		{/if}

		<div class="controls">
			<input 
				bind:this={fileInput}
				type="file" 
				accept=".cbz,.cbr" 
				onchange={handleFileSelect}
				style="display: none"
			/>
			
			<button onclick={() => fileInput.click()}>
				Choose CBZ/CBR File
			</button>

			{#if pages.length > 0}
				<div class="page-navigation">
					<button onclick={prevPage} disabled={currentPageIndex === 0}>
						Previous
					</button>
					
					<span class="page-info">
						Page {currentPageIndex + 1} of {pages.length}
					</span>
					
					<button onclick={nextPage} disabled={currentPageIndex === pages.length - 1}>
						Next
					</button>
				</div>
			{/if}
		</div>
	</header>

	<div 
		class="drop-zone" 
		class:has-content={pages.length > 0}
		ondrop={handleDrop} 
		ondragover={handleDragOver}
		role="button"
		tabindex="0"
		aria-label="Drop CBZ or CBR file here"
	>
		{#if isLoading}
			<div class="loading">Loading comic...</div>
		{:else if error}
			<div class="error">{error}</div>
		{:else if pages.length === 0}
			<div class="placeholder">
				<p>Drop a CBZ or CBR file here or click "Choose CBZ/CBR File" to start reading</p>
			</div>
		{:else}
			<div class="reader">
				{#if currentUrl && currentPage}
					<img 
						src={currentUrl} 
						alt={`Page ${currentPageIndex + 1}`}
						class="page-image"
						class:fit-width={settings.fitMode === 'width'}
						class:fit-height={settings.fitMode === 'height'}
						class:fit-both={settings.fitMode === 'both'}
						loading="eager"
					/>
				{/if}
			</div>
		{/if}
	</div>

	{#if pages.length > 0}
		<footer>
			<div class="format-info">
				Current: {currentPage?.name} ({mimeFor(currentPage?.name || '')})
			</div>
			
			<div class="support-info">
				Format Support: 
				<span class:supported={imageSupport.avif}>AVIF</span> |
				<span class:supported={imageSupport.webp}>WebP</span> |
				<span class="supported">JPEG/PNG</span>
			</div>
		</footer>
	{/if}
</main>

<style>
	main {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background-color: var(--bg-color, #1a1a1a);
		color: var(--text-color, #ffffff);
	}

	header {
		padding: 1rem;
		background-color: rgba(0, 0, 0, 0.8);
		border-bottom: 1px solid #333;
	}

	h1 {
		margin: 0 0 1rem 0;
		font-size: 1.5rem;
	}

	.warning {
		background-color: #ff6b35;
		color: white;
		padding: 0.5rem 1rem;
		border-radius: 4px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.controls {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.page-navigation {
		display: flex;
		gap: 1rem;
		align-items: center;
	}

	.page-info {
		font-weight: 500;
		min-width: 120px;
		text-align: center;
	}

	button {
		background-color: #0066cc;
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.9rem;
	}

	button:hover:not(:disabled) {
		background-color: #0052a3;
	}

	button:disabled {
		background-color: #666;
		cursor: not-allowed;
	}

	.drop-zone {
		flex: 1;
		min-height: 400px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed #666;
		margin: 1rem;
		border-radius: 8px;
		transition: border-color 0.2s;
	}

	.drop-zone:not(.has-content):hover {
		border-color: #0066cc;
	}

	.drop-zone.has-content {
		border: none;
		margin: 0;
		min-height: 0;
	}

	.placeholder {
		text-align: center;
		color: #999;
		font-size: 1.1rem;
	}

	.loading, .error {
		text-align: center;
		font-size: 1.1rem;
	}

	.error {
		color: #ff6b35;
	}

	.reader {
		display: flex;
		justify-content: center;
		align-items: center;
		width: 100%;
		padding: 1rem;
	}

	.page-image {
		max-width: 100%;
		max-height: 90vh;
		object-fit: contain;
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.page-image.fit-width {
		width: 100%;
		height: auto;
		max-height: none;
	}

	.page-image.fit-height {
		height: 90vh;
		width: auto;
		max-width: none;
	}

	.page-image.fit-both {
		width: 100%;
		height: 90vh;
		object-fit: contain;
	}

	footer {
		padding: 1rem;
		background-color: rgba(0, 0, 0, 0.8);
		border-top: 1px solid #333;
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.9rem;
		color: #ccc;
	}

	.support-info span {
		color: #ff6b35;
	}

	.support-info span.supported {
		color: #4caf50;
	}

	@media (max-width: 768px) {
		.controls {
			flex-direction: column;
			gap: 0.5rem;
			align-items: stretch;
		}

		.page-navigation {
			justify-content: center;
		}

		footer {
			flex-direction: column;
			gap: 0.5rem;
			text-align: center;
		}

		.page-image {
			max-height: 70vh;
		}
	}
</style>
