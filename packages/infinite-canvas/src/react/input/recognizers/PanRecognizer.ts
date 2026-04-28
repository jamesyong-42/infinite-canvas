import { DEAD_ZONE_TOUCH_PX } from '../constants.js';
import { exceedsThreshold, makeSynthetic } from '../synthetic.js';
import type { InputEvent, InputManager, Point, Recognizer } from '../types.js';

interface TrackingState {
	downAt: Point;
	last: Point;
	status: 'tracking' | 'panning';
}

/**
 * Pan recognizer (RFC-008). Single-finger touch on empty space only —
 * `engine.pickAt(world) === null` at down-time. Emits `pan-update` with
 * screen deltas. The engine pan handler translates them into camera
 * `panBy` calls.
 *
 * Pinch + pan run simultaneously when two fingers are down on empty
 * space (matches iOS Maps): PinchRecognizer cancels this recognizer's
 * tracking via synthetic `cancel`, then a fresh PanRecognizer state
 * doesn't restart until both fingers release and a new single-finger
 * touch begins on empty space.
 *
 * Mouse / pen drags on empty space are NOT pans here — they're marquee
 * selection, handled by the engine drag handler responding to
 * DragRecognizer's `drag-start` for empty-space hits.
 */
export class PanRecognizer implements Recognizer {
	private readonly tracking = new Map<number, TrackingState>();

	observe(event: InputEvent, manager: InputManager): void {
		switch (event.type) {
			case 'down': {
				if (event.source !== 'touch') return;
				if (event.button !== 0 && event.button !== null) return;
				const hit = manager.pickAt(event.screen);
				if (hit !== null) return; // entity hit — drag/select, not pan
				this.tracking.set(event.pointerId, {
					downAt: event.screen,
					last: event.screen,
					status: 'tracking',
				});
				return;
			}
			case 'move': {
				const t = this.tracking.get(event.pointerId);
				if (!t) return;
				if (t.status === 'tracking') {
					if (!exceedsThreshold(event.screen, t.downAt, DEAD_ZONE_TOUCH_PX)) return;
					t.status = 'panning';
					t.last = event.screen;
					return;
				}
				const delta = { x: event.screen.x - t.last.x, y: event.screen.y - t.last.y };
				t.last = event.screen;
				manager.dispatch(makeSynthetic('pan-update', event, { kind: 'pan', delta }));
				return;
			}
			case 'up':
			case 'cancel': {
				this.tracking.delete(event.pointerId);
				return;
			}
		}
	}

	reset(): void {
		this.tracking.clear();
	}
}
