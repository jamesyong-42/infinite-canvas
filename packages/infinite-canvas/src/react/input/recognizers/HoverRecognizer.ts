import type { EntityId } from '@jamesyong42/reactive-ecs';
import { makeSynthetic } from '../synthetic.js';
import type { InputEvent, InputManager, Recognizer } from '../types.js';

/**
 * Hover recognizer (RFC-008). Observes `move` events; tracks the last
 * leaf entity under each pointer via `manager.pickAt`. On change, emits
 * `hover-leave` (with the previous entity in `gesture.entityId`) and
 * `hover-enter` (with the new entity).
 *
 * Hover is informational — recognizers and handlers downstream cannot
 * "consume" it. Engine hover chrome (selection ring, cursor hint) is
 * driven entirely by these events.
 *
 * Pen + mouse hover normally; touch fires hover only while a finger is
 * pressed, so touch-source hover events fire as a side-effect of drag
 * tracking. Authors who want touch hover-on-hover should listen for
 * `move` events themselves.
 */
export class HoverRecognizer implements Recognizer {
	private readonly lastByPointer = new Map<number, EntityId | null>();

	observe(event: InputEvent, manager: InputManager): void {
		switch (event.type) {
			case 'move': {
				const current = manager.pickAt(event.screen);
				const prev = this.lastByPointer.get(event.pointerId) ?? null;
				if (current === prev) return;
				if (prev !== null) {
					manager.dispatch(makeSynthetic('hover-leave', event, { kind: 'hover', entityId: prev }));
				}
				this.lastByPointer.set(event.pointerId, current);
				if (current !== null) {
					manager.dispatch(
						makeSynthetic('hover-enter', event, { kind: 'hover', entityId: current }),
					);
				}
				return;
			}
			case 'up':
			case 'cancel': {
				const prev = this.lastByPointer.get(event.pointerId);
				this.lastByPointer.delete(event.pointerId);
				if (prev != null) {
					manager.dispatch(makeSynthetic('hover-leave', event, { kind: 'hover', entityId: prev }));
				}
				return;
			}
		}
	}

	reset(): void {
		this.lastByPointer.clear();
	}
}
