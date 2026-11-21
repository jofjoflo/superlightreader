import type { ComicArchive } from '../types.ts';

export interface PageState {
	status: 'loading' | 'ready' | 'error';
	/** Object URL, present when ready. Revoked as soon as the page leaves the window. */
	url?: string;
}
export interface PageSize {
	w: number;
	h: number;
}
interface Entry {
	/** Set when evicted/destroyed/failed: late async work must not publish or leak a URL. */
	dead: boolean;
	url?: string;
	/** Detached <img> kept alive so the browser keeps the decoded bitmap until the page leaves the window. */
	img?: HTMLImageElement;
	promise: Promise<void>;
}

function decodeImage(img: HTMLImageElement): Promise<void> {
	if (typeof img.decode === 'function') return img.decode();
	return new Promise((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('decode'));
	});
}

/**
 * Object URLs + pre-decoded images for a sliding window of pages. Everything outside the window is revoked
 * (tablets run out of memory otherwise) and `destroy()` revokes the rest. Loading never rejects: a page that
 * cannot be read or decoded ends up as `status: 'error'`.
 */
export class PageCache {
	/** Reactive state of the pages currently in the window. */
	pages = $state.raw<Record<number, PageState>>({});
	/** Natural sizes ever decoded; kept after eviction because wide-page detection needs them. */
	sizes = $state.raw<Record<number, PageSize>>({});

	#archive: ComicArchive;
	#entries = new Map<number, Entry>();
	#run = 0;
	#destroyed = false;

	constructor(archive: ComicArchive) {
		this.#archive = archive;
	}

	/** Wider than tall (only known once the page has been decoded). */
	isLandscape(index: number): boolean {
		const s = this.sizes[index];
		return !!s && s.w > s.h;
	}

	/** Load + decode one page now (idempotent). Resolves when it is ready or has failed. */
	load(index: number): Promise<void> {
		if (this.#destroyed || index < 0 || index >= this.#archive.pages.length) return Promise.resolve();
		const known = this.#entries.get(index);
		if (known) return known.promise;
		const entry: Entry = { dead: false, promise: Promise.resolve() };
		this.#entries.set(index, entry);
		this.#set(index, { status: 'loading' });
		entry.promise = this.#fetch(index, entry);
		return entry.promise;
	}

	ensure(indices: number[]): Promise<void> {
		return Promise.all(indices.map((i) => this.load(i))).then(() => undefined);
	}

	/**
	 * Keep exactly `order` (most urgent first): evict everything else, then load what is missing one page at a
	 * time. A later call supersedes the loop of an earlier one.
	 */
	focus(order: number[]): void {
		if (this.#destroyed) return;
		const keep = new Set(order);
		for (const i of [...this.#entries.keys()]) if (!keep.has(i)) this.#evict(i);
		const run = ++this.#run;
		void (async () => {
			for (const i of order) {
				if (run !== this.#run || this.#destroyed) return;
				await this.load(i);
			}
		})();
	}

	retry(index: number): Promise<void> {
		const e = this.#entries.get(index);
		if (e) {
			this.#entries.delete(index);
			this.#free(e);
		}
		return this.load(index);
	}

	/** The <img> for a ready page failed to display after all. */
	markBroken(index: number): void {
		const e = this.#entries.get(index);
		if (e) this.#free(e);
		this.#set(index, { status: 'error' });
	}

	destroy(): void {
		this.#destroyed = true;
		this.#run++;
		for (const e of this.#entries.values()) this.#free(e);
		this.#entries.clear();
		this.pages = {};
	}

	async #fetch(index: number, e: Entry): Promise<void> {
		try {
			const blob = await this.#archive.readPage(index);
			if (e.dead) return;
			const url = URL.createObjectURL(blob);
			e.url = url;
			const img = new Image();
			e.img = img;
			img.src = url;
			await decodeImage(img);
			if (e.dead) return;
			this.sizes = { ...this.sizes, [index]: { w: img.naturalWidth, h: img.naturalHeight } };
			this.#set(index, { status: 'ready', url });
		} catch {
			if (e.dead) return;
			this.#free(e);
			this.#set(index, { status: 'error' });
		}
	}

	#set(index: number, state: PageState) {
		this.pages = { ...this.pages, [index]: state };
	}

	#evict(index: number) {
		const e = this.#entries.get(index);
		if (!e) return;
		this.#entries.delete(index);
		this.#free(e);
		const next = { ...this.pages };
		delete next[index];
		this.pages = next;
	}

	#free(e: Entry) {
		e.dead = true;
		if (e.url) URL.revokeObjectURL(e.url);
		e.url = undefined;
		e.img = undefined;
	}
}
