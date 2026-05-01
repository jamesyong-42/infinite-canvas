import { events as createPointerEvents } from '@react-three/fiber';
import type { Intersection, Object3D, Scene } from 'three';
import { Transform2D, Widget } from '../../../ecs/components.js';
import type { LayoutEngine } from '../../../ecs/engine/index.js';
import type { WidgetRegistry } from '../../../r3f/compositor/WidgetRegistry.js';
import { inputLog } from '../debug.js';

/**
 * RFC-008 v6 — R3F event-manager factory tailored for the InputManager
 * pipeline. R3F's bubble + hover diff + click synthesis still run, but
 * R3F is now driven *entirely* by the InputManager: PointerAdapter feeds
 * pointer events, ClickAdapter feeds click / dblclick / contextmenu, and
 * `R3FRouter` invokes `manager.handlers.onPointerDown(nativeEvent)` /
 * `onClick(...)` / etc. from the InputManager dispatch loop.
 *
 * `connect` / `disconnect` are no-ops. v5 used to register a parallel
 * listener set on the canvas container for click / dblclick / contextmenu
 * (because those events lived outside the InputManager pipeline). v6
 * unifies them — no parallel native listeners, one dispatcher entry
 * point. This eliminates the "click on a captured mesh doesn't select
 * the widget" coexistence bug (RFC-008 v5 smell 5.1).
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
			inputLog('R3F', `compute: ready raycaster for entity ${entityId}`, {
				type: event.type,
				entityId,
				ndc: { x: ndcX, y: ndcY },
				sceneChildren: widget.scene.children.length,
			});
		};

		const filter = (items: Intersection[]): Intersection[] => {
			const scene = activeScene;
			if (!scene) return [];
			return items.filter((hit) => isDescendantOf(hit.object, scene));
		};

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
			// v6: no native listeners. R3F is driven entirely by the
			// InputManager pipeline (PointerAdapter + ClickAdapter +
			// WheelAdapter → R3FRouter → manager.handlers.*). connect /
			// disconnect kept as required by R3F's EventManager contract,
			// but they're empty.
			connect: (_target: HTMLElement) => {
				inputLog('R3F', 'createR3FEventManager.connect: no-op (driven by InputManager)');
			},
			disconnect: () => {
				inputLog('R3F', 'createR3FEventManager.disconnect: no-op');
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
