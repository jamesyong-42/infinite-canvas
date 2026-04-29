import { screenToWorld } from '../../../ecs/math.js';
import { inputLog } from '../debug.js';
import type { Adapter, InputEvent, InputManager } from '../types.js';

/**
 * Wheel adapter (RFC-008). Listens for native wheel events on the canvas
 * container, normalises into `InputEvent`s with a `wheelDelta` payload,
 * and dispatches via `manager.dispatch(...)`.
 *
 * Always calls `preventDefault()` — we always own canvas pan/zoom from
 * wheel input. Widgets that want internal scroll content call
 * `e.stopPropagation()` on `wheel` from inside their React tree, which
 * halts the bubble before it reaches this listener.
 *
 * `wheelDelta.pinch` is true when ctrl or meta is held — browsers
 * translate trackpad pinch into ctrl+wheel events; the engine wheel
 * handler interprets pinch as zoom and plain wheel as pan.
 */
export class WheelAdapter implements Adapter {
	attach(container: HTMLElement, manager: InputManager): () => void {
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = container.getBoundingClientRect();
			const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			const camera = manager.engine.getCamera();
			const world = screenToWorld(screen.x, screen.y, camera);

			const event: InputEvent = {
				type: 'wheel',
				source: 'wheel',
				pointerId: 0,
				primary: true,
				screen,
				world,
				wheelDelta: {
					dx: e.deltaX,
					dy: e.deltaY,
					pinch: e.ctrlKey || e.metaKey,
				},
				modifiers: {
					shift: e.shiftKey,
					ctrl: e.ctrlKey,
					alt: e.altKey,
					meta: e.metaKey,
				},
				timestamp: e.timeStamp,
				native: e,
			};
			inputLog('Adapter', `wheel → InputManager`, {
				type: 'wheel',
				screen,
				dx: e.deltaX,
				dy: e.deltaY,
				pinch: e.ctrlKey || e.metaKey,
			});
			manager.dispatch(event);
		};

		container.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			container.removeEventListener('wheel', onWheel);
		};
	}
}
