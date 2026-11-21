/**
 * Synthetic demo library: ~110 real .cbz files (JPEG pages drawn on a canvas, ComicInfo.xml on ~65 %) laid out
 * like a real folder selection, so it goes through the normal scan pipeline. Browser only (canvas); nothing runs
 * at import. Deterministic: every random choice comes from a PRNG seeded by the file path.
 */
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { ScanInput } from './types.ts';
import { hash, sleep } from './util.ts';

export const DEMO_ROOT = 'Demo';

const W = 640;
const H = 960;
const QUALITY = 0.7;
const MTIME = Date.UTC(2024, 0, 15, 12);
const TAU = Math.PI * 2;

// ───────────────────────── Catalog ─────────────────────────

interface Spec {
	name: string; // series name as in ComicInfo and on the cover
	file?: string; // file-name stem when it differs from `name` (no ':' in file names)
	dir: string; // folder below DEMO_ROOT
	pub: string; // raw publisher (ComicInfo + cover strip)
	imprint?: string;
	fmt: string; // file-name suffix: {n} {n2} {n3} number, {y} year, {t} title
	start: number; // year of the first issue
	per?: number; // issues per year (default 12)
	nums: number[]; // issue numbers present; [] = one-shot without number
	titles?: string[];
	genres: string[];
	by: [writer: string, penciller: string];
	ci: number; // share of files that embed ComicInfo.xml (0..1)
	vol?: number; // ComicInfo <Volume> (only 1: a volume > 1 on part of a series would split it)
	manga?: boolean; // ComicInfo Manga=YesAndRightToLeft
	sv?: boolean; // Swedish summaries
}

const run = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const SERIES: Spec[] = [
	// Marvel
	{ name: 'X-Men', dir: 'Marvel/X-Men (1991)', pub: 'Marvel Comics', fmt: '{n3} ({y})', start: 1991, nums: run(1, 5), genres: ['Superhero', 'Sci-Fi'], by: ['Chris Claremont', 'Jim Lee'], ci: 0.5 },
	{ name: 'X-Men', dir: 'Marvel/X-Men (2019)', pub: 'Marvel Comics', fmt: '{n3} ({y})', start: 2019, nums: run(1, 3), genres: ['Superhero', 'Sci-Fi'], by: ['Jonathan Hickman', 'Leinil Francis Yu'], ci: 0.7 },
	{ name: 'Spider-Man', dir: 'Marvel/Spider-Man (1990)', pub: 'Marvel Comics', fmt: '#{n} ({y})', start: 1990, nums: [1, 2, 3, 5], genres: ['Superhero', 'Adventure'], by: ['Todd McFarlane', 'Todd McFarlane'], ci: 0.5 },
	{ name: 'Daredevil', dir: 'Marvel', pub: 'Marvel Comics', fmt: '{n3} ({y}) (c2c)', start: 1998, nums: run(1, 3), genres: ['Superhero', 'Crime'], by: ['Kevin Smith', 'Joe Quesada'], ci: 0.5 },
	{ name: 'Black Panther', dir: 'Marvel/Black Panther (2016)', pub: 'Marvel Comics', fmt: '{n3} ({y}) (2 covers)', start: 2016, nums: run(1, 4), genres: ['Superhero', 'Sci-Fi', 'Drama'], by: ['Ta-Nehisi Coates', 'Brian Stelfreeze'], ci: 1 },
	// DC Comics
	{ name: 'Batman', dir: 'DC Comics/Batman (2016)', pub: 'DC Comics', fmt: '{n3} ({y})', start: 2016, nums: [1, 2, 3, 4, 6, 7], genres: ['Superhero', 'Crime'], by: ['Tom King', 'David Finch'], ci: 0.5 },
	{ name: 'The Sandman', dir: 'DC Comics/The Sandman (1989)', pub: 'DC Comics', imprint: 'Vertigo', fmt: '{n2} ({y})', start: 1989, nums: run(1, 4), genres: ['Fantasy', 'Horror', 'Drama'], by: ['Neil Gaiman', 'Sam Kieth'], ci: 1 },
	{ name: 'Watchmen', dir: 'Misc', pub: 'DC Comics', fmt: '', start: 1987, nums: [], genres: ['Superhero', 'Drama'], by: ['Alan Moore', 'Dave Gibbons'], ci: 1 },
	{ name: 'Wonder Woman', dir: 'DC Comics', pub: 'DC Comics', fmt: '{n3} ({y})', start: 2016, nums: run(1, 3), genres: ['Superhero', 'Fantasy', 'Adventure'], by: ['Greg Rucka', 'Liam Sharp'], ci: 0.5 },
	{ name: 'Y: The Last Man', file: 'Y - The Last Man', dir: 'DC Comics/Y - The Last Man (2002)', pub: 'DC Comics', imprint: 'Vertigo', fmt: '{n3} ({y})', start: 2002, nums: run(1, 4), genres: ['Sci-Fi', 'Drama', 'Adventure'], by: ['Brian K. Vaughan', 'Pia Guerra'], ci: 1, vol: 1 },
	{ name: 'The Boys', dir: 'DC Comics/The Boys (2006)', pub: 'DC Comics', imprint: 'WildStorm', fmt: '{n3} (of 06) ({y})', start: 2006, nums: run(1, 4), genres: ['Superhero', 'Humor', 'Crime'], by: ['Garth Ennis', 'Darick Robertson'], ci: 0.5, vol: 1 },
	{ name: 'Batman: The Killing Joke', file: 'Batman - The Killing Joke', dir: 'DC Comics', pub: 'DC Comics', fmt: '', start: 1988, nums: [], genres: ['Superhero', 'Crime'], by: ['Alan Moore', 'Brian Bolland'], ci: 0 },
	// Image
	{ name: 'Saga', dir: 'Image/Saga', pub: 'Image Comics', fmt: '{n3} ({y}) (Digital)', start: 2012, per: 5, nums: run(1, 6), genres: ['Sci-Fi', 'Fantasy', 'Drama'], by: ['Brian K. Vaughan', 'Fiona Staples'], ci: 1, vol: 1 },
	{ name: 'The Walking Dead', dir: 'Image/The Walking Dead (2003)', pub: 'Image Comics', fmt: '{n3} ({y}) [Zone-Empire]', start: 2003, nums: [1, 2, 3, 5], genres: ['Horror', 'Drama'], by: ['Robert Kirkman', 'Tony Moore'], ci: 0.5, vol: 1 },
	{ name: 'Invincible', dir: 'Image/Invincible', pub: 'Image Comics', fmt: '{n3}', start: 2003, nums: [1, 2, 4, 5], genres: ['Superhero', 'Sci-Fi'], by: ['Robert Kirkman', 'Cory Walker'], ci: 0.5, vol: 1 },
	{ name: 'Paper Girls', dir: 'Image/Paper Girls (2015)', pub: 'Image Comics', fmt: '{n3} ({y})', start: 2015, nums: run(1, 3), genres: ['Sci-Fi', 'Adventure', 'Drama'], by: ['Brian K. Vaughan', 'Cliff Chiang'], ci: 0.7, vol: 1 },
	{ name: 'Monstress', dir: 'Image/Monstress', pub: 'Image Comics', fmt: '{n2}', start: 2015, nums: run(1, 3), genres: ['Fantasy', 'Horror'], by: ['Marjorie Liu', 'Sana Takeda'], ci: 0.7, vol: 1 },
	// Dark Horse
	{ name: 'Hellboy', dir: 'Dark Horse/Hellboy', pub: 'Dark Horse Comics', fmt: '{n3}', start: 1994, nums: run(1, 3), genres: ['Horror', 'Fantasy', 'Adventure'], by: ['Mike Mignola', 'Mike Mignola'], ci: 0.5 },
	{ name: 'Usagi Yojimbo', dir: 'Dark Horse', pub: 'Dark Horse Comics', fmt: '{n3} ({y})', start: 1996, nums: run(1, 3), genres: ['Adventure', 'Historical'], by: ['Stan Sakai', 'Stan Sakai'], ci: 0.5 },
	{ name: 'Berserk', dir: 'Manga/Berserk', pub: 'Dark Horse Comics', fmt: 'v{n2}', start: 2003, per: 3, nums: run(1, 4), genres: ['Manga', 'Fantasy', 'Horror'], by: ['Kentaro Miura', 'Kentaro Miura'], ci: 1, manga: true },
	// IDW
	{ name: 'Locke & Key', dir: 'IDW/Locke & Key', pub: 'IDW Publishing', fmt: '{n} (of 6) ({y})', start: 2008, nums: run(1, 4), genres: ['Horror', 'Fantasy', 'Drama'], by: ['Joe Hill', 'Gabriel Rodríguez'], ci: 0.6, vol: 1 },
	// VIZ Media
	{ name: 'One Piece', dir: 'Manga/One Piece', pub: 'VIZ Media', fmt: 'Vol. {n2}', start: 2003, per: 3, nums: run(1, 4), genres: ['Manga', 'Adventure', 'Humor'], by: ['Eiichiro Oda', 'Eiichiro Oda'], ci: 1, manga: true },
	{ name: 'Naruto', dir: 'Manga/Naruto', pub: 'VIZ Media', fmt: 'v{n2} ({y}) (Digital)', start: 2003, per: 3, nums: run(1, 3), genres: ['Manga', 'Adventure', 'Fantasy'], by: ['Masashi Kishimoto', 'Masashi Kishimoto'], ci: 1, manga: true },
	{ name: 'Dragon Ball', dir: 'VIZ Media/Dragon Ball', pub: 'VIZ Media', fmt: 'v{n2}', start: 2003, per: 3, nums: run(1, 3), genres: ['Manga', 'Adventure', 'Humor'], by: ['Akira Toriyama', 'Akira Toriyama'], ci: 0.5, manga: true },
	// Kodansha
	{ name: 'Attack on Titan', dir: 'Manga/Attack on Titan', pub: 'Kodansha', fmt: 'v{n2}', start: 2012, per: 3, nums: run(1, 3), genres: ['Manga', 'Horror', 'Drama'], by: ['Hajime Isayama', 'Hajime Isayama'], ci: 1, manga: true },
	{ name: 'Akira', dir: 'Kodansha/Akira', pub: 'Kodansha', fmt: 'v{n2}', start: 2009, per: 3, nums: run(1, 2), genres: ['Manga', 'Sci-Fi'], by: ['Katsuhiro Otomo', 'Katsuhiro Otomo'], ci: 0.5, manga: true },
	// Egmont
	{ name: 'Fantomen', dir: 'Egmont/Fantomen', pub: 'Egmont', fmt: '{y}-{n2}', start: 2021, per: 52, nums: [1, 2, 3, 5], genres: ['Adventure', 'Superhero'], by: ['Lee Falk', 'Sy Barry'], ci: 0.5, sv: true },
	{ name: 'Kalle Anka & C:o', file: 'Kalle Anka & C_o', dir: 'Tidningar/Kalle Anka & C_o', pub: 'Egmont', fmt: '{y}-{n2}', start: 2021, per: 52, nums: run(1, 3), genres: ['Humor'], by: ['Carl Barks', 'Carl Barks'], ci: 1, sv: true },
	{ name: 'Asterix', dir: 'Egmont/Asterix', pub: 'Egmont', fmt: '{n2} - {t}', start: 1961, per: 1, nums: run(1, 3), titles: ['Asterix the Gaul', 'Asterix and the Golden Sickle', 'Asterix and the Goths'], genres: ['Humor', 'Adventure'], by: ['René Goscinny', 'Albert Uderzo'], ci: 0.5 },
	// Casterman, Dupuis, Rebellion, misc
	{ name: 'Tintin', dir: 'Casterman/Tintin', pub: 'Casterman', fmt: '{n2} - {t}', start: 1930, per: 0.5, nums: run(1, 4), titles: ['Tintin in the Land of the Soviets', 'Tintin in the Congo', 'Tintin in America', 'Cigars of the Pharaoh'], genres: ['Adventure'], by: ['Hergé', 'Hergé'], ci: 0.5 },
	{ name: 'Blacksad', dir: 'Dupuis/Blacksad', pub: 'Dupuis', fmt: '{n2} - {t}', start: 2000, per: 0.4, nums: run(1, 3), titles: ['Somewhere Within the Shadows', 'Arctic-Nation', 'Red Soul'], genres: ['Crime', 'Drama'], by: ['Juan Díaz Canales', 'Juanjo Guarnido'], ci: 0.5 },
	{ name: '2000 AD', dir: 'Rebellion/2000 AD', pub: 'Rebellion', fmt: '{n} ({y})', start: 2021, per: 52, nums: [2250, 2251, 2253, 2254], genres: ['Sci-Fi', 'Humor'], by: ['Pat Mills', 'Carlos Ezquerra'], ci: 0.5 },
	{ name: 'Maus', dir: 'Misc', pub: 'Pantheon Books', fmt: '', start: 1991, nums: [], genres: ['Drama'], by: ['Art Spiegelman', 'Art Spiegelman'], ci: 0 }
];

const SUMMARY = {
	en: [
		[
			'An old debt comes due on the worst possible night.',
			'A stranger arrives with a message nobody wanted to hear.',
			'What looked like a routine job turns out to be anything but.',
			'The city goes quiet, and that is never a good sign.',
			'A secret buried for years finally comes to the surface.',
			'Two former allies meet again, and only one of them is smiling.',
			'Friends & rivals swap places overnight.',
			'Rumours from the border send the team on a hasty road trip.'
		],
		[
			'Loyalties are tested before the final page.',
			'By dawn, nothing will be the same.',
			"The only way out leads straight through the enemy's front door.",
			'And someone close to home has been lying all along.',
			'The price of winning has never been higher.',
			'Some doors, once opened, cannot be closed again.',
			'A fragile truce is all that holds the chaos back.',
			'The next move could change everything.'
		]
	],
	sv: [
		[
			'En gammal skuld krävs in under natten.',
			'En främling dyker upp med ett oönskat budskap.',
			'Det som verkade vara ett rutinuppdrag blir något helt annat.',
			'Staden tystnar, och det vet aldrig något gott.'
		],
		['Lojaliteter sätts på prov innan sista sidan.', 'Vid gryningen är ingenting sig likt.', 'Priset för segern har aldrig varit högre.', 'Nästa drag kan förändra allt.']
	]
};

interface Item {
	s: Spec;
	n?: number;
	year: number;
	title?: string;
	name: string;
	path: string;
}

/** Expand the catalog into one entry per file, sorted by path like a real folder listing. */
function plan(): Item[] {
	const items = SERIES.flatMap((s) => {
		const nums: (number | undefined)[] = s.nums.length ? s.nums : [undefined];
		return nums.map((n, i): Item => {
			const year = s.start + Math.floor(i / (s.per ?? 12));
			const title = s.titles?.[i];
			const suffix =
				n === undefined
					? ''
					: ' ' +
						s.fmt.replace(/\{(\w+)\}/g, (_, k: string) =>
							k === 'y' ? String(year) : k === 't' ? (title ?? '') : k === 'n' ? String(n) : String(n).padStart(+k[1], '0')
						);
			const name = `${s.file ?? s.name}${suffix}.cbz`;
			return { s, n, year, title, name, path: `${DEMO_ROOT}/${s.dir}/${name}` };
		});
	});
	return items.sort((a, b) => (a.path < b.path ? -1 : 1));
}

// ───────────────────────── Random + ComicInfo ─────────────────────────

/** mulberry32 seeded from a string. */
function rng(seed: string): () => number {
	let a = parseInt(hash(seed), 36);
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function comicInfo(it: Item, r: () => number, pages: number): string {
	const { s } = it;
	const [a, b] = SUMMARY[s.sv ? 'sv' : 'en'];
	const summary = pick(r, a) + (r() < 0.7 ? ' ' + pick(r, b) : '');
	const tag = (k: string, v?: string | number) => (v === undefined ? '' : `  <${k}>${esc(String(v))}</${k}>\n`);
	return (
		'<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
		tag('Title', it.title) +
		tag('Series', s.name) +
		tag('Number', it.n) +
		tag('Volume', s.vol) +
		tag('Summary', summary) +
		tag('Year', it.year) +
		tag('Writer', s.by[0]) +
		tag('Penciller', s.by[1]) +
		tag('Publisher', s.pub) +
		tag('Imprint', s.imprint) +
		tag('Genre', s.genres.join(', ')) +
		tag('PageCount', pages) +
		tag('LanguageISO', s.sv ? 'sv' : 'en') +
		tag('Manga', s.manga ? 'YesAndRightToLeft' : undefined) +
		'  <Pages>\n' +
		Array.from({ length: pages }, (_, i) => `    <Page Image="${i}"${i ? '' : ' Type="FrontCover"'} />\n`).join('') +
		'  </Pages>\n</ComicInfo>\n'
	);
}

// ───────────────────────── Drawing ─────────────────────────

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const hsl = (h: number, s: number, l: number) => `hsl(${((Math.round(h) % 360) + 360) % 360}, ${s}%, ${l}%)`;
const font = (px: number) => `900 ${px}px Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif`;

/** Run `draw` on a fresh W×H canvas (OffscreenCanvas when available) and return the JPEG bytes. */
async function jpeg(draw: (ctx: Ctx) => void): Promise<Uint8Array> {
	let blob: Blob | null;
	if (typeof OffscreenCanvas !== 'undefined') {
		const c = new OffscreenCanvas(W, H);
		draw(c.getContext('2d')!);
		blob = await c.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
	} else {
		const c = document.createElement('canvas');
		c.width = W;
		c.height = H;
		draw(c.getContext('2d')!);
		blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', QUALITY));
	}
	if (!blob) throw new Error('JPEG encoding failed');
	return new Uint8Array(await blob.arrayBuffer());
}

/** Wrap `text` into lines and shrink the font until it fits maxW × maxH. Leaves ctx.font set. */
function fitTitle(ctx: Ctx, text: string, maxW: number, maxH: number): { lines: string[]; px: number } {
	const words = text.split(' ');
	let lines: string[] = [];
	for (let px = 150; px >= 40; px -= 6) {
		ctx.font = font(px);
		lines = [];
		for (const w of words) {
			const cur = lines.length ? lines[lines.length - 1] + ' ' + w : w;
			if (lines.length && ctx.measureText(cur).width <= maxW) lines[lines.length - 1] = cur;
			else lines.push(w);
		}
		if (lines.length * px * 0.95 <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, px };
	}
	return { lines, px: 40 };
}

function drawCover(ctx: Ctx, r: () => number, hue: number, title: string, label: string, pub: string, year: number) {
	const accent = hsl(hue + 180, 90, 56);
	const bg = ctx.createLinearGradient(0, 0, W * 0.5, H);
	bg.addColorStop(0, hsl(hue, 80, 52));
	bg.addColorStop(1, hsl(hue + 40, 70, 14));
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, W, H);

	// sunburst behind the title
	ctx.fillStyle = 'rgba(255,255,255,0.08)';
	ctx.beginPath();
	const a0 = r() * TAU;
	for (let i = 0; i < 20; i++) {
		const a = a0 + (i * TAU) / 20;
		ctx.moveTo(W / 2, 300);
		ctx.lineTo(W / 2 + 1300 * Math.cos(a), 300 + 1300 * Math.sin(a));
		ctx.lineTo(W / 2 + 1300 * Math.cos(a + TAU / 40), 300 + 1300 * Math.sin(a + TAU / 40));
		ctx.closePath();
	}
	ctx.fill();

	// halftone dots growing towards the bottom
	ctx.fillStyle = 'rgba(0,0,0,0.28)';
	ctx.beginPath();
	for (let y = 0, row = 0; y < H; y += 16, row++) {
		const rad = 7 * Math.max(0, (y / H - 0.3) / 0.7);
		if (rad < 0.8) continue;
		for (let x = (row % 2) * 8; x < W; x += 16) {
			ctx.moveTo(x + rad, y);
			ctx.arc(x, y, rad, 0, TAU);
		}
	}
	ctx.fill();

	// diagonal accent band
	const y0 = 560 + r() * 60;
	const rise = 140 + r() * 80;
	ctx.beginPath();
	ctx.moveTo(-20, y0);
	ctx.lineTo(W + 20, y0 - rise);
	ctx.lineTo(W + 20, y0 - rise + 110);
	ctx.lineTo(-20, y0 + 110);
	ctx.closePath();
	ctx.fillStyle = accent;
	ctx.fill();
	ctx.lineWidth = 6;
	ctx.strokeStyle = '#fff';
	ctx.stroke();

	// title: wrapped, auto-fitted, outlined
	const { lines, px } = fitTitle(ctx, title.toUpperCase(), 560, 380);
	ctx.save();
	ctx.translate(W / 2, 250);
	ctx.rotate(-0.06);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.lineJoin = 'round';
	ctx.lineWidth = px / 6;
	lines.forEach((line, i) => {
		const y = (i - (lines.length - 1) / 2) * px * 0.95;
		ctx.strokeStyle = 'rgba(0,0,0,0.55)';
		ctx.strokeText(line, px / 14, y + px / 14);
		ctx.strokeStyle = '#111';
		ctx.strokeText(line, 0, y);
		ctx.fillStyle = '#fff4c8';
		ctx.fillText(line, 0, y);
	});
	ctx.restore();

	// issue number in a starburst
	const bx = r() < 0.5 ? 160 : W - 160;
	const by = H - 235;
	ctx.beginPath();
	for (let i = 0; i < 32; i++) ctx.lineTo(bx + (i % 2 ? 98 : 125) * Math.cos((i * TAU) / 32), by + (i % 2 ? 98 : 125) * Math.sin((i * TAU) / 32));
	ctx.closePath();
	ctx.fillStyle = '#ffd23f';
	ctx.fill();
	ctx.lineWidth = 7;
	ctx.strokeStyle = '#111';
	ctx.stroke();
	ctx.font = font(120);
	ctx.font = font(Math.floor(Math.min(120, (120 * 170) / ctx.measureText(label).width)));
	ctx.fillStyle = '#111';
	ctx.fillText(label, bx, by + 4);

	// publisher strip
	ctx.fillStyle = accent;
	ctx.fillRect(0, H - 70, W, 5);
	ctx.fillStyle = 'rgba(0,0,0,0.85)';
	ctx.fillRect(0, H - 65, W, 65);
	ctx.font = 'bold 28px "Arial Black", Arial, sans-serif';
	ctx.fillStyle = '#fff';
	ctx.textAlign = 'left';
	ctx.fillText(pub.toUpperCase(), 26, H - 32);
	ctx.textAlign = 'right';
	ctx.fillText(String(year), W - 26, H - 32);
}

const LAYOUTS = [[1, 2], [2, 1], [1, 1, 1], [2, 2], [1, 2, 1], [2, 1, 1], [2, 1, 2], [1, 2, 2]]; // panels per row: 3–5
const WORDS = ["WHO'S THERE?", 'RUN!', 'NOT AGAIN.', 'LOOK OUT!', "IT'S TOO LATE", 'WAIT...', 'HOLD ON!', 'WHAT NOW?', 'I KNEW IT.', 'NO WAY!'];

function bubble(ctx: Ctx, r: () => number, x: number, y: number, w: number, h: number) {
	const text = pick(r, WORDS);
	ctx.font = 'bold 22px "Comic Sans MS", "Comic Neue", Arial, sans-serif';
	const rx = ctx.measureText(text).width / 2 + 24;
	const ry = 30;
	if (2 * rx + 20 > w || 2 * ry + 50 > h) return;
	const cx = x + 10 + rx + r() * (w - 2 * rx - 20);
	const cy = y + 12 + ry + r() * (h - 2 * ry - 44) * 0.6;
	const d = r() < 0.5 ? -1 : 1;
	ctx.fillStyle = '#fff';
	ctx.strokeStyle = '#111';
	ctx.lineWidth = 3;
	ctx.beginPath(); // tail first, the ellipse then covers its upper part
	ctx.moveTo(cx + d * 4, cy + ry - 4);
	ctx.lineTo(cx + d * 12, cy + ry + 24);
	ctx.lineTo(cx + d * 30, cy + ry - 8);
	ctx.fill();
	ctx.stroke();
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = '#111';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, cx, cy + 1);
}

function panel(ctx: Ctx, r: () => number, x: number, y: number, w: number, h: number, hue: number) {
	const h1 = hue + (r() - 0.5) * 90;
	const g = ctx.createLinearGradient(x, y, x + w * r(), y + h);
	g.addColorStop(0, hsl(h1, 55 + r() * 30, 58 + r() * 17));
	g.addColorStop(1, hsl(h1 + 35, 60, 26 + r() * 20));
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	ctx.fillStyle = g;
	ctx.fillRect(x, y, w, h);
	if (r() < 0.65) {
		// head-and-shoulders silhouette
		const fx = x + w * (0.25 + r() * 0.5);
		const fh = h * (0.5 + r() * 0.3);
		const base = y + h;
		ctx.fillStyle = 'rgba(10,10,30,0.55)';
		ctx.beginPath();
		ctx.arc(fx, base - fh * 0.84, fh * 0.16, 0, TAU);
		ctx.moveTo(fx - fh * 0.4, base);
		ctx.quadraticCurveTo(fx - fh * 0.35, base - fh * 0.7, fx, base - fh * 0.7);
		ctx.quadraticCurveTo(fx + fh * 0.35, base - fh * 0.7, fx + fh * 0.4, base);
		ctx.fill();
	}
	ctx.restore();
	ctx.lineWidth = 5;
	ctx.strokeStyle = '#141414';
	ctx.strokeRect(x, y, w, h);
	if (r() < 0.75) bubble(ctx, r, x, y, w, h);
}

function drawPage(ctx: Ctx, r: () => number, hue: number, no: number) {
	ctx.fillStyle = '#f4efe3';
	ctx.fillRect(0, 0, W, H);
	const rows = pick(r, LAYOUTS);
	const M = 30;
	const G = 14;
	const hs = rows.map(() => 0.8 + r() * 0.7);
	const hSum = hs.reduce((a, b) => a + b);
	const availH = H - 2 * M - 22 - G * (rows.length - 1);
	let y = M;
	rows.forEach((n, ri) => {
		const h = (availH * hs[ri]) / hSum;
		const ws = Array.from({ length: n }, () => 0.8 + r() * 0.7);
		const wSum = ws.reduce((a, b) => a + b);
		const availW = W - 2 * M - G * (n - 1);
		let x = M;
		for (const wt of ws) {
			const w = (availW * wt) / wSum;
			panel(ctx, r, x, y, w, h, hue);
			x += w + G;
		}
		y += h + G;
	});
	ctx.fillStyle = '#6b6559';
	ctx.font = 'bold 20px Arial, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(String(no), W / 2, H - 12);
}

// ───────────────────────── Public API ─────────────────────────

async function makeFile(it: Item): Promise<ScanInput> {
	const { s } = it;
	const r = rng(it.path);
	const tagged = r() < s.ci;
	const count = 4 + Math.floor(r() * 3);
	const hue = rng(`${s.dir}|${s.name}`)() * 360 + (r() - 0.5) * 20;
	const label = it.n === undefined ? 'ONE-SHOT' : s.manga ? `VOL ${it.n}` : `#${it.n}`;
	// pages are drawn one after another (shared PRNG), their JPEG encoding overlaps
	const pages = await Promise.all(
		Array.from({ length: count }, (_, p) =>
			jpeg((ctx) => (p ? drawPage(ctx, r, hue, p + 1) : drawCover(ctx, r, hue, s.name, label, s.pub, it.year)))
		)
	);
	const zip: Zippable = {};
	pages.forEach((b, p) => (zip[`${String(p + 1).padStart(3, '0')}.jpg`] = [b, { level: 0 }]));
	if (tagged) zip['ComicInfo.xml'] = [strToU8(comicInfo(it, r, count)), { level: 6 }];
	const bytes = zipSync(zip, { mtime: MTIME }) as Uint8Array<ArrayBuffer>;
	return { file: new File([bytes], it.name, { type: 'application/vnd.comicbook+zip', lastModified: MTIME }), path: it.path };
}

/** Generate the demo library (~110 CBZ files) entirely in the browser. Same output on every run. */
export async function makeDemoInputs(onProgress?: (done: number, total: number) => void): Promise<ScanInput[]> {
	const items = plan();
	const out: ScanInput[] = [];
	onProgress?.(0, items.length);
	for (const it of items) {
		out.push(await makeFile(it));
		onProgress?.(out.length, items.length);
		if (out.length % 3 === 0) await sleep(0);
	}
	return out;
}
