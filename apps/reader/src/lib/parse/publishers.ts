/** "Marvel Comics" / "Marvel Entertainment" / "marvel" → "Marvel". Unknown names: trimmed + title-cased-as-is. undefined/empty → undefined. */
const ALIASES: Record<string, string> = {
	marvel: 'Marvel', 'marvel comics': 'Marvel', 'marvel entertainment': 'Marvel',
	dc: 'DC', 'dc comics': 'DC', 'detective comics': 'DC',
	'image': 'Image', 'image comics': 'Image', 'dark horse': 'Dark Horse', 'dark horse comics': 'Dark Horse',
	idw: 'IDW', 'idw publishing': 'IDW', boom: 'BOOM!', 'boom studios': 'BOOM!', 'boom! studios': 'BOOM!',
	vertigo: 'Vertigo', archie: 'Archie', 'archie comics': 'Archie', dynamite: 'Dynamite', 'dynamite entertainment': 'Dynamite',
	oni: 'Oni Press', 'oni press': 'Oni Press', kodansha: 'Kodansha', shueisha: 'Shueisha', viz: 'VIZ Media', 'viz media': 'VIZ Media',
	disney: 'Disney', egmont: 'Egmont', panini: 'Panini', titan: 'Titan Comics', 'titan comics': 'Titan Comics'
};
const canon = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[!.,]/g, '').replace(/\s+/g, ' ').trim();

export function normalizePublisher(raw?: string): string | undefined {
	const s = raw?.trim().replace(/\s+/g, ' ');
	if (!s) return undefined;
	return ALIASES[canon(s)] ?? s;
}

/** True if `name` (any alias casing) is in the built-in publisher list. */
export function isKnownPublisher(name: string): boolean {
	return !!name && Object.hasOwn(ALIASES, canon(name));
}

/** Deterministic brand-ish color '#rrggbb' for a publisher (known brands get their real color; others hashed hue). */
export function publisherColor(name: string): string {
	const known: Record<string, string> = {
		Marvel: '#ed1d24', DC: '#0072bc', Image: '#e74c3c', 'Dark Horse': '#111111', IDW: '#174b83', 'BOOM!': '#f15a29',
		Vertigo: '#111111', Archie: '#e31b23', Dynamite: '#d71920', 'Oni Press': '#e85d04', Kodansha: '#e60012', Shueisha: '#e60012',
		'VIZ Media': '#f39800', Disney: '#113ccf', Egmont: '#f58220', Panini: '#e30613', 'Titan Comics': '#262262'
	};
	const n = normalizePublisher(name) ?? name;
	if (known[n]) return known[n];
	let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	const hue = h % 360, sat = 62, light = 45;
	const k = (1 - Math.abs((hue / 60) % 2 - 1)) * sat / 100;
	const x = k * (1 - Math.abs(((hue / 60) % 2) - 1)); const m = light / 100 - k / 2;
	const [r, g, b] = hue < 60 ? [k, x, 0] : hue < 120 ? [x, k, 0] : hue < 180 ? [0, k, x] : hue < 240 ? [0, x, k] : hue < 300 ? [x, 0, k] : [k, 0, x];
	return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
