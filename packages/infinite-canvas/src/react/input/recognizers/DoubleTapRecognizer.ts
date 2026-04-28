import { DOUBLE_TAP_DIST_PX, DOUBLE_TAP_WINDOW_MS } from '../constants.js';
import { exceedsThreshold, makeSynthetic } from '../synthetic.js';
import type { InputEvent, InputManager, Point, Recognizer } from '../types.js';

/**
 * Double-tap recognizer (RFC-008). Observes the `tap` events emitted by
 * `TapRecognizer`. When two consecutive taps land within
 * `DOUBLE_TAP_WINDOW_MS` and `DOUBLE_TAP_DIST_PX`, emits a synthetic
 * `'double-tap'`.
 *
 * The first tap continues to fire normally — handlers that listen to
 * `'tap'` (e.g., engine selection) react to it. The second tap fires
 * both a `'tap'` AND a `'double-tap'`. Engine handlers can decide which
 * to respond to based on what they care about.
 */
export class DoubleTapRecognizer implements Recognizer {
	private last: { at: Point; time: number } | null = null;

	observe(event: InputEvent, manager: InputManager): void {
		if (event.type !== 'tap' || event.gesture?.kind !== 'tap' || event.gesture.count !== 1) {
			return;
		}
		const now = event.timestamp;
		const here = event.screen;
		if (
			this.last !== null &&
			now - this.last.time <= DOUBLE_TAP_WINDOW_MS &&
			!exceedsThreshold(here, this.last.at, DOUBLE_TAP_DIST_PX)
		) {
			manager.dispatch(makeSynthetic('double-tap', event, { kind: 'tap', count: 2 }));
			this.last = null;
			return;
		}
		this.last = { at: here, time: now };
	}

	reset(): void {
		this.last = null;
	}
}
