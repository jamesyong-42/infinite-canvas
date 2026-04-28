import type { LayoutEngine, Modifiers } from '../ecs/engine/index.js';
import { DEAD_ZONE_TOUCH_PX } from '../ecs/interaction-constants.js';

/**
 * Gesture state for the touch path.
 *
 * `tracking-entity` means a single finger landed on a widget. The bus does
 * NOT drive the engine in this state — `PointerEventBus` (RFC-006) handles
 * selection, drag, capture, and click synthesis via the synthesized native
 * pointer events that fire alongside touch. The bus stays subscribed only
 * to detect a multi-touch upgrade (1 finger → 2 fingers becomes pinch).
 */
type TouchGesture =
	| { type: 'idle' }
	| { type: 'pending-pan'; x: number; y: number; time: number }
	| { type: 'panning'; lastX: number; lastY: number }
	| { type: 'tracking-entity' }
	| { type: 'pinching'; lastDist: number; lastCx: number; lastCy: number };

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
const TOUCH_GESTURE_IDLE_MS = 200;

/**
 * Touch counterpart to {@link PointerEventBus} (RFC-007). Owns the
 * canvas-level gesture state machine — pinch, two-finger pan, single-finger
 * pan on empty space, double-tap zoom on empty space — and stays out of
 * single-finger entity interactions.
 *
 * Single-finger interactions on a widget (tap, click, drag, focus an
 * `<input>`, press a `<button>`, R3F mesh `onClick`) are driven by the
 * browser's synthesized pointer/click events, which flow naturally to
 * `PointerEventBus` and R3F's `EventRouter`. Letting them through is the
 * point: it's the same code path desktop uses, so widget authors write one
 * set of handlers and they work everywhere.
 *
 * The trick is `e.preventDefault()` discipline:
 * - On a widget hit (`engine.pickAt` non-null): NO preventDefault. The
 *   browser is free to synthesize pointerdown / pointermove / pointerup /
 *   click / dblclick from the touch sequence. `touch-action: none` on the
 *   container already suppresses scroll / zoom / browser double-tap-zoom,
 *   so leaking through doesn't cause unwanted defaults.
 * - On empty space, on pinch, on double-tap zoom, during pan: YES
 *   preventDefault. The bus owns the gesture and we don't want a parallel
 *   pointer-driven interaction (e.g. marquee instead of pan).
 *
 * Multi-touch upgrade cancels any pointer-driven interaction in progress
 * via `engine.handlePointerCancel()` so the engine state is clean before
 * pinch math takes over.
 */
export class TouchEventBus {
	private gesture: TouchGesture = { type: 'idle' };
	private lastTapTime = 0;
	private lastTapX = 0;
	private lastTapY = 0;
	private gestureClearTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly engine: LayoutEngine,
		private readonly getContainer: () => HTMLDivElement | null,
	) {}

	onTouchStart = (e: TouchEvent): void => {
		try {
			this.handleTouchStart(e);
		} finally {
			this.syncGesturing();
		}
	};

	onTouchMove = (e: TouchEvent): void => {
		try {
			this.handleTouchMove(e);
		} finally {
			this.syncGesturing();
		}
	};

	onTouchEnd = (e: TouchEvent): void => {
		try {
			this.handleTouchEnd(e);
		} finally {
			this.syncGesturing();
		}
	};

	onTouchCancel = (_e: TouchEvent): void => {
		try {
			this.gesture = { type: 'idle' };
			this.engine.handlePointerCancel();
		} finally {
			this.syncGesturing();
		}
	};

	dispose(): void {
		if (this.gestureClearTimer !== null) {
			clearTimeout(this.gestureClearTimer);
			this.gestureClearTimer = null;
		}
		this.engine.setGesturing(false);
	}

	/** Test seam — read-only snapshot of the internal gesture state. */
	_getGesture(): TouchGesture {
		return this.gesture;
	}

	private handleTouchStart(e: TouchEvent): void {
		const rect = this.getRect();
		const touches = e.touches;

		if (touches.length >= 2) {
			e.preventDefault();
			// Cancel any pointer-driven interaction (drag, marquee, tracking)
			// the engine started in response to the first finger's synthesized
			// pointerdown — pinch overrides single-touch.
			this.engine.handlePointerCancel();
			const dist = touchDist(touches[0], touches[1]);
			const center = touchCenter(touches[0], touches[1], rect);
			this.gesture = {
				type: 'pinching',
				lastDist: dist,
				lastCx: center.x,
				lastCy: center.y,
			};
			return;
		}

		const touch = touches[0];
		const x = touch.clientX - rect.left;
		const y = touch.clientY - rect.top;

		// Native form interactives — let the browser handle the touch fully
		// (focus, button activation, etc.). No preventDefault, no engine call.
		if (isInteractive(e.target)) return;

		const now = Date.now();
		if (
			now - this.lastTapTime < DOUBLE_TAP_MS &&
			Math.abs(x - this.lastTapX) < DOUBLE_TAP_DIST &&
			Math.abs(y - this.lastTapY) < DOUBLE_TAP_DIST &&
			this.engine.pickAt(x, y) === null
		) {
			// Empty-space double-tap zoom. Entity double-tap is handled by
			// `PointerEventBus.onDoubleClick` via the browser's native dblclick.
			e.preventDefault();
			this.lastTapTime = 0;
			const camera = this.engine.getCamera();
			const target = camera.zoom < 0.9 ? 1 : camera.zoom < 1.8 ? 2 : 1;
			this.engine.zoomAtPoint(x, y, (target - camera.zoom) / camera.zoom);
			this.engine.markDirty();
			this.gesture = { type: 'idle' };
			return;
		}

		if (this.engine.pickAt(x, y) !== null) {
			// On a widget — let `PointerEventBus` (and R3F's `EventRouter`)
			// drive selection / drag / click via the synthesized native
			// pointer events. We track the touch only so we can detect the
			// 1→2 finger upgrade to pinch.
			this.gesture = { type: 'tracking-entity' };
			return;
		}

		// Empty space — own the gesture. preventDefault so the browser
		// doesn't fire a synthesized pointerdown that would start a marquee.
		e.preventDefault();
		this.gesture = { type: 'pending-pan', x, y, time: now };
	}

	private handleTouchMove(e: TouchEvent): void {
		const rect = this.getRect();
		const touches = e.touches;

		if (this.gesture.type === 'pinching' && touches.length >= 2) {
			e.preventDefault();
			const dist = touchDist(touches[0], touches[1]);
			const center = touchCenter(touches[0], touches[1], rect);
			const scale = dist / this.gesture.lastDist;
			this.engine.zoomAtPoint(center.x, center.y, scale - 1);
			this.engine.panBy(center.x - this.gesture.lastCx, center.y - this.gesture.lastCy);
			this.gesture.lastDist = dist;
			this.gesture.lastCx = center.x;
			this.gesture.lastCy = center.y;
			return;
		}

		if (touches.length >= 2) {
			e.preventDefault();
			this.engine.handlePointerCancel();
			const dist = touchDist(touches[0], touches[1]);
			const center = touchCenter(touches[0], touches[1], rect);
			this.gesture = {
				type: 'pinching',
				lastDist: dist,
				lastCx: center.x,
				lastCy: center.y,
			};
			return;
		}

		if (touches.length < 1) return;
		const touch = touches[0];
		const x = touch.clientX - rect.left;
		const y = touch.clientY - rect.top;

		if (this.gesture.type === 'pending-pan') {
			e.preventDefault();
			if (
				Math.abs(x - this.gesture.x) > DEAD_ZONE_TOUCH_PX ||
				Math.abs(y - this.gesture.y) > DEAD_ZONE_TOUCH_PX
			) {
				this.gesture = { type: 'panning', lastX: x, lastY: y };
			}
			return;
		}

		if (this.gesture.type === 'panning') {
			e.preventDefault();
			this.engine.panBy(x - this.gesture.lastX, y - this.gesture.lastY);
			this.gesture.lastX = x;
			this.gesture.lastY = y;
			return;
		}

		// `tracking-entity` / `idle` — pointer events drive whatever happens
		// (drag, hover, capture). We don't preventDefault and don't call
		// the engine; doing either would double-dispatch with PointerEventBus.
	}

	private handleTouchEnd(e: TouchEvent): void {
		const remaining = e.touches.length;
		const rect = this.getRect();

		if (this.gesture.type === 'pinching') {
			e.preventDefault();
			if (remaining === 1) {
				const t = e.touches[0];
				this.gesture = {
					type: 'panning',
					lastX: t.clientX - rect.left,
					lastY: t.clientY - rect.top,
				};
			} else if (remaining === 0) {
				this.gesture = { type: 'idle' };
			}
			return;
		}

		if (remaining > 0) return;

		if (this.gesture.type === 'pending-pan') {
			// Empty-space tap: synthesize a pointerdown/up on the engine so
			// it can clear selection / commit marquee-of-zero. preventDefault
			// was already called on touchstart for this branch, so no native
			// pointer events fired — the engine doesn't see this tap from
			// PointerEventBus.
			e.preventDefault();
			this.engine.handlePointerDown(this.gesture.x, this.gesture.y, 0, NO_MODS);
			this.engine.handlePointerUp();
			this.engine.markDirty();
			this.lastTapTime = Date.now();
			this.lastTapX = this.gesture.x;
			this.lastTapY = this.gesture.y;
		} else if (this.gesture.type === 'panning') {
			e.preventDefault();
		}

		// `tracking-entity` end: pointer events deliver the natural
		// pointerup → click → React onClick chain. We do nothing.

		this.gesture = { type: 'idle' };
	}

	private getRect(): DOMRect {
		return this.getContainer()?.getBoundingClientRect() ?? new DOMRect();
	}

	// View-manipulation gestures (pinch / two-finger pan / single-finger pan)
	// toggle the engine's gesturing flag so render layers can defer expensive
	// work. `false` is debounced with the same idle window as the wheel
	// handler so rapid pinch cycles don't trigger a band-repaint storm
	// between gestures. `true` is set immediately so the deferral takes
	// effect on the very first frame of a new gesture.
	private syncGesturing(): void {
		const isView = this.gesture.type === 'pinching' || this.gesture.type === 'panning';
		if (isView) {
			if (this.gestureClearTimer !== null) {
				clearTimeout(this.gestureClearTimer);
				this.gestureClearTimer = null;
			}
			this.engine.setGesturing(true);
		} else if (this.gestureClearTimer === null) {
			this.gestureClearTimer = setTimeout(() => {
				this.engine.setGesturing(false);
				this.gestureClearTimer = null;
			}, TOUCH_GESTURE_IDLE_MS);
		}
	}
}

function touchDist(t1: Touch, t2: Touch): number {
	const dx = t1.clientX - t2.clientX;
	const dy = t1.clientY - t2.clientY;
	return Math.sqrt(dx * dx + dy * dy);
}

function touchCenter(t1: Touch, t2: Touch, rect: DOMRect): { x: number; y: number } {
	return {
		x: (t1.clientX + t2.clientX) / 2 - rect.left,
		y: (t1.clientY + t2.clientY) / 2 - rect.top,
	};
}

function isInteractive(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	return (
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'BUTTON' ||
		tag === 'SELECT' ||
		el.isContentEditable ||
		el.closest('button') !== null
	);
}
