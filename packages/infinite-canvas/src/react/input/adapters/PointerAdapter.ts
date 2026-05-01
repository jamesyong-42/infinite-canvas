import { screenToWorld } from '../../../ecs/math.js';
import { inputLog } from '../debug.js';
import type { Adapter, Button, InputEvent, InputManager, InputSource } from '../types.js';
import { NATIVE_INTERACTIVE_SELECTOR } from './native-interactive.js';

/**
 * Native pointer-event adapter (RFC-008). Listens for pointerdown / move /
 * up / cancel / pointerleave on the canvas container, normalises into
 * `InputEvent`s, and dispatches via `manager.dispatch(...)`.
 *
 * Single-finger and multi-finger touch flow through this adapter via the
 * browser's touch-to-pointer synthesis (`touch-action: none` on the
 * container is what makes synthesis reliable). PinchRecognizer counts
 * simultaneous active touch-source pointer IDs from these events.
 *
 * `preventDefault` discipline:
 *   - Pointer events: never. Bubble must continue so widget React handlers
 *     fire and so widgets can call `setPointerCapture` to claim drags.
 *   - `contextmenu`: handled by `ClickAdapter`, not here.
 *
 * `pointerdown` on a native interactive target (button, input, etc.) is
 * suppressed at the adapter so a button click inside a DOM widget can't
 * spawn a marquee or drag. Move / up / cancel still flow so hover chrome
 * stays accurate.
 *
 * `pointerleave` is dispatched as its own InputEvent type so engine hover
 * chrome can clear when the cursor exits the canvas — without an inline
 * listener outside the InputManager pipeline (RFC-008 v6 unification).
 */
export class PointerAdapter implements Adapter {
	attach(container: HTMLElement, manager: InputManager): () => void {
		const lastByPointerId = new Map<number, { x: number; y: number }>();

		const make = (
			type: 'down' | 'move' | 'up' | 'cancel' | 'pointerleave',
			e: PointerEvent,
		): InputEvent => {
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
			const rect = container.getBoundingClientRect();
			const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			lastByPointerId.set(e.pointerId, screen);

			const target = e.target as HTMLElement | null;
			const targetTag = target ? `${target.tagName}${target.id ? `#${target.id}` : ''}` : 'null';
			if (target?.closest(NATIVE_INTERACTIVE_SELECTOR)) {
				inputLog('Adapter', `pointerdown → SKIPPED (native interactive)`, {
					pointerId: e.pointerId,
					target: targetTag,
					source: e.pointerType,
				});
				return;
			}

			inputLog('Adapter', `pointerdown id=${e.pointerId} → InputManager`, {
				pointerId: e.pointerId,
				screen,
				button: e.button,
				source: e.pointerType,
				target: targetTag,
			});

			const event = make('down', e);
			manager.dispatch({ ...event, delta: undefined });
		};

		const onMove = (e: PointerEvent) => {
			const event = make('move', e);
			lastByPointerId.set(e.pointerId, { x: event.screen.x, y: event.screen.y });
			inputLog('Adapter', `pointermove id=${e.pointerId} → InputManager`, {
				type: 'move',
				pointerId: e.pointerId,
				screen: event.screen,
			});
			manager.dispatch(event);
		};

		const onUp = (e: PointerEvent) => {
			inputLog('Adapter', `pointerup id=${e.pointerId} → InputManager`, {
				pointerId: e.pointerId,
				source: e.pointerType,
			});
			manager.dispatch(make('up', e));
			lastByPointerId.delete(e.pointerId);
		};

		const onCancel = (e: PointerEvent) => {
			inputLog('Adapter', `pointercancel id=${e.pointerId} → InputManager`, {
				pointerId: e.pointerId,
			});
			manager.dispatch(make('cancel', e));
			lastByPointerId.delete(e.pointerId);
		};

		const onLeave = (e: PointerEvent) => {
			inputLog('Adapter', `pointerleave id=${e.pointerId} → InputManager`, {
				pointerId: e.pointerId,
				source: e.pointerType,
			});
			manager.dispatch(make('pointerleave', e));
			lastByPointerId.delete(e.pointerId);
		};

		container.addEventListener('pointerdown', onDown);
		container.addEventListener('pointermove', onMove);
		container.addEventListener('pointerup', onUp);
		container.addEventListener('pointercancel', onCancel);
		container.addEventListener('pointerleave', onLeave);

		return () => {
			container.removeEventListener('pointerdown', onDown);
			container.removeEventListener('pointermove', onMove);
			container.removeEventListener('pointerup', onUp);
			container.removeEventListener('pointercancel', onCancel);
			container.removeEventListener('pointerleave', onLeave);
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
