import type { EntityId } from '@jamesyong42/reactive-ecs';
import { inputLog } from '../debug.js';
import type { InputEvent, InputEventType, Surface, WidgetSurfaceRouter } from '../types.js';

/**
 * R3F event manager — the runtime shape we depend on. We avoid importing
 * `EventManager` from `@react-three/fiber` directly to keep this module
 * tree-shakeable for non-R3F consumers; the contract is the seven dispatch
 * methods we actually invoke. R3F's default factory (and
 * `createR3FEventManager`) exposes more (`onWheel`, etc.) but RFC-008 v6
 * routes pointer + click families only. Click family was previously
 * registered by R3F's own `connect` listener; v6 promotes them to first-
 * class InputEvents and routes them through the same path as pointer
 * events for consistent coexistence semantics.
 */
interface R3FHandlerMap {
	readonly onPointerDown?: (event: PointerEvent) => void;
	readonly onPointerMove?: (event: PointerEvent) => void;
	readonly onPointerUp?: (event: PointerEvent) => void;
	readonly onPointerCancel?: (event: PointerEvent) => void;
	readonly onClick?: (event: MouseEvent) => void;
	readonly onDoubleClick?: (event: MouseEvent) => void;
	readonly onContextMenu?: (event: MouseEvent) => void;
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
 * Map `InputEventType`s to the R3F handler name that drives R3F's
 * mesh-dispatch machinery. Pointer types feed R3F's hover-diff + capture
 * pipeline; click family feeds R3F's click synthesis (`onClick`,
 * `onDoubleClick`, `onContextMenu`). v6 routes clicks through this table
 * so the InputManager pipeline is the single source for both engine and
 * widget — no parallel `connect` listener registration on the container.
 */
const HANDLER_BY_TYPE: Partial<Record<InputEventType, keyof R3FHandlerMap>> = {
	down: 'onPointerDown',
	move: 'onPointerMove',
	up: 'onPointerUp',
	cancel: 'onPointerCancel',
	click: 'onClick',
	dblclick: 'onDoubleClick',
	contextmenu: 'onContextMenu',
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
		// R3F handlers all expect a DOM Event subtype (PointerEvent for
		// pointer types, MouseEvent for click family). The handler-name
		// → InputEventType mapping above is the runtime type guard; the
		// native event was constructed by the matching adapter so the
		// shape lines up. One cast covers both families.
		(handler as (event: Event) => void)(event.native);
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
