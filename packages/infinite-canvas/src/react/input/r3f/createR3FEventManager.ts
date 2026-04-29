import { events as createPointerEvents } from '@react-three/fiber';
import type { Intersection, Object3D, Scene } from 'three';
import { Transform2D, Widget } from '../../../ecs/components.js';
import type { LayoutEngine } from '../../../ecs/engine/index.js';
import type { WidgetRegistry } from '../../../r3f/compositor/WidgetRegistry.js';

/**
 * RFC-008 v5 — R3F event-manager factory tailored for the InputManager
 * pipeline. R3F's bubble + hover diff + click synthesis still run; pointer
 * events are driven externally by `R3FRouter` (which calls
 * `manager.handlers.onPointerDown(nativeEvent)` etc. from the InputManager
 * dispatch loop), but click / dblclick / contextmenu are NOT pointer
 * events — R3F's `handlePointer('onClick')` is invoked by the browser's
 * native `click` event, which has no equivalent in our pointer adapter.
 * The override below registers listeners ONLY for those three events
 * (skipping the pointer-event ones that PointerAdapter owns, and `wheel`
 * which WheelAdapter owns) so mesh `onClick` / `onDoubleClick` /
 * `onContextMenu` handlers continue to fire for R3F widgets.
 *
 * The `compute` and `filter` overrides are inherited from the v3 EventRouter:
 *
 *   - `compute` resolves the widget under the pointer via `engine.pickAt`,
 *     then sets up R3F's raycaster against that widget's local scene + ortho
 *     camera in widget-local NDC. Identical math to RFC-006's EventRouter.
 *
 *   - `filter` discards intersections that landed on meshes outside the
 *     active widget's scene tree (per-widget scenes all live at the origin
 *     in world space — without the filter, widget A's pointer ray would hit
 *     widget B's meshes wherever they overlap in widget-local space).
 *
 * The single closure variable `activeScene` is written by `compute` per
 * event and read by `filter` for the same event. Single-threaded JS makes
 * this safe.
 */
/**
 * R3F handler names mapped to the DOM event names whose native listeners
 * `connect` should register. Pointer events (`onPointer*`) are owned by
 * `PointerAdapter`; `onWheel` is owned by `WheelAdapter`. The remaining
 * three events are derived from the browser's native click chain and have
 * no pointer-adapter equivalent — let R3F handle them itself.
 */
const R3F_DOM_EVENTS: Array<[handlerName: string, eventName: string]> = [
	['onClick', 'click'],
	['onDoubleClick', 'dblclick'],
	['onContextMenu', 'contextmenu'],
];
/**
 * Optional `onCreate` callback fires once R3F's `<Canvas>` invokes the
 * factory and the manager object is constructed — this is the only way
 * to surface the live `EventManager` to outside code (e.g. the
 * `R3FRouter` which needs to call `manager.handlers.onPointerDown(...)`).
 */
type R3FManagerLike = ReturnType<typeof createPointerEvents>;

export function createR3FEventManager(
	engine: LayoutEngine,
	registry: WidgetRegistry,
	onCreate?: (manager: R3FManagerLike) => void,
) {
	let activeScene: Scene | null = null;

	function skipEvent(state: {
		raycaster: { camera: unknown };
		pointer: { set: (x: number, y: number) => void };
	}): void {
		activeScene = null;
		state.raycaster.camera = null;
		state.pointer.set(0, 0);
	}

	return (store: Parameters<typeof createPointerEvents>[0]) => {
		const base = createPointerEvents(store);

		const compute: NonNullable<ReturnType<typeof createPointerEvents>['compute']> = (
			event,
			state,
		) => {
			const target = state.gl.domElement;
			const rect = target.getBoundingClientRect();
			const screenX = event.clientX - rect.left;
			const screenY = event.clientY - rect.top;

			const entityId = engine.pickAt(screenX, screenY);
			if (entityId === null) {
				skipEvent(state);
				return;
			}

			const w = engine.get(entityId, Widget);
			if (w?.surface !== 'webgl') {
				skipEvent(state);
				return;
			}

			const widget = registry.get(entityId);
			const t = engine.get(entityId, Transform2D);
			if (!widget || !t) {
				skipEvent(state);
				return;
			}

			const cam = engine.getCamera();
			const worldX = screenX / cam.zoom + cam.x;
			const worldY = screenY / cam.zoom + cam.y;
			const widgetCenterX = t.x + t.width / 2;
			const widgetCenterY = t.y + t.height / 2;
			const localX = worldX - widgetCenterX;
			const localY = -(worldY - widgetCenterY);
			const ndcX = (2 * localX) / t.width;
			const ndcY = (2 * localY) / t.height;

			activeScene = widget.scene;
			state.pointer.set(ndcX, ndcY);
			state.raycaster.setFromCamera(state.pointer, widget.camera);
			state.raycaster.camera = widget.camera;
		};

		const filter = (items: Intersection[]): Intersection[] => {
			const scene = activeScene;
			if (!scene) return [];
			return items.filter((hit) => isDescendantOf(hit.object, scene));
		};

		// State held across connect/disconnect so we can remove exactly
		// the listeners we attached (R3F may invoke disconnect → connect
		// when the canvas's eventSource changes).
		let attached: { target: HTMLElement; bindings: Array<[string, EventListener]> } | null = null;

		// R3F populates `internal.capturedMap` synchronously when a mesh
		// handler calls `e.target.setPointerCapture(pointerId)`. Exposing
		// this lets `R3FRouter.isPointerClaimed` tell the InputManager to
		// skip recognizers for claimed pointers — without it, DOM
		// setPointerCapture alone doesn't shield ancestor listeners
		// (PointerAdapter on the canvas container) from seeing the
		// captured events.
		const isPointerCaptured = (pointerId: number): boolean => {
			// R3F's store types don't surface `internal` cleanly; the
			// path is `store.getState().internal.capturedMap`.
			// biome-ignore lint/suspicious/noExplicitAny: R3F internal field.
			const state = store.getState() as any;
			return state.internal?.capturedMap?.has?.(pointerId) ?? false;
		};

		const manager = {
			...base,
			compute,
			filter,
			isPointerCaptured,
			connect: (target: HTMLElement) => {
				if (attached) return; // idempotent — R3F may double-call.
				const bindings: Array<[string, EventListener]> = [];
				const handlers = manager.handlers;
				if (handlers) {
					const handlerMap = handlers as unknown as Record<string, EventListener | undefined>;
					for (const [handlerName, eventName] of R3F_DOM_EVENTS) {
						const handler = handlerMap[handlerName];
						if (!handler) continue;
						target.addEventListener(eventName, handler);
						bindings.push([eventName, handler]);
					}
				}
				attached = { target, bindings };
			},
			disconnect: () => {
				if (!attached) return;
				for (const [eventName, handler] of attached.bindings) {
					attached.target.removeEventListener(eventName, handler);
				}
				attached = null;
			},
		};
		onCreate?.(manager);
		return manager;
	};
}

function isDescendantOf(obj: Object3D, ancestor: Object3D): boolean {
	let n: Object3D | null = obj;
	while (n) {
		if (n === ancestor) return true;
		n = n.parent;
	}
	return false;
}
