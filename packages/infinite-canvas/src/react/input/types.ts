import type { EntityId } from '@jamesyong42/reactive-ecs';
import type { LayoutEngine } from '../../ecs/engine/index.js';

/**
 * RFC-008 input pipeline types — the single source of truth for the
 * adapter / recognizer / router / manager contract.
 *
 * The pipeline is:
 *
 *   native event → Adapter → InputManager.dispatch
 *                            ├─ WidgetSurfaceRouter (DOM | WebGL)
 *                            ├─ Engine handlers (drag, marquee, camera, …)
 *                            └─ Recognizer.observe (drag-start, tap, …)
 *
 * Halt and ownership are NOT methods on InputEvent — they're DOM
 * primitives:
 *   - `setPointerCapture(event.pointerId)` on a DOM element claims the
 *     gesture; subsequent native events bypass the canvas container
 *     entirely (so the InputManager doesn't see them).
 *   - `event.native.stopPropagation()` halts native bubble before reaching
 *     adapter listeners.
 *
 * Authors of widget components don't need to import any of these types.
 * They use plain React/R3F handlers and native DOM mechanisms. These
 * types describe the framework-internal contract.
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export interface Point {
	x: number;
	y: number;
}

export interface AABB {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Modifiers {
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
}

/** Widget rendering surface. Mirrors `components.ts` `Widget.surface`. */
export type Surface = 'dom' | 'webgl' | 'webview';

/** `null` for events with no associated button (move, wheel) or pen-air-tap. */
export type Button = 0 | 1 | 2 | null;

// ---------------------------------------------------------------------------
// Event taxonomy
// ---------------------------------------------------------------------------

export type InputEventType =
	// Raw, emitted by adapters
	| 'down'
	| 'move'
	| 'up'
	| 'cancel'
	| 'wheel'
	// Synthetic, emitted by recognizers
	| 'tap'
	| 'double-tap'
	| 'drag-start'
	| 'drag-update'
	| 'drag-end'
	| 'pinch-start'
	| 'pinch-update'
	| 'pinch-end'
	| 'pan-update'
	| 'hover-enter'
	| 'hover-leave';

export type InputSource = 'mouse' | 'pen' | 'touch' | 'wheel' | 'synthetic';

export type GestureDetail =
	| {
			kind: 'drag';
			phase: 'start' | 'update' | 'end';
			total: Point;
			delta: Point;
	  }
	| {
			kind: 'pinch';
			phase: 'start' | 'update' | 'end';
			scale: number;
			center: Point;
	  }
	| { kind: 'pan'; delta: Point }
	| { kind: 'tap'; count: 1 | 2 }
	| { kind: 'hover'; entityId: EntityId | null };

export interface InputEvent {
	readonly type: InputEventType;
	readonly source: InputSource;

	/** Stable per pointer for the lifetime of the press (mouse, pen, finger). */
	readonly pointerId: number;
	/** True for the first finger / left mouse button / primary pen tip. */
	readonly primary: boolean;

	/** Canvas-container relative pixels. */
	readonly screen: Readonly<Point>;
	/** Post-camera transform; world coordinates in the engine's coordinate space. */
	readonly world: Readonly<Point>;
	/** Movement since previous event of same pointerId. Defined for 'move', 'drag-update', 'pan-update', 'wheel'. */
	readonly delta?: Readonly<Point>;

	/** Defined for 'wheel' events. `pinch` true when ctrl/meta held (trackpad pinch). */
	readonly wheelDelta?: { dx: number; dy: number; pinch: boolean };

	/** Defined for 'down', 'up' events. */
	readonly button?: Button;

	readonly modifiers: Readonly<Modifiers>;
	/** ms since epoch (event.timeStamp on native, Date.now for synthetic). */
	readonly timestamp: number;

	/** Defined on synthetic recognizer-emitted events. */
	readonly gesture?: GestureDetail;

	/** Underlying native event. Adapters fill; routers may pass forward; handlers should rarely read directly. */
	readonly native?: Event;
}

// ---------------------------------------------------------------------------
// Pipeline components
// ---------------------------------------------------------------------------

export type Handler = (event: InputEvent) => void;

export interface Adapter {
	/**
	 * Register native event listeners on `container`. Each listener calls
	 * `manager.dispatch(...)` with a normalised InputEvent. Returns a
	 * detacher that removes the listeners.
	 */
	attach(container: HTMLElement, manager: InputManager): () => void;
}

export interface Recognizer {
	/**
	 * Called by InputManager.dispatch after handlers have run. Recognizers
	 * track per-pointerId state and may call manager.dispatch with synthetic
	 * events (which then re-enter dispatch normally).
	 */
	observe(event: InputEvent, manager: InputManager): void;

	/** Optional cleanup if InputManager is disposed mid-gesture. */
	reset?(): void;
}

export interface WidgetSurfaceRouter {
	/** The surface this router handles. */
	readonly surface: Surface;

	/**
	 * Deliver `event` to the widget identified by `entityId`. The router is
	 * responsible for invoking the surface-specific dispatch (e.g., for R3F:
	 * pre-configure raycaster, invoke R3F's mesh dispatch).
	 *
	 * Routers are invoked by InputManager.dispatch BEFORE engine handlers,
	 * so widget mesh handlers (which may setPointerCapture) can claim a
	 * gesture before the engine reacts.
	 */
	route(event: InputEvent, entityId: EntityId): void;
}

export interface InputManager {
	/** Engine reference exposed for handlers and recognizers that need it. */
	readonly engine: LayoutEngine;

	/** Mount adapters on the container; returns a teardown function. */
	attach(): () => void;

	/** Register an engine-level handler at the manager root. */
	on(type: InputEventType, handler: Handler): () => void;

	/** Register a recognizer. */
	addRecognizer(r: Recognizer): () => void;

	/**
	 * Register a router for a specific widget surface. Only one router per
	 * surface; re-registering replaces the previous.
	 */
	setRouter(router: WidgetSurfaceRouter): () => void;

	/**
	 * Entry point. Adapters and recognizers call this. Order:
	 *   1. If raw 'down'/'move'/'up'/'cancel' AND world coords hit an entity
	 *      AND that entity's surface has a router → router.route(event, entityId).
	 *   2. Fire all registered handlers for event.type.
	 *   3. Recognizers observe.
	 *
	 * try/catch around each handler/recognizer/router — one bad handler
	 * doesn't break the pipeline.
	 */
	dispatch(event: InputEvent): void;

	/**
	 * Hit-test service exposed to recognizers and engine handlers.
	 * Takes screen-space (canvas-container relative px) to match
	 * `engine.pickAt(screenX, screenY)`.
	 */
	pickAt(screen: Point): EntityId | null;

	/**
	 * Single source for `engine.setGesturing(true)` plus a debounced
	 * `engine.setGesturing(false)` after `GESTURING_IDLE_MS` of inactivity.
	 */
	notifyGesturing(): void;
}
