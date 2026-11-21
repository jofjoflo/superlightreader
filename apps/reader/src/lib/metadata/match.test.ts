import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPT, FILL, baseTitle, choose, creatorMatch, fillGaps, isComplete, rankCandidates, samePublisher, scoreCandidate, titleKey, titleSimilarity, type Raw } from './match.ts';
import type { MetaCandidate } from '../types.ts';

const raw = (o: Partial<Raw> & { title: string }): Raw => ({ source: 'wikipedia', kind: 'series', ...o });

describe('titleKey / titleSimilarity', () => {
	it('strips articles, disambiguators, volumes, years, diacritics and punctuation', () => {
		assert.equal(titleKey('The Walking Dead (comic book series)'), 'walking dead');
		assert.equal(titleKey('Déjà Vu (2012)'), 'deja vu');
		assert.equal(titleKey('Saga, Vol. 1: Part One'), 'saga');
		assert.equal(titleKey('Kalle Anka & C:o'), 'kalle anka and c o');
		assert.equal(titleKey('1984'), '1984');
		assert.equal(baseTitle('Saga Volume 3 - Deluxe'), 'Saga');
	});
	it('exact = 1, spelling variants ≈ 1, extra words drop below the fill bar, unrelated = 0', () => {
		assert.equal(titleSimilarity('Batman', 'Batman (comic book)'), 1);
		assert.equal(titleSimilarity('The Sandman', 'Sandman'), 1);
		assert.ok(titleSimilarity('Spider-Man', 'Spiderman') >= 0.95);
		assert.ok(titleSimilarity('Batman', 'Batman Beyond') < FILL);
		const xl = titleSimilarity('X-Men', 'X-Men Legacy');
		assert.ok(xl > FILL && xl < ACCEPT, String(xl));
		assert.equal(titleSimilarity('Saga', 'Hellboy'), 0);
	});
});

describe('scoreCandidate', () => {
	it('film/TV/game/novel hits are pushed below the fill bar even with a perfect title', () => {
		for (const title of ['Batman (1989 film)', 'The Walking Dead (TV series)', 'Saga (video game)', 'Saga (novel)', 'Batman: The Movie']) assert.ok(scoreCandidate({ name: title.split(/[:(]/)[0].trim() }, raw({ title })) < FILL, title);
		assert.ok(scoreCandidate({ name: 'Batman' }, raw({ title: 'Batman', kind: 'media' })) < FILL);
		assert.equal(scoreCandidate({ name: 'Batman' }, raw({ title: 'Batman (comic book)' })), 1);
	});
	it('year, publisher and creator only break ties between plausible titles', () => {
		const q = { name: 'X-Men', year: 1991, publisher: 'Marvel', creators: ['Chris Claremont'] };
		const near = raw({ title: 'X-Men Legacy', startYear: 1991, publisher: 'Marvel Comics', creators: ['Chris Claremont'] });
		assert.ok(scoreCandidate(q, near) > titleSimilarity('X-Men', 'X-Men Legacy'));
		assert.ok(scoreCandidate(q, near) - titleSimilarity('X-Men', 'X-Men Legacy') <= 0.1 + 1e-9);
		const weak = raw({ title: 'Batman Beyond Unlimited', startYear: 1991, publisher: 'Marvel' });
		assert.equal(scoreCandidate({ name: 'Batman', year: 1991, publisher: 'Marvel' }, weak), titleSimilarity('Batman', 'Batman Beyond Unlimited'));
	});
	it('unverified and character hits rank just below a verified series; catalogues never outrank Wikipedia', () => {
		const q = { name: 'Hellboy' };
		const ranked = rankCandidates(q, [raw({ title: 'Hellboy', kind: 'unknown', source: 'openlibrary' }), raw({ title: 'Hellboy', kind: 'character' }), raw({ title: 'Hellboy', kind: 'series' })]);
		assert.deepEqual(ranked.map((c) => c.kind), ['series', 'character', 'unknown']);
		const mixed = rankCandidates(q, [raw({ title: 'Hellboy', kind: 'series', source: 'openlibrary' }), raw({ title: 'Hellboy', kind: 'character' })]);
		assert.deepEqual(mixed.map((c) => c.source), ['wikipedia', 'openlibrary']);
	});
	it('AniList outranks Wikipedia on equal scores for manga queries only', () => {
		const both = [raw({ title: 'Berserk' }), raw({ title: 'Berserk', source: 'anilist' })];
		assert.equal(rankCandidates({ name: 'Berserk', manga: true }, both)[0].source, 'anilist');
		assert.equal(rankCandidates({ name: 'Berserk' }, both)[0].source, 'wikipedia');
	});
	it('matches publishers and creators loosely', () => {
		assert.ok(samePublisher('Marvel', 'Marvel Comics'));
		assert.ok(samePublisher('Egmont', 'Egmont Kärnan'));
		assert.ok(!samePublisher('Image', 'Dark Horse Comics'));
		assert.ok(creatorMatch(['Moore'], ['Alan Moore', 'Dave Gibbons']));
		assert.ok(!creatorMatch(['Alan Moore'], ['Dave Gibbons']));
	});
});

describe('choose / fillGaps', () => {
	const scored = (q: { name: string; year?: number; publisher?: string }, ...r: Raw[]) => rankCandidates(q, r);
	it('accepts at ≥ 0.72, lends gaps only from ≥ 0.6 non-media candidates', () => {
		const q = { name: 'X-Men' };
		const ranked = scored(q, raw({ title: 'X-Men (comic book)', description: 'd' }), raw({ title: 'X-Men Legacy', source: 'googlebooks', publisher: 'Marvel' }), raw({ title: 'X-Men', kind: 'media', source: 'openlibrary', publisher: 'Fox' }), raw({ title: 'Batman', source: 'googlebooks' }));
		const pick = choose(q, ranked)!;
		assert.equal(pick.best.source, 'wikipedia');
		assert.deepEqual(pick.fill.map((c) => c.title), ['X-Men Legacy']);
		assert.equal(choose({ name: 'Zzzz' }, scored({ name: 'Zzzz' }, raw({ title: 'Batman' }))), undefined);
	});
	it('lenders are asked in source order, not score order', () => {
		const q = { name: 'Batman' };
		const pick = choose(q, scored(q, raw({ title: 'Batman (comic book)' }), raw({ title: 'Batman', source: 'openlibrary' }), raw({ title: 'Batman', kind: 'character' })))!;
		assert.deepEqual(pick.fill.map((c) => c.source), ['wikipedia', 'openlibrary']);
	});
	it('generic short titles need year/publisher/creator corroboration or two agreeing sources', () => {
		const one = raw({ title: 'The Long Road', publisher: 'Demo Press' });
		assert.equal(choose({ name: 'The Long Road' }, scored({ name: 'The Long Road' }, one)), undefined);
		assert.ok(choose({ name: 'The Long Road', publisher: 'Demo Press' }, scored({ name: 'The Long Road' }, one)));
		assert.ok(choose({ name: 'The Long Road' }, scored({ name: 'The Long Road' }, one, raw({ title: 'Long Road', source: 'anilist' }))));
	});
	it('fills only missing fields, never an end year for an ongoing series, never an end before the start', () => {
		const best: MetaCandidate = { source: 'wikipedia', title: 'A', score: 1, genres: ['Horror'], status: 'ongoing' };
		const filler: MetaCandidate = { source: 'anilist', title: 'A', score: 0.9, genres: ['Other'], publisher: 'Image', startYear: 2000, endYear: 2010, creators: ['X'], related: ['B'], description: 'D' };
		const m = fillGaps(best, [filler]);
		assert.deepEqual([m.genres, m.publisher, m.startYear, m.endYear, m.creators, m.related, m.description], [['Horror'], 'Image', 2000, undefined, ['X'], ['B'], 'D']);
		const ended = fillGaps({ ...best, status: undefined, startYear: 2012 }, [filler]);
		assert.equal(ended.endYear, undefined); // 2010 < 2012
		assert.equal(isComplete(m), true);
		assert.equal(isComplete({ ...m, genres: [] }), false);
	});
});
