/** Plain-text helpers for descriptions: HTML/markdown → text, sentence-safe truncation. Pure. */

const NAMED: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
	hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”'
};

function decode(s: string): string {
	return s.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
		if (name) return NAMED[name.toLowerCase()] ?? m;
		try {
			return String.fromCodePoint(dec ? +dec : parseInt(hex, 16));
		} catch {
			return m; // invalid code point
		}
	});
}

/** HTML (or AniList/markdown-ish text) → one paragraph of plain text; spoiler blocks `~!…!~` are dropped. */
export function htmlToText(html: string): string {
	return decode(
		html
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
			.replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/gi, ' ')
			.replace(/<[^>]*>/g, '')
	)
		.replace(/~!.*?!~/gs, ' ')
		.replace(/(\*\*|__)(.+?)\1/g, '$2')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Drop "(Source: X)" / "[Written by X]" credits that MAL/AniList blurbs carry. */
export function stripCredits(s: string): string {
	return s
		.replace(/\s*[(\[]\s*(?:source|written by)\b[^)\]]*[)\]]/gi, '')
		.replace(/\s*~\s*written by.*$/i, '')
		.trim();
}

const LANGS =
	'Swedish|English|French|German|Danish|Norwegian|Finnish|Italian|Spanish|Japanese|Korean|Chinese|engelska|svenska|franska|tyska|danska|norska|finska|japanska';
// "(Japanese: ベルセルク, Hepburn: …)", "(engelska: The Phantom)", or anything containing non-Latin script
const NOISE = new RegExp(
	String.raw`\s*\((?:(?:${LANGS})\b[^()]*|[^()]*[^\u0000-ɏḀ-ỿ -⁯₠-⃏][^()]*)\)`,
	'g'
);

/** Wikipedia plain-text intro → readable description (no pronunciation/native-script parentheticals). */
export function cleanExtract(s: string): string {
	return htmlToText(s).replace(NOISE, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

const ABBR = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|vs|vol|vols|no|nr|inc|ltd|co|etc|jr|sr|ed|eds|pp|approx|ca|ex|fl|dvs|osv|mfl|[a-z])$/i;

/** Cut to ≤ max chars at the last sentence end; if there is none in the window, cut at a word and add "…". */
export function truncateAtSentence(text: string, max = 700): string {
	if (text.length <= max) return text;
	let end = 0;
	for (const m of text.matchAll(/[.!?…]["'”’)\]]*(?=\s+["'“‘(\[]?[\p{Lu}\d]|\s*$)/gu)) {
		const stop = m.index + m[0].length;
		if (stop > max) break;
		if (m[0][0] === '.' && ABBR.test(text.slice(0, m.index))) continue;
		end = stop;
	}
	if (end >= max * 0.3) return text.slice(0, end);
	return text.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:–-]+$/, '') + '…';
}

/** Raw API description (HTML, AniList markdown or Wikipedia plain text) → plain text ≤ max chars cut at a sentence end; undefined when empty. */
export function cleanDescription(raw: unknown, max = 700): string | undefined {
	if (typeof raw !== 'string') return undefined;
	return truncateAtSentence(stripCredits(cleanExtract(raw)), max) || undefined;
}
