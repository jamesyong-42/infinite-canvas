import { DEAD_ZONE_MOUSE_PX, DEAD_ZONE_TOUCH_PX, TAP_WINDOW_MS } from '../constants.js';
import { exceedsThreshold, makeSynthetic } from '../synthetic.js';
import type { InputEvent, InputManager, Point, Recognizer } from '../types.js';

/**
 * Tap recognizer (RFC-008). Per-pointerId state on `down`; emits a
 * synthetic `'tap'` (count 1) on `up` within `TAP_WINDOW_MS` and the
 * source-appropriate dead zone.
 *
 * Pairwise relationships:
 *   - Cancels its pending tap on observed `drag-start` or `pinch-start`
 *     for the same pointerId.
 *   - Cancels its pending tap on observed `cancel`.
 */
export class TapRecognizer implements Recognizer {
	private readonly pending = new Map<number, { downAt: Point; time: number }>();

	observe(event: InputEvent, manager: InputManager): void {
		switch (event.type) {
			case 'down': {
				if (event.button !== 0 && event.button !== null) return;
				this.pending.set(event.pointerId, { downAt: event.screen, time: event.timestamp });
				return;
			}
			case 'up': {
				const p = this.pending.get(event.pointerId);
				if (!p) return;
				this.pending.delete(event.pointerId);
				const elapsed = event.timestamp - p.time;
				const dz = event.source === 'touch' ? DEAD_ZONE_TOUCH_PX : DEAD_ZONE_MOUSE_PX;
				if (elapsed <= TAP_WINDOW_MS && !exceedsThreshold(event.screen, p.downAt, dz)) {
					manager.dispatch(makeSynthetic('tap', event, { kind: 'tap', count: 1 }));
				}
				return;
			}
			case 'cancel':
			case 'drag-start':
			case 'pinch-start': {
				this.pending.delete(event.pointerId);
				return;
			}
		}
	}

	reset(): void {
		this.pending.clear();
	}
}
