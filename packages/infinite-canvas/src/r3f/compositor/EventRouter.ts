import { events as createPointerEvents } from '@react-three/fiber';
import type { Intersection, Object3D, Scene } from 'three';
import { Transform2D, Widget } from '../../ecs/components.js';
import type { LayoutEngine } from '../../ecs/engine/index.js';
import type { WidgetRegistry } from './WidgetRegistry.js';

/**
 * R3F event-manager factory that routes pointer events to per-widget
 * scenes (RFC-006 Phase 3).
 *
 * Wraps `createPointerEvents` (the default web manager) so we keep all
 * of R3F's bookkeeping for free — bubbling, hover diff, click synthesis,
 * pointer capture, `event.stopPropagation()`, `onPointerMissed` fan-out
 * — and only override two hooks:
 *
 *   - `compute` resolves the widget under the pointer via the engine
 *     spatial index, then sets up the raycaster with that widget's
 *     local scene + ortho camera and widget-local NDC pointer coords.
 *   - `filter` discards raycast hits that landed on meshes outside the
 *     active widget's scene tree. Per-widget scenes all live at the
 *     origin in world space (each renders into its own FBO), so without
 *     this restriction widget A's pointer ray would hit widget B's
 *     meshes wherever they overlap in widget-local space.
 *
 * Cross-widget hover transitions (cursor moves from widget A's mesh to
 * widget B's mesh) are handled implicitly: when the active widget
 * changes, `filter` excludes A's previously-hovered objects from this
 * frame's hits, so R3F's standard "previously hovered, no longer hit"
 * cleanup fires `onPointerLeave` on A's mesh and `onPointerEnter` on
 * B's mesh on the same move.
 *
 * `onPointerMissed` fan-out is also free: R3F's default dispatch sends
 * the missed event to every Object3D in `internal.interaction` whose
 * handler set includes `onPointerMissed`. Since per-widget meshes are
 * registered globally, this naturally reaches every visible widget.
 *
 * **Engine opt-out contract**: R3F's `event.stopPropagation()` only
 * halts further R3F dispatch — it does not stop the native event from
 * bubbling to the canvas-container `PointerEventBus`, where the engine
 * sees it. To opt out of engine routing (drag/select/etc.) from inside
 * an R3F widget, authors call `event.nativeEvent.stopPropagation()` in
 * addition to (or instead of) the R3F stopPropagation. This matches the
 * standard DOM idiom for halting native bubbling — no new API required.
 */
export function createCompositorEventManager(engine: LayoutEngine, registry: WidgetRegistry) {
	// Closure state — written by `compute` on each event, read by
	// `filter` on the same event. Single-threaded JS event loop makes
	// this safe.
	let activeScene: Scene | null = null;

	/**
	 * Tells R3F's intersect step to skip event handling for this event.
	 * Per fiber's `events.ts`: "Skip event handling when noEvents is set,
	 * or when the raycaster's camera is null." The `Camera` field type
	 * doesn't admit null, but the runtime check is explicit. Clearing
	 * `state.pointer` to (0, 0) avoids leaving stale widget-local NDC
	 * coords that some other R3F code path might read mid-event.
	 */
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

			// DOM widgets route through the natural DOM event path on
			// their slot; nothing for the R3F router to dispatch.
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

			// Map screen px → world → widget-local → NDC.
			const cam = engine.getCamera();
			const worldX = screenX / cam.zoom + cam.x;
			const worldY = screenY / cam.zoom + cam.y;
			const widgetCenterX = t.x + t.width / 2;
			const widgetCenterY = t.y + t.height / 2;
			const localX = worldX - widgetCenterX;
			// World Y is screen-down; widget-local Y is Three-default up.
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

		return {
			...base,
			compute,
			filter,
		};
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
