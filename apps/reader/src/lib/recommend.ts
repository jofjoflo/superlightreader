import type { RecIssueItem, RecRow, RecSeriesItem, Scored, Series } from './types.ts';
import { UNKNOWN_PUBLISHER } from './types.ts';
import { hash, naturalCompare } from './util.ts';

/*
 * Content-based recommendations, fully local. See docs/architecture.md → "Rekommendationer".
 *
 *   vec(s)      = sparse {genre, pub, creator, decade, tok, manga} features, each KIND_WEIGHT × idf(library), L2-normalised
 *   sim(a, b)   = cosine(vec(a), vec(b)) + REL_BONUS × related-title edge(a, b), clamped to 1
 *   engagement  = (0.6·progress + favorite + (rating−3)/2) × recency decay (half-life HALF_LIFE_DAYS from lastReadAt)
 *   for-you(c)  = cosine(Σ engagement·vec − c's own share, vec(c)) + edge bonus, × READING_FACTOR if partly read
 */

// ───────────────────────── Tunables ─────────────────────────

/** Weight per feature kind; multiplied by idf over the library. */
const KIND_WEIGHT = { genre: 1, creator: 1.2, pub: 0.6, decade: 0.35, tok: 0.6, manga: 0.8 };
type Kind = keyof typeof KIND_WEIGHT;

const REL_BONUS = 0.35; // similarity added for a "related" title that matches another library series
const REL_PARTIAL = 0.5; // …× this when the match is only containment ("Avengers" ⊂ "New Avengers")
const MIN_SCORE = 0.1; // weaker matches are dropped (a shared decade alone scores ~0.07)
const HALF_LIFE_DAYS = 90;
const DECAY_FLOOR = 0.2; // old history still counts a little
const NEG_WEIGHT = 0.5; // low-rated series push the profile away at this strength
const READING_FACTOR = 0.7; // partly read series rank below unread ones
const DIVERSITY = 0.5; // for-you: a pick's score is cut by this × its similarity to the closest series already picked
const NOVELTY = 0.75; // home rows: score × this per row the series is already in
const LIKE_MIN = 0.3; // nearest read series must be this similar to explain a pick as "Liknar X"
const ANCHOR_MAX_SIM = 0.6; // two "because" rows must be about clearly different series
const MIN_BECAUSE = 3; // fewer picks than this → no "because" row
const ROW_MAX = 18;
const MAX_ROWS_PER_SERIES = 3; // outside publisher/genre rows
const OPEN_RELATED_MAX = 3; // containment matches linked per related title

// ───────────────────────── Text normalisation ─────────────────────────

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
const squash = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const STOP = new Set(
	(
		'the a an of and to in on at by for with from vol volume series comic comics book books graphic novel collection ' +
		'collected edition deluxe omnibus complete tpb hc trade issue issues annual special part new en ett och av pa med de den det som i'
	).split(' ')
);

/** Name → feature tokens: "Uncanny X-Men" → uncanny, x-men, men. Hyphenated words yield the whole and the parts. */
function nameTokens(name: string): string[] {
	const out = new Set<string>();
	const keep = (t: string) => !STOP.has(t) && (t.length >= 3 || /[\d-]/.test(t));
	for (const w of norm(name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')).split(/[^\p{L}\p{N}-]+/u)) {
		const word = w.replace(/^-+|-+$/g, '');
		if (keep(word)) out.add(word);
		if (word.includes('-')) for (const p of word.split('-')) if (keep(p)) out.add(p);
	}
	return [...out];
}

const GENRE_ALIAS: Record<string, string> = {
	'science fiction': 'sci fi',
	scifi: 'sci fi',
	sf: 'sci fi',
	superheroes: 'superhero',
	'super hero': 'superhero',
	'super heroes': 'superhero',
	superhjalte: 'superhero',
	superhjaltar: 'superhero',
	humor: 'comedy',
	humour: 'comedy',
	komedi: 'comedy',
	fantasi: 'fantasy',
	skrack: 'horror',
	aventyr: 'adventure'
};
/** Labels that say nothing about taste (every comic is one). */
const GENRE_SKIP = new Set(['comics', 'comic', 'comic book', 'graphic novel', 'graphic novels', 'comics graphic novels', 'fiction']);

/** Canonical genre key ("Sci-Fi" = "Science Fiction" = "science fiction comics"); '' for generic labels. */
function genreKey(g: string): string {
	let k = squash(g);
	if (!GENRE_ALIAS[k]) k = k.replace(/ (comics|comic|fiction)$/, '');
	k = GENRE_ALIAS[k] ?? k;
	return GENRE_SKIP.has(k) ? '' : k;
}

/** Title for matching `related` entries against series names: no (year)/[tags], no leading article. */
const titleKey = (t: string) =>
	squash(t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/&/g, ' and ')).replace(/^(the|a|an|en|ett|den|det) /, '');
const keyWords = (k: string) => k.split(' ').filter((w) => w && !STOP.has(w));

// ───────────────────────── Index ─────────────────────────

interface Index {
	list: Series[]; // canonical order (by id) so results never depend on input order
	byId: Map<string, Series>;
	vec: Map<string, Map<string, number>>; // series id → L2-normalised idf-weighted features
	label: Map<string, string>; // feature key → text for "why"
	edges: Map<string, Map<string, number>>; // series id → related series id → strength (symmetric)
	h: Map<string, string>; // seeded hash per id, the deterministic tie-break
}

const kindOf = (key: string) => key.slice(0, key.indexOf(':')) as Kind;

function features(s: Series, label: Map<string, string>): string[] {
	const out = new Set<string>();
	const add = (kind: Kind, value: string, text: string) => {
		if (!value) return;
		const key = `${kind}:${value}`;
		out.add(key);
		if (!label.has(key)) label.set(key, text);
	};
	for (const g of s.genres) add('genre', genreKey(g), g.trim());
	if (s.publisher !== UNKNOWN_PUBLISHER) add('pub', squash(s.publisher), s.publisher);
	for (const c of s.creators) add('creator', squash(c), c.trim());
	if (s.startYear) {
		const decade = String(Math.floor(s.startYear / 10) * 10);
		add('decade', decade, decade);
	}
	for (const t of nameTokens(s.name)) add('tok', t, t);
	if (s.rtl) add('manga', 'rtl', 'manga');
	return [...out];
}

/** Direct edges from `related` titles: exact title match = 1, containment match = REL_PARTIAL. */
function buildEdges(list: Series[]): Map<string, Map<string, number>> {
	const edges = new Map<string, Map<string, number>>();
	if (!list.some((s) => s.related.length)) return edges;
	const link = (a: string, b: string, w: number) => {
		for (const [x, y] of [[a, b], [b, a]]) {
			const m = edges.get(x) ?? edges.set(x, new Map()).get(x)!;
			if (w > (m.get(y) ?? 0)) m.set(y, w);
		}
	};
	const keys = list.map((s) => titleKey(s.name));
	const words = keys.map(keyWords);
	const exact = new Map<string, number[]>();
	const byWord = new Map<string, number[]>();
	keys.forEach((k, i) => {
		(exact.get(k) ?? exact.set(k, []).get(k)!).push(i);
		for (const w of new Set(words[i])) if (w.length >= 3) (byWord.get(w) ?? byWord.set(w, []).get(w)!).push(i);
	});
	list.forEach((a, ai) => {
		for (const r of a.related) {
			const rk = titleKey(r);
			if (!rk) continue;
			const same = (exact.get(rk) ?? []).filter((i) => i !== ai);
			if (same.length) {
				for (const i of same) link(a.id, list[i].id, 1);
				continue;
			}
			if (rk.length < 4) continue;
			const rw = keyWords(rk);
			const seen = new Set<number>();
			const hits: [number, number][] = []; // [coverage, index]
			for (const w of rw) {
				const bucket = byWord.get(w);
				if (!bucket || bucket.length > 80) continue;
				for (const i of bucket) {
					if (i === ai || seen.has(i)) continue;
					seen.add(i);
					const [short, long, sw, lw] =
						rk.length <= keys[i].length ? [rk, keys[i], rw.length, words[i].length] : [keys[i], rk, words[i].length, rw.length];
					if (short.length >= 4 && lw > 0 && sw / lw >= 0.5 && ` ${long} `.includes(` ${short} `)) hits.push([sw / lw, i]);
				}
			}
			hits.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
			for (const [, i] of hits.slice(0, OPEN_RELATED_MAX)) link(a.id, list[i].id, REL_PARTIAL);
		}
	});
	return edges;
}

/** `seed` varies the hash tie-break (home rows pass the day so tied shelves rotate daily, deterministically). */
function buildIndex(all: Series[], seed = 0): Index {
	const list = [...all].sort((a, b) => cmp(a.id, b.id));
	const label = new Map<string, string>();
	const feats = list.map((s) => features(s, label));
	const df = new Map<string, number>();
	for (const f of feats) for (const k of f) df.set(k, (df.get(k) ?? 0) + 1);
	const vec = new Map<string, Map<string, number>>();
	list.forEach((s, i) => {
		const v = new Map<string, number>();
		let sq = 0;
		for (const k of feats[i]) {
			const d = df.get(k)!;
			if (d < 2) continue; // a feature only this series has can't match anything; keep it out of the norm
			const w = KIND_WEIGHT[kindOf(k)] * Math.log(1 + list.length / d);
			v.set(k, w);
			sq += w * w;
		}
		const n = Math.sqrt(sq) || 1;
		for (const [k, w] of v) v.set(k, w / n);
		vec.set(s.id, v);
	});
	return {
		list,
		byId: new Map(list.map((s) => [s.id, s])),
		vec,
		label,
		edges: buildEdges(list),
		h: new Map(list.map((s) => [s.id, hash(`${seed}:${s.id}`)]))
	};
}

function dot(a: Map<string, number>, b: Map<string, number>): number {
	if (a.size > b.size) [a, b] = [b, a];
	let s = 0;
	for (const [k, w] of a) {
		const x = b.get(k);
		if (x !== undefined) s += w * x;
	}
	return s;
}

const edge = (idx: Index, a: string, b: string) => idx.edges.get(a)?.get(b) ?? 0;

function similarity(idx: Index, a: Series, b: Series): number {
	return Math.min(1, dot(idx.vec.get(a.id)!, idx.vec.get(b.id)!) + REL_BONUS * edge(idx, a.id, b.id));
}

/** Best first; exact ties fall back to the seeded hash. */
const byScore = (idx: Index) => (a: { series: Series; score: number }, b: { series: Series; score: number }) =>
	b.score - a.score || cmp(idx.h.get(a.series.id)!, idx.h.get(b.series.id)!);

// ───────────────────────── Similar series ─────────────────────────

function neighbours(idx: Index, t: Series): { series: Series; score: number }[] {
	const out: { series: Series; score: number }[] = [];
	for (const s of idx.list) {
		if (s.id === t.id) continue;
		const score = similarity(idx, t, s);
		if (score >= MIN_SCORE) out.push({ series: s, score });
	}
	return out.sort(byScore(idx));
}

const REASON: Record<Kind, (label: string) => string> = {
	genre: (l) => `Genre: ${l}`,
	pub: (l) => `Samma förlag: ${l}`,
	creator: (l) => `Även av ${l}`,
	decade: (l) => `Från ${l}-talet`,
	tok: () => 'Liknande titel',
	manga: () => 'Manga'
};

/** The 1–2 strongest reasons two series are alike, e.g. "Samma förlag: Marvel · Genre: Sci-fi". */
function whySimilar(idx: Index, a: Series, b: Series): string {
	const parts: string[] = [];
	if (edge(idx, a.id, b.id)) parts.push('Relaterad serie');
	const vb = idx.vec.get(b.id)!;
	const groups = new Map<Kind, [string, number][]>();
	for (const [k, w] of idx.vec.get(a.id)!) {
		const x = vb.get(k);
		if (x === undefined) continue;
		const kind = kindOf(k);
		(groups.get(kind) ?? groups.set(kind, []).get(kind)!).push([k, w * x]);
	}
	const total = (g: [string, number][]) => g.reduce((sum, [, c]) => sum + c, 0);
	// the decade alone is a weak reason: only use it when nothing else is shared
	const ranked = [...groups].sort(([ka, ga], [kb, gb]) => +(ka === 'decade') - +(kb === 'decade') || total(gb) - total(ga));
	for (const [kind, g] of ranked.slice(0, 2 - parts.length)) {
		g.sort((p, q) => q[1] - p[1]);
		parts.push(REASON[kind](g.slice(0, kind === 'genre' ? 2 : 1).map(([k]) => idx.label.get(k)).join(', ')));
	}
	return parts.join(' · ');
}

/** Series most similar to `target` (excluding itself), best first. */
export function similarSeries(target: Series, all: Series[], n = 12): Scored[] {
	const idx = buildIndex(all.some((s) => s.id === target.id) ? all : [...all, target]);
	return neighbours(idx, target)
		.slice(0, Math.max(0, n))
		.map(({ series, score }) => ({ series, score, why: whySimilar(idx, target, series) }));
}

// ───────────────────────── For you ─────────────────────────

/** 0.6·progress + favorite + (rating−3)/2, decayed by time since lastReadAt (never-read favourites don't decay). */
function engagement(s: Series, now: number): number {
	const raw = 0.6 * s.progress + (s.favorite ? 1 : 0) + (s.rating ? (s.rating - 3) / 2 : 0);
	if (s.lastReadAt === undefined) return raw;
	const days = Math.max(0, now - s.lastReadAt) / 864e5;
	return raw * Math.max(DECAY_FLOOR, 0.5 ** (days / HALF_LIFE_DAYS));
}

interface Profile {
	P: Map<string, number>; // Σ engagement · vec
	norm2: number;
	eng: Map<string, number>; // series id → signed contribution weight (negatives scaled by NEG_WEIGHT)
}

/** undefined when nothing has positive engagement. */
function buildProfile(idx: Index, now: number): Profile | undefined {
	const P = new Map<string, number>();
	const eng = new Map<string, number>();
	let positive = false;
	for (const s of idx.list) {
		let e = engagement(s, now);
		if (!e) continue;
		if (e > 0) positive = true;
		else e *= NEG_WEIGHT;
		eng.set(s.id, e);
		for (const [k, w] of idx.vec.get(s.id)!) P.set(k, (P.get(k) ?? 0) + e * w);
	}
	if (!positive) return undefined;
	let norm2 = 0;
	for (const w of P.values()) norm2 += w * w;
	return { P, norm2, eng };
}

/** Score for every candidate (not done, not rated 1–2). The candidate's own share is taken out of the profile first. */
function scoreCandidates(idx: Index, pr: Profile): { series: Series; score: number }[] {
	const out: { series: Series; score: number }[] = [];
	for (const s of idx.list) {
		if (s.state === 'done' || (s.rating !== undefined && s.rating <= 2)) continue;
		const v = idx.vec.get(s.id)!;
		const own = pr.eng.get(s.id) ?? 0;
		const self = v.size ? 1 : 0; // |v|²
		const pv = dot(pr.P, v);
		const n2 = pr.norm2 - 2 * own * pv + own * own * self;
		let score = n2 > 1e-9 ? (pv - own * self) / Math.sqrt(n2) : 0;
		let bonus = 0; // related to something the user engaged with (favourites count fully)
		for (const [id, w] of idx.edges.get(s.id) ?? []) {
			const e = pr.eng.get(id) ?? 0;
			if (e > 0) bonus = Math.max(bonus, w * (idx.byId.get(id)!.favorite ? 1 : Math.min(1, e)));
		}
		score += REL_BONUS * bonus;
		if (s.state === 'reading') score *= READING_FACTOR;
		out.push({ series: s, score });
	}
	return out;
}

/** "Liknar {nearest series you engaged with}" when one is close, else "Du gillar {strongest shared feature}". */
function whyForYou(idx: Index, pr: Profile, c: Series): string {
	let near: Series | undefined;
	let nearSim = 0;
	for (const [id, e] of pr.eng) {
		if (e <= 0 || id === c.id) continue;
		const s = idx.byId.get(id)!;
		const x = similarity(idx, c, s);
		if (x > nearSim) [near, nearSim] = [s, x];
	}
	const own = pr.eng.get(c.id) ?? 0;
	let top = '';
	let topW = 0;
	for (const [k, w] of idx.vec.get(c.id)!) {
		if (kindOf(k) === 'tok' || kindOf(k) === 'decade') continue;
		const x = ((pr.P.get(k) ?? 0) - own * w) * w;
		if (x > topW) [top, topW] = [k, x];
	}
	if (near && (nearSim >= LIKE_MIN || !top)) return `Liknar ${near.name}`;
	return top ? `Du gillar ${idx.label.get(top)}` : 'Passar din smak';
}

/** Top `n` by score, picked greedily with a diversity penalty (MMR) so one franchise doesn't fill the list. */
function recommend(idx: Index, pr: Profile, n: number, scored = scoreCandidates(idx, pr)): Scored[] {
	const pool = scored.filter((c) => c.score >= MIN_SCORE).sort(byScore(idx)).slice(0, Math.max(0, n) * 4);
	const near = pool.map(() => 0); // similarity to the closest pick so far
	const picked: Scored[] = [];
	while (picked.length < n && pool.length) {
		let bi = 0;
		let bv = -Infinity;
		pool.forEach((c, i) => {
			const v = c.score * (1 - DIVERSITY * near[i]);
			if (v > bv) [bi, bv] = [i, v];
		});
		const [c] = pool.splice(bi, 1);
		near.splice(bi, 1);
		const vc = idx.vec.get(c.series.id)!;
		pool.forEach((o, i) => (near[i] = Math.max(near[i], dot(vc, idx.vec.get(o.series.id)!))));
		picked.push({ series: c.series, score: bv, why: whyForYou(idx, pr, c.series) });
	}
	return picked;
}

/** Personalised picks from the user's reading profile (progress, favorites, ratings). Empty array when there is no history. */
export function recommendForYou(all: Series[], n = 18, now = Date.now()): Scored[] {
	const idx = buildIndex(all);
	const pr = buildProfile(idx, now);
	return pr ? recommend(idx, pr, n) : [];
}

// ───────────────────────── Home rows ─────────────────────────

const ago = (ms: number): string => {
	const d = Math.floor(Math.max(0, ms) / 864e5);
	if (d < 1) return 'idag';
	if (d < 2) return 'igår';
	if (d < 14) return `för ${d} dagar sedan`;
	return d < 60 ? `för ${Math.round(d / 7)} veckor sedan` : `för ${Math.round(d / 30)} månader sedan`;
};

/** Share of the in-progress issue, derived from Series.progress ((completed + share) / issueCount). */
function partialNote(s: Series): string | undefined {
	const p = s.progress * s.issueCount - s.completedCount;
	return p > 0.005 && p < 0.995 ? `${Math.round(p * 100)} % läst` : undefined;
}


const startsAtOne = (s: Series) => s.oneShot || (s.issues[0]?.number ?? Infinity) <= 1;
const disliked = (s: Series) => s.rating !== undefined && s.rating <= 2;

/** Rows for the home page, in display order; empty rows omitted. See docs/architecture.md → "Recommendations". Pure + deterministic for same input/now. */
export function buildHomeRows(series: Series[], now = Date.now()): RecRow[] {
	// the day seeds the tie-break, so tied shelves (cold start) rotate daily but stay stable within a day
	const idx = buildIndex(series, Math.floor(now / 864e5));
	const pr = buildProfile(idx, now);
	const scored = pr ? scoreCandidates(idx, pr) : [];
	const fit = new Map(scored.map((c) => [c.series.id, c.score]));
	const h = (s: Series) => idx.h.get(s.id)!;
	const recent = (a: Series, b: Series) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || cmp(h(a), h(b));
	// shelf order: personal fit (when there is history), then series with online metadata, then the seeded shuffle
	const shelf = (a: Series, b: Series) => (fit.get(b.id) ?? 0) - (fit.get(a.id) ?? 0) || +b.matched - +a.matched || cmp(h(a), h(b));
	const open = idx.list.filter((s) => s.state !== 'done' && !disliked(s));

	const rows: RecRow[] = [];
	const used = new Map<string, number>(); // rows each series is in, publisher/genre rows excluded
	const use = (items: { series: Series }[]) => items.forEach(({ series: s }) => used.set(s.id, (used.get(s.id) ?? 0) + 1));
	for (const s of idx.list) if (s.favorite) used.set(s.id, 1); // keeps one slot free for the favourites row

	/** First ROW_MAX series that still have a free slot (`free`: ignore the cap, for rows that don't count). */
	const take = (list: Series[], note?: (s: Series) => string | undefined, free = false): RecSeriesItem[] => {
		const items: RecSeriesItem[] = [];
		for (const s of list) {
			if (items.length >= ROW_MAX) break;
			if (!free && (used.get(s.id) ?? 0) >= MAX_ROWS_PER_SERIES) continue;
			const text = note?.(s);
			items.push(text ? { series: s, note: text } : { series: s });
		}
		return items;
	};
	/** Adds the row if it has enough items; returns whether it did. `counted: false` for publisher/genre/favourites rows. */
	const seriesRow = (id: string, title: string, items: RecSeriesItem[], o: { href?: string; min?: number; counted?: boolean } = {}) => {
		if (!items.length || items.length < (o.min ?? 1)) return false;
		rows.push(o.href ? { id, kind: 'series', title, href: o.href, items } : { id, kind: 'series', title, items });
		if (o.counted !== false) use(items);
		return true;
	};
	const issueRow = (id: string, title: string, list: Series[], issueId: (s: Series) => string | undefined, note: (s: Series) => string | undefined) => {
		const items: RecIssueItem[] = [];
		for (const s of list) {
			const issue = s.issues.find((i) => i.id === issueId(s));
			if (!issue || items.length >= ROW_MAX) continue;
			const text = note(s);
			items.push(text ? { issue, series: s, note: text } : { issue, series: s });
		}
		if (!items.length) return;
		rows.push({ id, kind: 'issues', title, items });
		use(items);
	};

	// started series: the issue in progress, or else the next unread one
	const started = idx.list.filter((s) => s.state === 'reading').sort(recent);
	issueRow('continue', 'Fortsätt läsa', started, (s) => s.inProgressIssueId, partialNote);
	issueRow('next', 'Nästa nummer', started.filter((s) => !s.inProgressIssueId), (s) => s.nextIssueId, (s) => `${s.issueCount - s.completedCount} kvar`);

	if (pr) {
		const fresh = scored.map((c) => ({ series: c.series, score: c.score * NOVELTY ** (used.get(c.series.id) ?? 0) }));
		const recs = recommend(idx, pr, ROW_MAX * 2, fresh);
		const why = new Map(recs.map((c) => [c.series.id, c.why]));
		seriesRow('foryou', 'Rekommenderat för dig', take(recs.map((c) => c.series), (s) => why.get(s.id)));

		// "because you read X": best-engaged series actually read, at most 2, about clearly different things
		const anchors = idx.list
			.filter((s) => (pr.eng.get(s.id) ?? 0) > 0 && s.lastReadAt !== undefined && (s.completedCount > 0 || s.progress >= 0.25) && !disliked(s))
			.sort((a, b) => pr.eng.get(b.id)! - pr.eng.get(a.id)! || cmp(h(a), h(b)))
			.slice(0, 8);
		const chosen: Series[] = [];
		for (const a of anchors) {
			if (chosen.length >= 2) break;
			if (chosen.some((c) => similarity(idx, a, c) >= ANCHOR_MAX_SIM)) continue;
			const near = neighbours(idx, a)
				.filter((c) => c.series.state !== 'done' && !disliked(c.series))
				.map((c) => ({
					series: c.series,
					score: c.score * (c.series.state === 'reading' ? READING_FACTOR : 1) * NOVELTY ** (used.get(c.series.id) ?? 0)
				}))
				.sort(byScore(idx));
			const items = take(near.map((c) => c.series), (s) => whySimilar(idx, a, s));
			if (seriesRow(`because-${a.id}`, `Eftersom du läste ${a.name}`, items, { min: MIN_BECAUSE })) chosen.push(a);
		}
	}

	// Local creator shelf: only creators on issues the user has actually started reading
	// can explain this row. Never infer popularity or ratings from outside the library.
	const read = idx.list.filter((s) => s.completedCount > 0 || s.progress > 0).sort(recent);
	const creatorLeads = new Map<string, { label: string; weight: number; last: number }>();
	for (const s of read) {
		const weight = Math.max(1, s.completedCount + s.progress);
		for (const creator of s.creators) {
			const key = squash(creator);
			if (!key) continue;
			const lead = creatorLeads.get(key);
			if (lead) {
				lead.weight += weight;
				lead.last = Math.max(lead.last, s.lastReadAt ?? 0);
			} else creatorLeads.set(key, { label: creator.trim(), weight, last: s.lastReadAt ?? 0 });
		}
	}
	const readIds = new Set(read.map((s) => s.id));
	const creatorLead = [...creatorLeads].sort(([, a], [, b]) => b.weight - a.weight || b.last - a.last || naturalCompare(a.label, b.label))[0];
	if (creatorLead) {
		const [key, lead] = creatorLead;
		const fromCreator = open
			.filter((s) => !readIds.has(s.id) && s.creators.some((creator) => squash(creator) === key))
			.sort(shelf);
		seriesRow(`creator-${key}`, `Mer från ${lead.label}`, take(fromCreator, undefined, true), {
			href: `/library?creator=${encodeURIComponent(lead.label)}`,
			counted: false
		});
	}

	seriesRow('favorites', 'Dina favoriter', take(idx.list.filter((s) => s.favorite).sort(recent), undefined, true), {
		href: '/library?status=favorites',
		counted: false
	});
	seriesRow('new', 'Nyligen tillagt', take([...open].sort((a, b) => b.addedAt - a.addedAt || cmp(h(a), h(b))), (s) => `Tillagd ${ago(now - s.addedAt)}`), {
		href: '/library?sort=added&desc=1'
	});
	const starters = open.filter((s) => s.state === 'unread' && startsAtOne(s)).sort((a, b) => +b.matched - +a.matched || cmp(h(a), h(b)));
	seriesRow('starters', 'Bra ställen att börja', take(starters, (s) => (s.oneShot ? 'Fristående' : `${s.issueCount} nummer`)));
	seriesRow('complete', 'Kompletta serier', take(open.filter((s) => s.complete).sort(shelf), (s) => `${s.issueCount} nummer`), {
		href: '/library?kind=complete'
	});

	// up to 4 publishers / genres with the most series still to read (≥ 2)
	const byPub = new Map<string, Series[]>();
	for (const s of open) if (s.publisher && s.publisher !== UNKNOWN_PUBLISHER) (byPub.get(s.publisher) ?? byPub.set(s.publisher, []).get(s.publisher)!).push(s);
	[...byPub]
		.filter(([, list]) => list.length >= 2)
		.sort(([an, al], [bn, bl]) => bl.length - al.length || naturalCompare(an, bn))
		.slice(0, 4)
		.forEach(([name, list]) =>
			seriesRow(`pub-${name}`, `Mer från ${name}`, take(list.sort(shelf), undefined, true), {
				href: `/library?publisher=${encodeURIComponent(name)}`,
				counted: false
			})
		);

	const byGenre = new Map<string, { spellings: Map<string, number>; list: Series[] }>();
	for (const s of open) {
		const seen = new Set<string>();
		for (const g of s.genres) {
			const key = genreKey(g);
			if (!key) continue;
			const grp = byGenre.get(key) ?? byGenre.set(key, { spellings: new Map(), list: [] }).get(key)!;
			grp.spellings.set(g.trim(), (grp.spellings.get(g.trim()) ?? 0) + 1);
			if (!seen.has(key)) grp.list.push(s);
			seen.add(key);
		}
	}
	[...byGenre.values()]
		.map(({ spellings, list }) => ({
			list,
			spelled: [...spellings].sort(([an, ac], [bn, bc]) => bc - ac || naturalCompare(an, bn)).map(([name]) => name)
		}))
		.filter((g) => g.list.length >= 2)
		.sort((a, b) => b.list.length - a.list.length || naturalCompare(a.spelled[0], b.spelled[0]))
		.slice(0, 4)
		.forEach(({ list, spelled }) =>
			// the library's genre filter matches exact spellings, so link every spelling the row merged
			seriesRow(`genre-${spelled[0]}`, spelled[0], take(list.sort(shelf), undefined, true), {
				href: `/library?${spelled.map((g) => `genre=${encodeURIComponent(g)}`).join('&')}`,
				counted: false
			})
		);

	seriesRow('classics', 'Klassiker', take(open.filter((s) => s.startYear !== undefined && s.startYear < 1990).sort(shelf), (s) => `Från ${s.startYear}`));
	return rows;
}
