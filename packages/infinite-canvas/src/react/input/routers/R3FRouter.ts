import type { EntityId } from '@jamesyong42/reactive-ecs';
import { inputLog } from '../debug.js';
import type { InputEvent, InputEventType, Surface, WidgetSurfaceRouter } from '../types.js';

/**
 * R3F event manager — the runtime shape we depend on. We avoid importing
 * `EventManager` from `@react-three/fiber` directly to keep this module
 * tree-shakeable for non-R3F consumers; the contract is the four pointer
 * dispatch methods. R3F's default factory (and `createR3FEventManager`)
 * exposes more (`onClick`, `onWheel`, etc.) but the InputManager only
 * routes raw pointer events — derived events stay R3F-internal.
 */
interface R3FHandlerMap {
	readonly onPointerDown?: (event: PointerEvent) => void;
	readonly onPointerMove?: (event: PointerEvent) => void;
	readonly onPointerUp?: (event: PointerEvent) => void;
	readonly onPointerCancel?: (event: PointerEvent) => void;
}

interface R3FEventManagerLike {
	readonly handlers?: R3FHandlerMap;
	/**
	 * Custom probe added by `createR3FEventManager` — returns `true` while
	 * a mesh inside an R3F widget holds DOM `setPointerCapture` for the
	 * given pointer ID. Used by the InputManager to skip recognizer
	 * observation for claimed pointers (so the engine drag doesn't fire
	 * alongside a widget orbit / pinch / etc.).
	 */
	readonly isPointerCaptured?: (pointerId: number) => boolean;
}

/**
 * Map raw `InputEventType`s to the R3F handler name that drives R3F's
 * mesh-dispatch machinery. Only the four raw pointer types are routed —
 * R3F synthesises clicks / hover-leave internally from the move stream
 * and has no router-driven need for them.
 */
const HANDLER_BY_TYPE: Partial<Record<InputEventType, keyof R3FHandlerMap>> = {
	down: 'onPointerDown',
	move: 'onPointerMove',
	up: 'onPointerUp',
	cancel: 'onPointerCancel',
};

/**
 * RFC-008 v5 — `WidgetSurfaceRouter` for the WebGL surface.
 *
 * Invoked by `InputManager.dispatch` whenever a raw pointer event falls
 * over an entity whose `Widget.surface === 'webgl'`. Looks up the matching
 * R3F mesh-dispatch handler and invokes it with the underlying native
 * event, letting R3F run its raycast → bubble → handler pipeline (with
 * `compute` + `filter` from `createR3FEventManager` targeting the right
 * per-widget scene).
 *
 * The InputManager dispatches the router BEFORE engine handlers, so widget
 * mesh handlers that call `setPointerCapture` (claiming exclusive ownership
 * of the gesture) take effect before the engine's drag/marquee logic could
 * react. Mesh handlers that call `e.stopPropagation()` halt R3F's bubble
 * but NOT the engine's handlers — those listen on the InputManager, not on
 * R3F's bubble. This is the coexistence model: R3F handles widget-internal
 * logic, engine handles canvas-level logic, both react to the same event
 * unless a widget explicitly claims it (RFC-008 § Default coexistence).
 */
export class R3FRouter implements WidgetSurfaceRouter {
	readonly surface: Surface = 'webgl';

	/**
	 * @param getEventManager Returns the R3F event manager whose `handlers`
	 *   we invoke. Wrapped in a getter because R3F creates the manager
	 *   inside the React component tree, so the router (typically constructed
	 *   alongside the InputManager) needs late-bound access.
	 */
	constructor(private readonly getEventManager: () => R3FEventManagerLike | null | undefined) {}

	route(event: InputEvent, entityId: EntityId): void {
		if (!event.native) return;
		const handlerName = HANDLER_BY_TYPE[event.type];
		if (!handlerName) return;

		const manager = this.getEventManager();
		const handler = manager?.handlers?.[handlerName];
		if (!handler) {
			inputLog('Router', `R3FRouter: no R3F manager / handler for ${handlerName}`, {
				type: event.type,
				entityId,
			});
			return;
		}

		inputLog('Router', `R3FRouter → R3F.${handlerName} for entity ${entityId}`, {
			type: event.type,
			entityId,
			handlerName,
		});
		handler(event.native as PointerEvent);
	}

	isPointerClaimed(pointerId: number): boolean {
		const claimed = this.getEventManager()?.isPointerCaptured?.(pointerId) ?? false;
		if (claimed) {
			inputLog('Router', `R3FRouter: pointer ${pointerId} CLAIMED via setPointerCapture`, {
				pointerId,
			});
		}
		return claimed;
	}
}
