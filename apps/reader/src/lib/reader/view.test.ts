import { test } from 'node:test';
// Loose assert on purpose: -0 and 0 are the same position here.
import assert from 'node:assert';
import { anchorView, clampAxis, isZoomed, layoutPages, panBy, pinchView, zoomAt } from './view.ts';

const box = { w: 1000, h: 800 };

test('clampAxis centres small content and pins large content to the edges', () => {
	assert.equal(clampAxis(10, 400, 1000), 300);
	assert.equal(clampAxis(5, 1000, 1000), 0);
	assert.equal(clampAxis(50, 2000, 1000), 0);
	assert.equal(clampAxis(-5000, 2000, 1000), -1000);
	assert.equal(clampAxis(-300, 2000, 1000), -300);
});

test('layoutPages: one page, three fit modes', () => {
	const vp = { w: 1280, h: 800 };
	assert.deepEqual(layoutPages([2 / 3], vp, 'screen'), { content: { w: 533, h: 800 }, widths: [533], height: 800 });
	assert.deepEqual(layoutPages([2 / 3], vp, 'width'), { content: { w: 1280, h: 1920 }, widths: [1280], height: 1920 });
	assert.deepEqual(layoutPages([2 / 3], vp, 'height'), { content: { w: 533, h: 800 }, widths: [533], height: 800 });
});

test('layoutPages: a spread shares one height', () => {
	assert.deepEqual(layoutPages([2 / 3, 2 / 3], { w: 1280, h: 800 }, 'screen'), { content: { w: 1066, h: 800 }, widths: [533, 533], height: 800 });
	// portrait window: width is the limit
	assert.deepEqual(layoutPages([2 / 3, 2 / 3], { w: 800, h: 1280 }, 'screen'), { content: { w: 800, h: 600 }, widths: [400, 400], height: 600 });
	// different ratios are normalised to the same height
	const mixed = layoutPages([0.5, 1], { w: 900, h: 600 }, 'height');
	assert.deepEqual(mixed, { content: { w: 900, h: 600 }, widths: [300, 600], height: 600 });
});

test('layoutPages: unknown ratios fall back, empty viewport yields nothing', () => {
	assert.deepEqual(layoutPages([0, Number.NaN], { w: 1000, h: 1000 }, 'screen'), { content: { w: 1000, h: 750 }, widths: [500, 500], height: 750 });
	assert.deepEqual(layoutPages([2 / 3], { w: 0, h: 0 }, 'screen'), { content: { w: 0, h: 0 }, widths: [0], height: 0 });
});

test('zoomAt keeps the point under the finger and clamps', () => {
	const v = { s: 1, x: 0, y: 0 };
	assert.deepEqual(zoomAt(v, 2.5, 500, 400, box, box), { s: 2.5, x: -750, y: -600 });
	assert.deepEqual(zoomAt(v, 2.5, 0, 0, box, box), { s: 2.5, x: 0, y: 0 });
	assert.deepEqual(zoomAt(v, 2.5, 1000, 800, box, box), { s: 2.5, x: -1500, y: -1200 });
	assert.deepEqual(zoomAt(v, 10, 500, 400, box, box), { s: 5, x: -2000, y: -1600 });
	assert.deepEqual(zoomAt({ s: 2, x: -500, y: -400 }, 0.5, 500, 400, box, box), { s: 1, x: 0, y: 0 });
});

test('pinchView zooms about the centre and follows it', () => {
	const start = { s: 2, x: -500, y: -300 };
	const c0 = { x: 500, y: 400 };
	assert.deepEqual(pinchView(start, c0, 100, c0, 200, box, box), { s: 4, x: -1500, y: -1000 });
	assert.deepEqual(pinchView(start, c0, 100, { x: 600, y: 400 }, 200, box, box), { s: 4, x: -1400, y: -1000 });
	assert.deepEqual(pinchView(start, c0, 100, c0, 10, box, box), { s: 1, x: 0, y: 0 });
	assert.equal(pinchView(start, c0, 100, c0, 10000, box, box).s, 5);
});

test('panBy reports what did not fit', () => {
	const fit = { s: 1, x: 0, y: 0 };
	assert.deepEqual(panBy(fit, -80, 10, box, box), { view: fit, overX: -80, overY: 10 });
	const wide = { w: 2000, h: 800 };
	const at = { s: 1, x: -100, y: 0 };
	assert.deepEqual(panBy(at, 150, 0, wide, box), { view: { s: 1, x: 0, y: 0 }, overX: 50, overY: 0 });
	assert.deepEqual(panBy(at, -50, 0, wide, box), { view: { s: 1, x: -150, y: 0 }, overX: 0, overY: 0 });
});

test('anchorView starts at the reading edge', () => {
	const wide = { w: 2000, h: 800 };
	assert.deepEqual(anchorView(wide, box, false), { s: 1, x: 0, y: 0 });
	assert.deepEqual(anchorView(wide, box, true), { s: 1, x: -1000, y: 0 });
	assert.deepEqual(anchorView({ w: 500, h: 800 }, box, true), { s: 1, x: 250, y: 0 });
	assert.deepEqual(anchorView({ w: 1000, h: 1920 }, box, false), { s: 1, x: 0, y: 0 });
	assert.deepEqual(anchorView({ w: 1000, h: 400 }, box, false), { s: 1, x: 0, y: 200 });
});

test('isZoomed ignores tiny scale noise', () => {
	assert.equal(isZoomed({ s: 1.01, x: 0, y: 0 }), false);
	assert.equal(isZoomed({ s: 1.5, x: 0, y: 0 }), true);
});
