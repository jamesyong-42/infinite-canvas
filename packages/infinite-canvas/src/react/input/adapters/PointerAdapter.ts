import { screenToWorld } from '../../../ecs/math.js';
import type { Adapter, Button, InputEvent, InputManager, InputSource } from '../types.js';

/**
 * Native pointer-event adapter (RFC-008). Listens for pointerdown / move /
 * up / cancel on the canvas container, normalises into `InputEvent`s, and
 * dispatches via `manager.dispatch(...)`.
 *
 * Single-finger and multi-finger touch flow through this adapter via the
 * browser's touch-to-pointer synthesis (`touch-action: none` on the
 * container is what makes synthesis reliable). PinchRecognizer (Phase 2)
 * counts simultaneous active touch-source pointer IDs from these events.
 *
 * `preventDefault` discipline:
 *   - Pointer events: never. Bubble must continue so widget React handlers
 *     fire and so widgets can call `setPointerCapture` to claim drags.
 *   - `contextmenu`: always. Canvas isn't a place for browser context menus.
 */
export class PointerAdapter implements Adapter {
	attach(container: HTMLElement, manager: InputManager): () => void {
		const lastByPointerId = new Map<number, { x: number; y: number }>();

		const make = (type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent): InputEvent => {
			const rect = container.getBoundingClientRect();
			const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			const camera = manager.engine.getCamera();
			const world = screenToWorld(screen.x, screen.y, camera);
			const last = lastByPointerId.get(e.pointerId);
			const delta = last ? { x: screen.x - last.x, y: screen.y - last.y } : undefined;

			const button: Button =
				type === 'down' || type === 'up' ? ((e.button as 0 | 1 | 2) ?? null) : null;

			return {
				type,
				source: pointerSource(e),
				pointerId: e.pointerId,
				primary: e.isPrimary,
				screen,
				world,
				delta,
				button,
				modifiers: {
					shift: e.shiftKey,
					ctrl: e.ctrlKey,
					alt: e.altKey,
					meta: e.metaKey,
				},
				timestamp: e.timeStamp,
				native: e,
			};
		};

		const onDown = (e: PointerEvent) => {
			// Dispatch BEFORE recording the pointer position so the down
			// event itself has no `delta` (per RFC-008 § InputEvent: delta
			// is defined for 'move' / 'drag-update' / 'pan-update' / 'wheel'
			// only). The next move's delta is correctly computed against
			// this position.
			const event = make('down', e);
			lastByPointerId.set(e.pointerId, { x: event.screen.x, y: event.screen.y });
			manager.dispatch(event);
		};

		const onMove = (e: PointerEvent) => {
			const event = make('move', e);
			// Store CONTAINER-relative coords (matching `screen` in `make`),
			// not raw clientX/Y — otherwise delta on the next move is offset
			// by the container's left/top whenever the canvas isn't at page
			// origin.
			lastByPointerId.set(e.pointerId, { x: event.screen.x, y: event.screen.y });
			manager.dispatch(event);
		};

		const onUp = (e: PointerEvent) => {
			manager.dispatch(make('up', e));
			lastByPointerId.delete(e.pointerId);
		};

		const onCancel = (e: PointerEvent) => {
			manager.dispatch(make('cancel', e));
			lastByPointerId.delete(e.pointerId);
		};

		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
		};

		container.addEventListener('pointerdown', onDown);
		container.addEventListener('pointermove', onMove);
		container.addEventListener('pointerup', onUp);
		container.addEventListener('pointercancel', onCancel);
		container.addEventListener('contextmenu', onContextMenu);

		return () => {
			container.removeEventListener('pointerdown', onDown);
			container.removeEventListener('pointermove', onMove);
			container.removeEventListener('pointerup', onUp);
			container.removeEventListener('pointercancel', onCancel);
			container.removeEventListener('contextmenu', onContextMenu);
			lastByPointerId.clear();
		};
	}
}

function pointerSource(e: PointerEvent): InputSource {
	switch (e.pointerType) {
		case 'mouse':
			return 'mouse';
		case 'pen':
			return 'pen';
		case 'touch':
			return 'touch';
		default:
			return 'mouse';
	}
}
