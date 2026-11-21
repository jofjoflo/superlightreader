import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGenre, normalizeGenres } from './genres.ts';

test('aliases collapse to one label', () => {
	for (const g of ['Science Fiction', 'sci-fi', 'Sci Fi', 'science fiction comics', 'SF']) assert.equal(normalizeGenre(g), 'Sci-Fi');
	for (const g of ['Superhero', 'superheroes', 'Superhero comics', 'Superhjälte']) assert.equal(normalizeGenre(g), 'Superhero');
	assert.equal(normalizeGenre('crime comic'), 'Crime');
	assert.equal(normalizeGenre('Skräck'), 'Horror');
	assert.equal(normalizeGenre('Komedi'), 'Humor');
});

test('generic labels are dropped', () => {
	for (const g of ['Comics & graphic novels', 'Comic books, strips', 'comics', 'Fiction', 'comics of the United States', '  ', '']) assert.equal(normalizeGenre(g), undefined);
});

test('unknown labels are title-cased, small words kept lower', () => {
	assert.equal(normalizeGenre('slice of life'), 'Slice of Life');
	assert.equal(normalizeGenre('anthropomorphic comic'), 'Anthropomorphic');
});

test('library-subject noise is dropped', () => {
	for (const g of ['Spider-man (fictitious character), fiction', 'Modern fiction', 'Graphic Satire And Humor', 'Juvenile fiction']) assert.equal(normalizeGenre(g), undefined);
	assert.equal(normalizeGenre('Cartoons and comics'), undefined);
	assert.equal(normalizeGenre('crime fiction'), 'Crime');
	assert.equal(normalizeGenre('alternate history comics'), 'Alternate History');
});

test('normalizeGenres de-duplicates and keeps order', () => {
	assert.deepEqual(normalizeGenres(['science fiction', 'Comics & graphic novels', 'Sci-Fi', 'horror comics', 'Fantasy']), ['Sci-Fi', 'Horror', 'Fantasy']);
	assert.deepEqual(normalizeGenres(undefined), []);
});
