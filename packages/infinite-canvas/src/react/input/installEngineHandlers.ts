import type { LayoutEngine } from '../../ecs/engine/index.js';
import {
	WHEEL_ZOOM_FACTOR,
	ZOOM_HIGH_THRESHOLD,
	ZOOM_LOW_THRESHOLD,
	ZOOM_TARGETS,
} from './constants.js';
import { inputLog } from './debug.js';
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
			if (entity !== null) {
				inputLog('Engine', `tap on entity ${entity} → selectEntity (shift=${e.modifiers.shift})`);
				engine.selectEntity(entity, e.modifiers.shift);
			} else {
				inputLog('Engine', `tap on empty space → clearSelection`);
				engine.clearSelection();
			}
		}),
	);

	offs.push(
		manager.on('double-tap', (e) => {
			const entity = engine.pickAt(e.screen.x, e.screen.y);
			if (entity !== null) {
				inputLog('Engine', `double-tap on entity ${entity} → enterContainer`);
				engine.enterContainer(entity);
				return;
			}
			const camera = engine.getCamera();
			const target =
				camera.zoom < ZOOM_LOW_THRESHOLD
					? ZOOM_TARGETS[0]
					: camera.zoom < ZOOM_HIGH_THRESHOLD
						? ZOOM_TARGETS[1]
						: ZOOM_TARGETS[0];
			inputLog('Engine', `double-tap on empty → zoomAtPoint target=${target}x`);
			engine.zoomAtPoint(e.screen.x, e.screen.y, (target - camera.zoom) / camera.zoom);
		}),
	);

	// --- Drag / marquee ------------------------------------------------

	offs.push(
		manager.on('drag-start', (e) => {
			const hit = engine.hitTest(e.screen.x, e.screen.y);
			container.setPointerCapture(e.pointerId);

			if (!hit) {
				if (e.source === 'touch') {
					inputLog('Engine', `drag-start on empty (touch) → defer to PanRecognizer`, {
						pointerId: e.pointerId,
					});
					return;
				}
				inputLog('Engine', `drag-start on empty (mouse/pen) → beginMarquee`, {
					pointerId: e.pointerId,
				});
				engine.clearSelection();
				engine.beginMarquee(e.world.x, e.world.y);
				return;
			}

			if (hit.role.role.type === 'resize') {
				inputLog('Engine', `drag-start on resize handle → beginResize ${hit.role.role.handle}`, {
					entityId: hit.entityId,
					handle: hit.role.role.handle,
				});
				engine.beginResize(hit.entityId, hit.role.role.handle, e.world.x, e.world.y);
				return;
			}

			const selected = engine.getSelectedEntities();
			if (!selected.includes(hit.entityId)) {
				engine.selectEntity(hit.entityId, e.modifiers.shift);
			}
			inputLog('Engine', `drag-start on entity → beginDrag ${hit.entityId}`, {
				entityId: hit.entityId,
				role: hit.role.role.type,
				shift: e.modifiers.shift,
			});
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
				inputLog('Engine', `drag-end → endMarquee`);
				engine.endMarquee();
			} else {
				const resizing = engine.getResizingEntity();
				if (resizing !== null) {
					inputLog('Engine', `drag-end → endResize ${resizing} (commit)`);
					engine.endResize(resizing, { cancelled: false });
				} else {
					const dragging = engine.getDraggingEntity();
					if (dragging !== null) {
						inputLog('Engine', `drag-end → endDrag ${dragging} (commit)`);
						engine.endDrag(dragging, { cancelled: false });
					}
				}
			}
			if (container.hasPointerCapture(e.pointerId)) {
				container.releasePointerCapture(e.pointerId);
			}
		}),
	);

	offs.push(
		manager.on('cancel', (e) => {
			inputLog('Engine', `cancel → cancelInteraction (covers all mid-gesture modes)`, {
				pointerId: e.pointerId,
			});
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
