/**
 * Pointer-event gestures for the full-screen reader surface: tap zones, swipe, double-tap zoom,
 * pinch + pan, mouse wheel (ctrl+wheel = zoom). One element, no per-page listeners.
 *
 * The host owns the view (it applies transforms); this module only decides what a gesture means.
 * Elements inside the surface can opt out with `data-nogesture` (buttons, error placeholders).
 */
import { tapZone } from './spread.ts';
import type { Zone } from './spread.ts';
import { DOUBLE_TAP_SCALE, isZoomed, panBy, pinchView, zoomAt } from './view.ts';
import type { Size, View } from './view.ts';

export interface GestureHost {
	/** Current geometry. `tapZones` false → every tap is a centre tap. */
	state(): { view: View; content: Size; viewport: Size; tapZones: boolean };
	/** Apply a (clamped) view. `animate` = short eased transition, used for double-tap zoom. */
	setView(view: View, animate?: boolean): void;
	/** Back to the fitted, anchored view. */
	reset(animate?: boolean): void;
	/** A confirmed tap. Side zones fire at once; the centre waits out the double-tap window. */
	tap(zone: Zone): void;
	/** Horizontal swipe by `dx` px of overscroll (< 0 = towards the left). Never fired while zoomed. */
	swipe(dx: number): void;
	/** Mouse-wheel page flip: +1 forward, -1 back. */
	wheel(dir: 1 | -1): void;
}

const SLOP = 10; // px before a press becomes a drag
const SWIPE = 50; // px dragged past the edge that flips a page
const DOUBLE_MS = 280;
const DOUBLE_PX = 48;
const TAP_MS = 600;

interface Drag {
	id: number;
	sx: number;
	sy: number;
	lx: number;
	ly: number;
	t: number;
	moved: boolean;
	overX: number;
	overY: number;
	noFlip: boolean;
}
interface Pinch {
	view: View;
	cx: number;
	cy: number;
	d: number;
}

export function attachGestures(el: HTMLElement, host: GestureHost): () => void {
	const pointers = new Map<number, { x: number; y: number }>();
	let drag: Drag | undefined;
	let pinch: Pinch | undefined;
	let pending: { x: number; y: number; t: number; timer: number } | undefined;
	let lastWheel = 0;
	let lastFlip = 0;

	const local = (e: { clientX: number; clientY: number }) => {
		const r = el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	const cancelPending = () => {
		if (pending) window.clearTimeout(pending.timer);
		pending = undefined;
	};
	/** A centre tap that was waiting for a second tap which never came (or came elsewhere). */
	const flushPending = () => {
		if (!pending) return;
		cancelPending();
		host.tap('center');
	};

	function startPinch() {
		const [a, b] = [...pointers.values()];
		pinch = { view: host.state().view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
		drag = undefined;
		cancelPending();
	}

	function updatePinch() {
		if (!pinch) return;
		const [a, b] = [...pointers.values()];
		const st = host.state();
		host.setView(
			pinchView(
				pinch.view,
				{ x: pinch.cx, y: pinch.cy },
				pinch.d,
				{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
				Math.hypot(a.x - b.x, a.y - b.y),
				st.content,
				st.viewport
			)
		);
	}

	function toggleZoom(x: number, y: number) {
		const st = host.state();
		if (isZoomed(st.view)) host.reset(true);
		else host.setView(zoomAt(st.view, DOUBLE_TAP_SCALE, x, y, st.content, st.viewport), true);
	}

	function tap(x: number, y: number, t: number) {
		const st = host.state();
		if (pending && t - pending.t <= DOUBLE_MS && Math.hypot(x - pending.x, y - pending.y) <= DOUBLE_PX) {
			cancelPending();
			toggleZoom(x, y);
			return;
		}
		flushPending();
		// Zoomed or zones off: every tap is a plain "toggle controls" tap.
		const zone: Zone = !st.tapZones || isZoomed(st.view) ? 'center' : tapZone(x / Math.max(1, st.viewport.w));
		if (zone !== 'center') {
			host.tap(zone); // page flips must feel instant, so they never wait for a second tap
			return;
		}
		pending = {
			x,
			y,
			t,
			timer: window.setTimeout(() => {
				pending = undefined;
				host.tap('center');
			}, DOUBLE_MS)
		};
	}

	function onDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if ((e.target as Element | null)?.closest?.('[data-nogesture]')) return;
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			/* pointer already gone */
		}
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pointers.size === 1) {
			drag = { id: e.pointerId, sx: p.x, sy: p.y, lx: p.x, ly: p.y, t: e.timeStamp, moved: false, overX: 0, overY: 0, noFlip: false };
			pinch = undefined;
		} else if (pointers.size === 2) {
			startPinch();
		}
	}

	function onMove(e: PointerEvent) {
		const p = pointers.get(e.pointerId);
		if (!p) return;
		const c = local(e);
		p.x = c.x;
		p.y = c.y;
		if (pinch) {
			updatePinch();
			return;
		}
		if (!drag || drag.id !== e.pointerId) return;
		if (!drag.moved) {
			if (Math.hypot(c.x - drag.sx, c.y - drag.sy) < SLOP) return;
			drag.moved = true;
		}
		const st = host.state();
		const r = panBy(st.view, c.x - drag.lx, c.y - drag.ly, st.content, st.viewport);
		drag.overX += r.overX;
		drag.overY += r.overY;
		drag.lx = c.x;
		drag.ly = c.y;
		if (r.view.x !== st.view.x || r.view.y !== st.view.y) host.setView(r.view);
	}

	function onUp(e: PointerEvent) {
		if (!pointers.delete(e.pointerId)) return;
		if (pinch) {
			if (pointers.size >= 2) {
				startPinch();
				return;
			}
			pinch = undefined;
			// One finger left: keep panning with it, never treat the rest of the gesture as a tap or swipe.
			const rest = [...pointers.entries()][0];
			if (rest) {
				const [id, q] = rest;
				drag = { id, sx: q.x, sy: q.y, lx: q.x, ly: q.y, t: e.timeStamp, moved: true, overX: 0, overY: 0, noFlip: true };
			}
			return;
		}
		if (!drag || drag.id !== e.pointerId) return;
		const d = drag;
		drag = undefined;
		if (e.type === 'pointercancel') return;
		if (d.moved) {
			// Dragging past the edge of the content (everything, when nothing overflows) = swipe to flip.
			if (!d.noFlip && !isZoomed(host.state().view) && Math.abs(d.overX) >= SWIPE && Math.abs(d.overX) > Math.abs(d.overY)) host.swipe(d.overX);
			return;
		}
		if (e.timeStamp - d.t <= TAP_MS) tap(d.sx, d.sy, e.timeStamp);
	}

	/** Capture lost without a pointerup (tab switch, system gesture): forget the pointer, do nothing. */
	function onLost(e: PointerEvent) {
		if (!pointers.delete(e.pointerId)) return;
		pinch = undefined;
		drag = undefined;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const st = host.state();
		const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? st.viewport.h : 1;
		const dx = e.deltaX * k;
		const dy = e.deltaY * k;
		const burstStart = e.timeStamp - lastWheel > 150;
		lastWheel = e.timeStamp;
		if (e.ctrlKey) {
			// Also what a trackpad pinch looks like to the page.
			const p = local(e);
			host.setView(zoomAt(st.view, st.view.s * Math.exp(-dy * 0.0025), p.x, p.y, st.content, st.viewport));
			return;
		}
		const r = panBy(st.view, -dx, -dy, st.content, st.viewport);
		if (r.view.x !== st.view.x || r.view.y !== st.view.y) {
			host.setView(r.view);
			return;
		}
		// Nothing left to scroll: a deliberate wheel flips (once per burst, so inertia can't skip pages).
		const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
		if (isZoomed(st.view) || !burstStart || Math.abs(d) < 4 || e.timeStamp - lastFlip < 250) return;
		lastFlip = e.timeStamp;
		host.wheel(d > 0 ? 1 : -1);
	}

	const noMenu = (e: Event) => e.preventDefault();

	el.addEventListener('pointerdown', onDown);
	el.addEventListener('pointermove', onMove);
	el.addEventListener('pointerup', onUp);
	el.addEventListener('pointercancel', onUp);
	el.addEventListener('lostpointercapture', onLost);
	el.addEventListener('wheel', onWheel, { passive: false });
	el.addEventListener('contextmenu', noMenu);

	return () => {
		cancelPending();
		el.removeEventListener('pointerdown', onDown);
		el.removeEventListener('pointermove', onMove);
		el.removeEventListener('pointerup', onUp);
		el.removeEventListener('pointercancel', onUp);
		el.removeEventListener('lostpointercapture', onLost);
		el.removeEventListener('wheel', onWheel);
		el.removeEventListener('contextmenu', noMenu);
		pointers.clear();
	};
}
