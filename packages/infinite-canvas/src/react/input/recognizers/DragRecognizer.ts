import { DEAD_ZONE_MOUSE_PX, DEAD_ZONE_TOUCH_PX } from '../constants.js';
import { inputLog } from '../debug.js';
import { exceedsThreshold, makeSynthetic } from '../synthetic.js';
import type { InputEvent, InputManager, Point, Recognizer } from '../types.js';

interface TrackingState {
	downAt: { screen: Point; world: Point };
	last: { screen: Point; world: Point };
	status: 'tracking' | 'dragging';
}

/**
 * Drag recognizer (RFC-008). Per-pointerId state on `down`. On `move`
 * past the source-appropriate dead zone, emits a synthetic `drag-start`
 * and transitions to `dragging`. Subsequent moves emit `drag-update`s
 * with screen + world deltas. `up` or `cancel` after dragging emits
 * `drag-end`.
 *
 * Single-finger only: PinchRecognizer dispatches a synthetic `cancel`
 * when a 2nd touch lands, which DragRecognizer observes and uses to
 * abort tracking for the first finger.
 *
 * Note: synthetic `drag-update` events carry the SCREEN delta in
 * `gesture.delta` (not world delta) — the engine handler needs world
 * coords to update entity positions, but it gets those from the raw
 * `move` event's `world`. The gesture's `delta` is informational, not
 * used by the engine drag handler.
 */
export class DragRecognizer implements Recognizer {
	private readonly tracking = new Map<number, TrackingState>();

	observe(event: InputEvent, manager: InputManager): void {
		switch (event.type) {
			case 'down': {
				if (event.button !== 0 && event.button !== null) return;
				// Single-finger only (RFC-008 § Recognizers table). A 2nd
				// concurrent `down` while a prior pointer is still tracked
				// would otherwise produce parallel drag states and the
				// engine's `beginDrag` doesn't model concurrent drags.
				// PinchRecognizer's synthetic `cancel` will retire the
				// first pointer cleanly before its `pinch-start` fires.
				if (this.tracking.size > 0) return;
				this.tracking.set(event.pointerId, {
					downAt: { screen: event.screen, world: event.world },
					last: { screen: event.screen, world: event.world },
					status: 'tracking',
				});
				return;
			}
			case 'move': {
				const t = this.tracking.get(event.pointerId);
				if (!t) return;
				if (t.status === 'tracking') {
					const dz = event.source === 'touch' ? DEAD_ZONE_TOUCH_PX : DEAD_ZONE_MOUSE_PX;
					if (!exceedsThreshold(event.screen, t.downAt.screen, dz)) return;
					t.status = 'dragging';
					inputLog('Recognizer', `DragRecognizer: dead-zone crossed → drag-start`, {
						pointerId: event.pointerId,
						source: event.source,
						deadZone: dz,
					});
					manager.dispatch(
						makeSynthetic('drag-start', event, {
							kind: 'drag',
							phase: 'start',
							total: {
								x: event.screen.x - t.downAt.screen.x,
								y: event.screen.y - t.downAt.screen.y,
							},
							delta: { x: event.screen.x - t.last.screen.x, y: event.screen.y - t.last.screen.y },
						}),
					);
					t.last = { screen: event.screen, world: event.world };
					return;
				}
				// status === 'dragging'
				manager.dispatch(
					makeSynthetic('drag-update', event, {
						kind: 'drag',
						phase: 'update',
						total: { x: event.screen.x - t.downAt.screen.x, y: event.screen.y - t.downAt.screen.y },
						delta: { x: event.screen.x - t.last.screen.x, y: event.screen.y - t.last.screen.y },
					}),
				);
				t.last = { screen: event.screen, world: event.world };
				return;
			}
			case 'up': {
				const t = this.tracking.get(event.pointerId);
				if (!t) return;
				this.tracking.delete(event.pointerId);
				if (t.status !== 'dragging') return;
				inputLog('Recognizer', `DragRecognizer: up after dragging → drag-end`, {
					pointerId: event.pointerId,
				});
				manager.dispatch(
					makeSynthetic('drag-end', event, {
						kind: 'drag',
						phase: 'end',
						total: { x: event.screen.x - t.downAt.screen.x, y: event.screen.y - t.downAt.screen.y },
						delta: { x: event.screen.x - t.last.screen.x, y: event.screen.y - t.last.screen.y },
					}),
				);
				return;
			}
			case 'cancel': {
				// Only clear tracking state. The native `cancel` propagates
				// to engine handlers BEFORE recognizers observe (per
				// InputManager.dispatch ordering), so the engine `cancel`
				// handler has already rolled back the drag with
				// `cancelled: true`. Re-emitting a synthetic `drag-end`
				// here would be carry the wrong intent (`drag-end` →
				// `cancelled: false` → commit) and is only harmless today
				// because state is already idle by the time it dispatches.
				// Keep the recognizer contract clean: `cancel` is `cancel`,
				// not `drag-end`.
				this.tracking.delete(event.pointerId);
				return;
			}
		}
	}

	reset(): void {
		this.tracking.clear();
	}
}
