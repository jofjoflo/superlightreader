/** Genre labels arrive in many spellings (ComicInfo, Wikipedia, Open Library, Swedish…). Normalise to one display label; drop generic ones. */

const squash = (s: string) =>
	s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Says nothing about taste – every item here is a comic. */
const GENERIC = new Set(
	[
		'comic', 'comics', 'comic book', 'comic books', 'comic strip', 'comic strips', 'comic books strips', 'comics graphic novels',
		'graphic novel', 'graphic novels', 'fiction', 'juvenile fiction', 'juvenile literature', 'cartoons', 'american comics',
		'british comics', 'comics of the united states', 'manga series', 'webcomic', 'serier', 'tecknade serier', 'serietidning'
	].map(squash)
);

const LABELS: Record<string, string[]> = {
	'Sci-Fi': ['science fiction', 'sci fi', 'scifi', 'sf', 'vetenskap fiktion'],
	Superhero: ['superhero', 'superheroes', 'super hero', 'super heroes', 'superhjalte', 'superhjaltar'],
	Fantasy: ['fantasy', 'fantasi'],
	Horror: ['horror', 'skrack'],
	Crime: ['crime', 'deckare', 'kriminal'],
	Humor: ['humor', 'humour', 'comedy', 'komedi'],
	Adventure: ['adventure', 'aventyr'],
	Drama: ['drama'],
	Mystery: ['mystery', 'mysterium'],
	Romance: ['romance', 'romantik'],
	Action: ['action'],
	Western: ['western'],
	War: ['war', 'krig'],
	Historical: ['historical', 'history', 'historia', 'historisk'],
	Manga: ['manga']
};
const ALIAS = new Map(Object.entries(LABELS).flatMap(([label, keys]) => keys.map((k) => [k, label] as const)));

const SMALL = new Set(['of', 'the', 'and', 'in', 'a', 'an', 'to', 'for']);
const title = (s: string) => s.split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

/** "science fiction comics" → "Sci-Fi"; "Comics & graphic novels" → undefined; unknown labels are title-cased. */
export function normalizeGenre(raw: string): string | undefined {
	let k = squash(raw);
	if (!k || GENERIC.has(k) || /fictitious|juvenile/.test(k)) return undefined;
	const direct = ALIAS.get(k);
	if (direct) return direct;
	const m = /^(.*) (comics|comic|fiction|manga)$/.exec(k);
	if (m) {
		k = m[1].replace(/ (and|of|the|in|a|an|to|for)$/, ''); // "cartoons and comics" → "cartoons"
		if (GENERIC.has(k)) return undefined;
		const alias = ALIAS.get(k);
		if (alias) return alias;
		if (m[2] === 'fiction') return undefined; // "modern fiction", library-subject noise
	}
	return k.split(' ').length > 3 ? undefined : title(k);
}

/** Normalise + drop generic + de-duplicate (first occurrence order). */
export function normalizeGenres(list: string[] | undefined): string[] {
	const out: string[] = [];
	for (const g of list ?? []) {
		const n = normalizeGenre(g);
		if (n && !out.includes(n)) out.push(n);
	}
	return out;
}
