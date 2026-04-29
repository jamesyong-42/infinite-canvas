import { events as createPointerEvents } from '@react-three/fiber';
import type { Intersection, Object3D, Scene } from 'three';
import { Transform2D, Widget } from '../../../ecs/components.js';
import type { LayoutEngine } from '../../../ecs/engine/index.js';
import type { WidgetRegistry } from '../../../r3f/compositor/WidgetRegistry.js';

/**
 * RFC-008 v5 — R3F event-manager factory whose `connect` / `disconnect`
 * are no-ops. The InputManager owns native pointer-event listeners on the
 * canvas container; this factory exists so R3F's bubble + hover diff +
 * click synthesis still run, driven externally by `R3FRouter` which calls
 * `manager.handlers.onPointerDown(nativeEvent)` etc. from the InputManager
 * dispatch loop instead of letting R3F register its own listeners.
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
 * **Why `connect`/`disconnect` are no-ops:** R3F's default factory attaches
 * native listeners on `eventSource` during `connect()`. With the
 * InputManager pipeline (Phase 3d), there's exactly one native-listener
 * owner per source — `PointerAdapter` — so R3F must NOT also attach. The
 * `handlers` map is populated by `createPointerEvents` at construction
 * (independent of `connect`), so external invocation works.
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
		};

		const filter = (items: Intersection[]): Intersection[] => {
			const scene = activeScene;
			if (!scene) return [];
			return items.filter((hit) => isDescendantOf(hit.object, scene));
		};

		const manager = {
			...base,
			compute,
			filter,
			// RFC-008 v5: InputManager owns native listeners. R3F's mesh
			// dispatch is driven by `R3FRouter` calling `manager.handlers.*`
			// directly, so the connect/disconnect lifecycle is a no-op.
			connect: () => {
				/* no-op */
			},
			disconnect: () => {
				/* no-op */
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
