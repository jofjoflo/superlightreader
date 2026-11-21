import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileName, parsePath, seriesKey, seriesDisplayName } from './name.ts';

// [file, series, number, year, volume, kind, title]
const FILES: [string, string, number | undefined, number | undefined, number | undefined, string, string | undefined][] = [
	['X-Men 020 (2025).cbz', 'X-Men', 20, 2025, undefined, 'issue', undefined],
	['Saga 001 (2012) (Digital) (Zone-Empire).cbz', 'Saga', 1, 2012, undefined, 'issue', undefined],
	['Amazing Spider-Man #700.cbz', 'Amazing Spider-Man', 700, undefined, undefined, 'issue', undefined],
	['The Walking Dead 193 (2019) (digital) (Son of Ultron-Empire).cbr', 'The Walking Dead', 193, 2019, undefined, 'issue', undefined],
	['Batman v3 012 (2017).cbz', 'Batman', 12, 2017, 3, 'issue', undefined],
	['Batman v3 #12.cbz', 'Batman', 12, undefined, 3, 'issue', undefined],
	['Berserk v03.cbz', 'Berserk', 3, undefined, undefined, 'issue', undefined],
	['One Piece - Vol. 12 - Romance Dawn.cbz', 'One Piece', 12, undefined, undefined, 'issue', 'Romance Dawn'],
	['Kalle Anka & C:o 2021-03.cbz', 'Kalle Anka & C:o', 3, 2021, undefined, 'issue', undefined],
	['Fantomen Nr 12 2023.cbz', 'Fantomen', 12, 2023, undefined, 'issue', undefined],
	['Fantomen 12 2023.cbz', 'Fantomen', 12, 2023, undefined, 'issue', undefined],
	['Watchmen.cbz', 'Watchmen', undefined, undefined, undefined, 'oneshot', undefined],
	['Watchmen 1986.cbz', 'Watchmen', undefined, 1986, undefined, 'oneshot', undefined],
	['Spider-Man 2099 001.cbz', 'Spider-Man 2099', 1, undefined, undefined, 'issue', undefined],
	['100 Bullets 001.cbz', '100 Bullets', 1, undefined, undefined, 'issue', undefined],
	['100 Bullets.cbz', '100 Bullets', undefined, undefined, undefined, 'oneshot', undefined],
	['Sandman Annual 1.cbz', 'Sandman', 1, undefined, undefined, 'annual', undefined],
	['Hellboy_in_Hell_005_(2013).cbz', 'Hellboy in Hell', 5, 2013, undefined, 'issue', undefined],
	['Y - The Last Man 05 (of 60) (2003).cbz', 'Y - The Last Man', 5, 2003, undefined, 'issue', undefined],
	['Spawn 001.5.cbz', 'Spawn', 1.5, undefined, undefined, 'issue', undefined],
	['[Group] Title 12.cbz', 'Title', 12, undefined, undefined, 'issue', undefined],
	['Amazing.Spider-Man.700.cbz', 'Amazing Spider-Man', 700, undefined, undefined, 'issue', undefined],
	['Batman 1.CBZ', 'Batman', 1, undefined, undefined, 'issue', undefined],
	['Saga 001 - Chapter One.cbz', 'Saga', 1, undefined, undefined, 'issue', 'Chapter One']
];

for (const [file, series, number, year, volume, kind, title] of FILES)
	test(`parseFileName ${file}`, () => {
		const p = parseFileName(file);
		assert.deepEqual([p.series, p.number, p.year, p.volume, p.kind, p.title], [series, number, year, volume, kind, title]);
	});

test('numberLabel keeps the written form', () => {
	assert.equal(parseFileName('X-Men 020.cbz').numberLabel, '020');
});

test('parsePath: series folder, publisher, volume year', () => {
	const p = parsePath('Serier/Marvel/X-Men (1991)/X-Men 001.cbz');
	assert.deepEqual([p.folderSeries, p.volumeYear, p.publisher, p.name.number], ['X-Men', 1991, 'Marvel', 1]);
});
test('parsePath: generic or unrelated folders are ignored, file name wins', () => {
	assert.equal(parsePath('Comics/Saga 001.cbz').folderSeries, undefined);
	assert.equal(parsePath('Favorites/Saga 001.cbz').folderSeries, undefined);
	assert.equal(parsePath('Saga 001.cbz').folderSeries, undefined);
});
test('parsePath: folder named like the series', () => {
	assert.equal(parsePath('Downloads/Batman/Batman 012.cbz').folderSeries, 'Batman');
	assert.equal(parsePath('Demo/Manga/Berserk/Berserk v03.cbz').folderSeries, 'Berserk');
});

test('seriesKey / seriesDisplayName', () => {
	assert.equal(seriesKey('The Walking Dead'), seriesKey('Walking Dead'));
	assert.equal(seriesKey('Batman', 3, 2016), 'batman-v3-2016');
	assert.match(seriesKey('進撃の巨人'), /^s-/);
	assert.equal(seriesDisplayName('Batman', 3, 2016), 'Batman (2016)');
	assert.equal(seriesDisplayName('Batman', 3), 'Batman vol. 3');
	assert.equal(seriesDisplayName('Batman'), 'Batman');
});
