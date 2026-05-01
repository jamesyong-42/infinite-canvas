import type { EntityId } from '@jamesyong42/reactive-ecs';
import { Widget } from '../../ecs/components.js';
import type { LayoutEngine } from '../../ecs/engine/index.js';
import { GESTURING_IDLE_MS } from './constants.js';
import { inputGroupStart, inputLog } from './debug.js';
import type {
	Adapter,
	Handler,
	InputManager as IInputManager,
	InputEvent,
	InputEventType,
	Point,
	Recognizer,
	Surface,
	WidgetSurfaceRouter,
} from './types.js';

/**
 * RFC-008 input pipeline core. Adapters dispatch normalised InputEvents;
 * routers deliver to widget surfaces; engine handlers and recognizers
 * react.
 *
 * Lifecycle:
 *   1. Construct: `new InputManager(engine, container, [adapter, ...])`.
 *   2. Register handlers / recognizers / routers as needed.
 *   3. `attach()` — mounts adapters; returns detacher.
 *   4. Dispatch flows through automatically as native events arrive.
 *   5. Detacher tears down adapters and clears the gesturing debounce.
 */
export class InputManager implements IInputManager {
	private readonly handlers: Map<InputEventType, Set<Handler>> = new Map();
	private readonly recognizers: Recognizer[] = [];
	private readonly routers: Map<Surface, WidgetSurfaceRouter> = new Map();

	private gesturingClearTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		readonly engine: LayoutEngine,
		private readonly container: HTMLElement,
		private readonly adapters: Adapter[],
	) {}

	attach(): () => void {
		const detachers = this.adapters.map((a) => a.attach(this.container, this));
		return () => {
			for (const d of detachers) {
				try {
					d();
				} catch (err) {
					console.error('[InputManager] adapter detach threw', err);
				}
			}
			if (this.gesturingClearTimer !== null) {
				clearTimeout(this.gesturingClearTimer);
				this.gesturingClearTimer = null;
			}
			for (const r of this.recognizers) {
				try {
					r.reset?.();
				} catch (err) {
					console.error('[InputManager] recognizer reset threw', err);
				}
			}
		};
	}

	on(type: InputEventType, handler: Handler): () => void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler);
		return () => {
			const s = this.handlers.get(type);
			if (s) {
				s.delete(handler);
				if (s.size === 0) this.handlers.delete(type);
			}
		};
	}

	addRecognizer(r: Recognizer): () => void {
		this.recognizers.push(r);
		return () => {
			const i = this.recognizers.indexOf(r);
			if (i !== -1) this.recognizers.splice(i, 1);
		};
	}

	setRouter(router: WidgetSurfaceRouter): () => void {
		this.routers.set(router.surface, router);
		return () => {
			if (this.routers.get(router.surface) === router) {
				this.routers.delete(router.surface);
			}
		};
	}

	dispatch(event: InputEvent): void {
		const closeGroup = inputGroupStart(`dispatch ${event.type} id=${event.pointerId}`);
		inputLog('InputManager', `dispatch ${event.type}`, {
			type: event.type,
			source: event.source,
			pointerId: event.pointerId,
			screen: event.screen,
			world: event.world,
		});

		// 1. Surface routing for raw pointer events + browser-derived click
		//    family. Synthetic events (recognizer-emitted) bypass routing —
		//    they're already at the intent layer (drag, pinch, etc.) and
		//    don't need re-delivery to widget surfaces. `pointerleave` and
		//    `wheel` also bypass routing — the cursor is exiting (no entity
		//    to deliver to) or the event is whole-canvas (camera ops).
		if (
			(event.type === 'down' ||
				event.type === 'move' ||
				event.type === 'up' ||
				event.type === 'cancel' ||
				event.type === 'click' ||
				event.type === 'dblclick' ||
				event.type === 'contextmenu') &&
			event.source !== 'synthetic' &&
			this.routers.size > 0
		) {
			const entityId = this.engine.pickAt(event.screen.x, event.screen.y);
			if (entityId !== null) {
				const surface = this.surfaceOf(entityId);
				const router = surface !== null ? this.routers.get(surface) : undefined;
				inputLog('InputManager', `routing → ${surface ?? 'none'} entity=${entityId}`, {
					type: event.type,
					entityId,
					surface,
					hasRouter: !!router,
				});
				if (router) {
					try {
						router.route(event, entityId);
					} catch (err) {
						console.error('[InputManager] router threw', err);
					}
				}
			} else {
				inputLog('InputManager', `routing → empty space (pickAt null)`, {
					type: event.type,
					screen: event.screen,
				});
			}
		}

		// 1b. Claim check — after routers ran, ask each router whether
		//     this pointer is now exclusively held by a widget mesh
		//     (e.g. R3F's `setPointerCapture` populated capturedMap).
		//     Claimed pointers skip recognizer observation so the engine's
		//     drag / tap / pan recognizers don't react to a gesture the
		//     widget is handling itself.
		let claimed = false;
		if (event.source !== 'synthetic') {
			for (const router of this.routers.values()) {
				if (router.isPointerClaimed?.(event.pointerId)) {
					claimed = true;
					inputLog(
						'InputManager',
						`claim check → CLAIMED by ${router.surface} router (recognizers will skip)`,
						{ type: event.type, pointerId: event.pointerId },
					);
					break;
				}
			}
		}

		// 2. Engine and recognizer-subscribed handlers — always run. The
		//    `move` engine handler updates hover; other handlers respond to
		//    synthetic events (drag-start, tap, etc.) which are gated by
		//    recognizers, so claimed pointers naturally never produce
		//    synthetic events.
		const handlers = this.handlers.get(event.type);
		if (handlers && handlers.size > 0) {
			inputLog('InputManager', `handlers for ${event.type}: ${handlers.size} → firing`, {
				type: event.type,
				count: handlers.size,
			});
			for (const h of handlers) {
				try {
					h(event);
				} catch (err) {
					console.error('[InputManager] handler threw', err);
				}
			}
		}

		// 3. Recognizers observe (after handlers, so a handler that captured
		//    can affect what recognizers see — e.g. `engine.beginDrag` ran
		//    before DragRecognizer sees the next 'move'). Skipped entirely
		//    when a router claims the pointer.
		if (!claimed) {
			for (const r of this.recognizers) {
				try {
					r.observe(event, this);
				} catch (err) {
					console.error('[InputManager] recognizer threw', err);
				}
			}
		} else {
			inputLog('InputManager', `recognizers skipped (pointer claimed)`, {
				type: event.type,
				pointerId: event.pointerId,
			});
		}

		closeGroup();
	}

	pickAt(screen: Point): EntityId | null {
		return this.engine.pickAt(screen.x, screen.y);
	}

	notifyGesturing(): void {
		this.engine.setGesturing(true);
		if (this.gesturingClearTimer !== null) clearTimeout(this.gesturingClearTimer);
		this.gesturingClearTimer = setTimeout(() => {
			this.engine.setGesturing(false);
			this.gesturingClearTimer = null;
		}, GESTURING_IDLE_MS);
	}

	/** Resolve an entity's rendering surface via the `Widget` component. */
	private surfaceOf(entityId: EntityId): Surface | null {
		const w = this.engine.get(entityId, Widget);
		if (!w) return null;
		// Widget.surface is typed as a string in the ECS layer; narrow here.
		if (w.surface === 'dom' || w.surface === 'webgl' || w.surface === 'webview') {
			return w.surface;
		}
		return null;
	}
}
