import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	lastStart,
	nextStart,
	pageLabel,
	preloadOrder,
	prevStart,
	resolveRtl,
	spreadFrom,
	spreadStartOf,
	swipeDirection,
	tapZone,
	visualOrder,
	wantsSpread,
	zoneDirection
} from './spread.ts';

const none = () => false;
const wide =
	(...ids: number[]) =>
	(i: number) =>
		ids.includes(i);

/** Every spread in reading order, walking with nextStart. */
function walk(count: number, paired: boolean, w: (i: number) => boolean): number[][] {
	const out: number[][] = [];
	for (let s: number | undefined = 0; s !== undefined; s = nextStart(s, count, paired, w)) {
		out.push(spreadFrom(s, count, paired, w));
	}
	return out;
}

test('single mode: every page alone', () => {
	assert.deepEqual(spreadFrom(3, 10, false, none), [3]);
	assert.equal(spreadStartOf(7, 10, false, none), 7);
	assert.equal(nextStart(4, 10, false, none), 5);
	assert.equal(prevStart(4, 10, false, none), 3);
	assert.equal(nextStart(9, 10, false, none), undefined);
	assert.equal(prevStart(0, 10, false, none), undefined);
});

test('double mode: cover alone, then pairs', () => {
	assert.deepEqual(spreadFrom(0, 10, true, none), [0]);
	assert.deepEqual(spreadFrom(1, 10, true, none), [1, 2]);
	assert.deepEqual(spreadFrom(3, 10, true, none), [3, 4]);
	assert.deepEqual(walk(6, true, none), [[0], [1, 2], [3, 4], [5]]);
	assert.deepEqual(walk(5, true, none), [[0], [1, 2], [3, 4]]);
	assert.deepEqual(walk(2, true, none), [[0], [1]]);
	assert.deepEqual(walk(1, true, none), [[0]]);
});

test('wide pages are alone and pairing restarts after them', () => {
	assert.deepEqual(walk(8, true, wide(3)), [[0], [1, 2], [3], [4, 5], [6, 7]]);
	// page 2 is wide, so page 1 cannot pair with it
	assert.deepEqual(walk(5, true, wide(2)), [[0], [1], [2], [3, 4]]);
	// a wide cover is still just the cover
	assert.deepEqual(walk(4, true, wide(0)), [[0], [1, 2], [3]]);
});

test('spreadStartOf / prevStart agree with the walk', () => {
	for (const w of [none, wide(3), wide(2, 6), wide(1)]) {
		const spreads = walk(9, true, w);
		for (const s of spreads) for (const page of s) assert.equal(spreadStartOf(page, 9, true, w), s[0]);
		for (let k = spreads.length - 1; k > 0; k--) assert.equal(prevStart(spreads[k][0], 9, true, w), spreads[k - 1][0]);
		assert.equal(prevStart(0, 9, true, w), undefined);
		assert.equal(lastStart(9, true, w), spreads[spreads.length - 1][0]);
	}
	assert.equal(lastStart(10, true, none), 9);
	assert.equal(lastStart(9, true, none), 7);
});

test('out-of-range input is safe', () => {
	assert.deepEqual(spreadFrom(10, 10, true, none), []);
	assert.deepEqual(spreadFrom(-1, 10, true, none), []);
	assert.equal(spreadStartOf(99, 10, true, none), 9);
	assert.equal(spreadStartOf(-5, 10, true, none), 0);
	assert.equal(spreadStartOf(3, 0, true, none), 0);
});

test('right-to-left reverses the visual order without mutating', () => {
	const pages = [3, 4];
	assert.deepEqual(visualOrder(pages, false), [3, 4]);
	assert.deepEqual(visualOrder(pages, true), [4, 3]);
	assert.deepEqual(pages, [3, 4]);
});

test('direction resolution', () => {
	assert.equal(resolveRtl('auto', true, false), true);
	assert.equal(resolveRtl('auto', false, true), true);
	assert.equal(resolveRtl('auto', false, false), false);
	assert.equal(resolveRtl('auto'), false);
	assert.equal(resolveRtl('ltr', true, true), false);
	assert.equal(resolveRtl('rtl', false, false), true);
});

test('auto spread follows the window orientation', () => {
	assert.equal(wantsSpread('auto', 1280, 800), true);
	assert.equal(wantsSpread('auto', 800, 1280), false);
	assert.equal(wantsSpread('auto', 1000, 950), false);
	assert.equal(wantsSpread('auto', 0, 0), false);
	assert.equal(wantsSpread('double', 800, 1280), true);
	assert.equal(wantsSpread('single', 1280, 800), false);
});

test('tap zones are 30 / 40 / 30 and direction aware', () => {
	assert.equal(tapZone(0), 'left');
	assert.equal(tapZone(0.29), 'left');
	assert.equal(tapZone(0.3), 'center');
	assert.equal(tapZone(0.5), 'center');
	assert.equal(tapZone(0.7), 'center');
	assert.equal(tapZone(0.71), 'right');
	assert.equal(tapZone(1), 'right');
	assert.equal(zoneDirection('right', false), 1);
	assert.equal(zoneDirection('left', false), -1);
	assert.equal(zoneDirection('right', true), -1);
	assert.equal(zoneDirection('left', true), 1);
	assert.equal(zoneDirection('center', true), 0);
});

test('swipe direction', () => {
	assert.equal(swipeDirection(-80, false), 1);
	assert.equal(swipeDirection(80, false), -1);
	assert.equal(swipeDirection(-80, true), -1);
	assert.equal(swipeDirection(80, true), 1);
});

test('preload window: [current−1 … current+preload+1], one extra page each side for spreads', () => {
	assert.deepEqual(preloadOrder([5], 20, 2, false), [5, 6, 7, 8, 4]);
	assert.deepEqual(preloadOrder([0], 3, 2, false), [0, 1, 2]);
	assert.deepEqual(preloadOrder([19], 20, 2, false), [19, 18]);
	assert.deepEqual(preloadOrder([3, 4], 20, 2, true), [3, 4, 5, 6, 7, 8, 2, 1]);
	assert.deepEqual(preloadOrder([5], 20, 0, false), [5, 6, 4]);
	assert.deepEqual(preloadOrder([5], 20, Number.NaN, false), [5, 6, 7, 8, 4]);
	assert.deepEqual(preloadOrder([], 20, 2, false), []);
});

test('page label', () => {
	assert.equal(pageLabel([6], 32), '7 / 32');
	assert.equal(pageLabel([5, 6], 32), '6–7 / 32');
	assert.equal(pageLabel([], 32), '');
});
