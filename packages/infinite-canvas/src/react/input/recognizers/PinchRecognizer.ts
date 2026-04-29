import { screenToWorld } from '../../../ecs/math.js';
import { makeSynthetic } from '../synthetic.js';
import type { InputEvent, InputManager, Point, Recognizer } from '../types.js';

interface PinchState {
	pointerIds: [number, number];
	last: { dist: number; center: Point };
}

/**
 * Pinch recognizer (RFC-008). Counts simultaneous active touch-source
 * pointers; emits `pinch-start` when count reaches 2, `pinch-update` on
 * either finger move, `pinch-end` when count drops below 2.
 *
 * On `pinch-start`, dispatches a synthetic `cancel` for any tracked
 * single-finger gesture so DragRecognizer / TapRecognizer / PanRecognizer
 * can abort cleanly. This is the cancel-then-pinch ordering — engine
 * drag (if active) runs `endDrag(entity, { cancelled: true })` before
 * pinch math takes over.
 *
 * Coexists with PanRecognizer: empty-space pan (single finger that
 * already crossed dead zone before the 2nd finger arrives) gets
 * cancelled by the synthetic `cancel`. After `pinch-end`, the user must
 * lift and re-place to start a new gesture (matches iOS).
 */
export class PinchRecognizer implements Recognizer {
	/** Active touch-source pointers and their latest positions (screen). */
	private readonly active = new Map<number, Point>();
	private state: PinchState | null = null;

	observe(event: InputEvent, manager: InputManager): void {
		if (event.source !== 'touch') return;
		switch (event.type) {
			case 'down': {
				this.active.set(event.pointerId, event.screen);
				if (this.state === null && this.active.size === 2) {
					const ids = [...this.active.keys()] as [number, number];
					const camera = manager.engine.getCamera();
					// Cancel any single-finger gesture in progress on either pointer.
					// World coords are derived from the per-pointer screen position
					// so HoverRecognizer's `cancel` → `hover-leave` re-dispatch
					// carries a self-consistent (screen, world) pair.
					for (const id of ids) {
						const screen = this.active.get(id)!;
						manager.dispatch({
							type: 'cancel',
							source: 'synthetic',
							pointerId: id,
							primary: false,
							screen,
							world: screenToWorld(screen.x, screen.y, camera),
							modifiers: event.modifiers,
							timestamp: event.timestamp,
						});
					}
					const positions = [...this.active.values()];
					const dist = pointDistance(positions[0], positions[1]);
					const center = midpoint(positions[0], positions[1]);
					this.state = {
						pointerIds: ids,
						last: { dist, center },
					};
					manager.dispatch(
						makeSynthetic('pinch-start', event, {
							kind: 'pinch',
							phase: 'start',
							scale: 1,
							center,
						}),
					);
				}
				return;
			}
			case 'move': {
				if (this.state === null || !this.active.has(event.pointerId)) return;
				this.active.set(event.pointerId, event.screen);
				const a = this.active.get(this.state.pointerIds[0]);
				const b = this.active.get(this.state.pointerIds[1]);
				if (!a || !b) return;
				const dist = pointDistance(a, b);
				const center = midpoint(a, b);
				const scale = this.state.last.dist > 0 ? dist / this.state.last.dist : 1;
				this.state.last = { dist, center };
				manager.dispatch(
					makeSynthetic(
						'pinch-update',
						event,
						{ kind: 'pinch', phase: 'update', scale, center },
						{ screen: center },
					),
				);
				return;
			}
			case 'up':
			case 'cancel': {
				this.active.delete(event.pointerId);
				if (this.state !== null && this.active.size < 2) {
					manager.dispatch(
						makeSynthetic('pinch-end', event, {
							kind: 'pinch',
							phase: 'end',
							scale: 1,
							center: this.state.last.center,
						}),
					);
					this.state = null;
				}
				return;
			}
		}
	}

	reset(): void {
		this.active.clear();
		this.state = null;
	}
}

function pointDistance(a: Point, b: Point): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
