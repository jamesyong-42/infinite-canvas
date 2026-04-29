import type { LayoutEngine } from '../../ecs/engine/index.js';
import {
	WHEEL_ZOOM_FACTOR,
	ZOOM_HIGH_THRESHOLD,
	ZOOM_LOW_THRESHOLD,
	ZOOM_TARGETS,
} from './constants.js';
import type { GestureDetail, InputManager, Point } from './types.js';

/**
 * RFC-008 § Engine handler registration. Wires the engine's input
 * primitives (`beginDrag`, `selectEntity`, camera ops, hover state, etc.)
 * to the synthetic events emitted by recognizers and the raw events
 * emitted by adapters. Returns a teardown that removes every handler.
 *
 * The `container` is the canvas-container DOM element. Pointer-capture
 * for drags is anchored on it so the gesture survives the cursor leaving
 * the container's bounds.
 */
export function installEngineHandlers(
	manager: InputManager,
	engine: LayoutEngine,
	container: HTMLElement,
): () => void {
	// PinchRecognizer emits `center` per update but no center delta — the
	// engine handler accumulates so pinch + two-finger pan act as a
	// compound gesture (matches iOS Maps and the legacy TouchEventBus).
	let lastPinchCenter: Point | null = null;

	const offs: Array<() => void> = [];

	// --- Camera --------------------------------------------------------

	offs.push(
		manager.on('wheel', (e) => {
			const w = e.wheelDelta;
			if (!w) return;
			if (w.pinch) {
				engine.zoomAtPoint(e.screen.x, e.screen.y, -w.dy * WHEEL_ZOOM_FACTOR);
			} else {
				engine.panBy(-w.dx, -w.dy);
			}
			manager.notifyGesturing();
		}),
	);

	offs.push(
		manager.on('pinch-start', (e) => {
			const g = e.gesture as Extract<GestureDetail, { kind: 'pinch' }>;
			lastPinchCenter = { x: g.center.x, y: g.center.y };
			manager.notifyGesturing();
		}),
	);

	offs.push(
		manager.on('pinch-update', (e) => {
			const g = e.gesture as Extract<GestureDetail, { kind: 'pinch' }>;
			engine.zoomAtPoint(g.center.x, g.center.y, g.scale - 1);
			if (lastPinchCenter) {
				engine.panBy(g.center.x - lastPinchCenter.x, g.center.y - lastPinchCenter.y);
			}
			lastPinchCenter = { x: g.center.x, y: g.center.y };
			manager.notifyGesturing();
		}),
	);

	offs.push(
		manager.on('pinch-end', () => {
			lastPinchCenter = null;
		}),
	);

	offs.push(
		manager.on('pan-update', (e) => {
			const g = e.gesture as Extract<GestureDetail, { kind: 'pan' }>;
			engine.panBy(g.delta.x, g.delta.y);
			manager.notifyGesturing();
		}),
	);

	// --- Tap / double-tap ----------------------------------------------

	offs.push(
		manager.on('tap', (e) => {
			const g = e.gesture as Extract<GestureDetail, { kind: 'tap' }>;
			if (g.count !== 1) return;
			const entity = engine.pickAt(e.screen.x, e.screen.y);
			if (entity !== null) engine.selectEntity(entity, e.modifiers.shift);
			else engine.clearSelection();
		}),
	);

	offs.push(
		manager.on('double-tap', (e) => {
			const entity = engine.pickAt(e.screen.x, e.screen.y);
			if (entity !== null) {
				engine.enterContainer(entity);
				return;
			}
			// Empty-space double-tap → zoom toggle (matches the v1 TouchEventBus).
			const camera = engine.getCamera();
			const target =
				camera.zoom < ZOOM_LOW_THRESHOLD
					? ZOOM_TARGETS[0]
					: camera.zoom < ZOOM_HIGH_THRESHOLD
						? ZOOM_TARGETS[1]
						: ZOOM_TARGETS[0];
			engine.zoomAtPoint(e.screen.x, e.screen.y, (target - camera.zoom) / camera.zoom);
		}),
	);

	// --- Drag / marquee ------------------------------------------------

	offs.push(
		manager.on('drag-start', (e) => {
			const hit = engine.hitTest(e.screen.x, e.screen.y);
			// Pointer capture anchors the gesture to the container — drag,
			// resize, marquee, and touch-pan all need pointermove to keep
			// arriving even if the cursor / finger leaves the container.
			container.setPointerCapture(e.pointerId);

			if (!hit) {
				// Empty-space drag-start splits by source: mouse / pen drag a
				// marquee; touch defers to PanRecognizer's pan-update stream
				// (iOS Maps semantics — single-finger empty pan, no marquee).
				if (e.source === 'touch') return;
				engine.clearSelection();
				engine.beginMarquee(e.world.x, e.world.y);
				return;
			}

			// RFC-005: resize hotspots win over body drags. The `hitTest`
			// returns the widget directly with the handle position carried
			// on the role.
			if (hit.role.role.type === 'resize') {
				engine.beginResize(hit.entityId, hit.role.role.handle, e.world.x, e.world.y);
				return;
			}

			// Body drag (or any future role that uses drag mechanics).
			// Auto-select the entity under the cursor if it isn't already
			// in the selection set so the drag carries the picked entity.
			// `additive` follows the shift modifier — shift-drag of a new
			// entity adds it to the existing multi-select, no-shift-drag
			// replaces. Multi-select drags (entity already selected) keep
			// the full selection set intact.
			const selected = engine.getSelectedEntities();
			if (!selected.includes(hit.entityId)) {
				engine.selectEntity(hit.entityId, e.modifiers.shift);
			}
			engine.beginDrag(hit.entityId, e.world.x, e.world.y);
		}),
	);

	offs.push(
		manager.on('drag-update', (e) => {
			if (engine.isMarqueeActive()) {
				engine.updateMarquee(e.world.x, e.world.y);
				return;
			}
			const resizing = engine.getResizingEntity();
			if (resizing !== null) {
				engine.updateResize(resizing, e.world.x, e.world.y);
				return;
			}
			const dragging = engine.getDraggingEntity();
			if (dragging !== null) {
				engine.updateDrag(dragging, e.world.x, e.world.y);
			}
		}),
	);

	offs.push(
		manager.on('drag-end', (e) => {
			if (engine.isMarqueeActive()) {
				engine.endMarquee();
			} else {
				const resizing = engine.getResizingEntity();
				if (resizing !== null) {
					engine.endResize(resizing, { cancelled: false });
				} else {
					const dragging = engine.getDraggingEntity();
					if (dragging !== null) engine.endDrag(dragging, { cancelled: false });
				}
			}
			if (container.hasPointerCapture(e.pointerId)) {
				container.releasePointerCapture(e.pointerId);
			}
		}),
	);

	offs.push(
		manager.on('cancel', (e) => {
			// `cancelInteraction` covers every mid-gesture mode (dragging,
			// resizing, marquee, tracking, flyingBack). `endDrag(.., true)`
			// only handles `dragging`, and `getDraggingEntity()` returns
			// null in `flyingBack` — so a native `pointercancel` during the
			// 250 ms fly-back animation would otherwise leave `Dragging`
			// tags + elevated `ZIndex` permanently stuck on the entity.
			engine.cancelInteraction();
			if (container.hasPointerCapture(e.pointerId)) {
				container.releasePointerCapture(e.pointerId);
			}
		}),
	);

	// --- Hover chrome --------------------------------------------------
	//
	// `updateHover` runs the engine's full hit-test so the cursor can
	// switch between RFC-005 resize hotspots within a single widget —
	// HoverRecognizer's `hover-enter` / `hover-leave` events only fire on
	// entity transitions, which is too coarse for handle cursor changes.
	// Internally gated on `idle` mode so drag / resize / marquee freeze
	// hover (matches the v1 `handlePointerMove` idle-branch behaviour).

	offs.push(
		manager.on('move', (e) => {
			engine.updateHover(e.screen.x, e.screen.y);
		}),
	);

	return () => {
		for (const off of offs) off();
		lastPinchCenter = null;
	};
}
