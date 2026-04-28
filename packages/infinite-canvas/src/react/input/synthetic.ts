import type { GestureDetail, InputEvent, InputEventType, Point } from './types.js';

/**
 * Helper for constructing recognizer-emitted synthetic events. The
 * recognizer copies pointerId / modifiers / coords from the base raw
 * event, sets `source: 'synthetic'`, and attaches a `gesture` payload.
 */
export function makeSynthetic(
	type: InputEventType,
	base: InputEvent,
	gesture: GestureDetail,
	overrides?: Partial<{ screen: Point; world: Point; delta: Point }>,
): InputEvent {
	return {
		type,
		source: 'synthetic',
		pointerId: base.pointerId,
		primary: base.primary,
		screen: overrides?.screen ?? base.screen,
		world: overrides?.world ?? base.world,
		delta: overrides?.delta,
		modifiers: base.modifiers,
		timestamp: base.timestamp,
		gesture,
	};
}

/** Squared distance — avoids a sqrt for threshold comparisons. */
export function distSq(a: Point, b: Point): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

/** Returns true if the linear distance between two points exceeds `threshold` px. */
export function exceedsThreshold(a: Point, b: Point, threshold: number): boolean {
	return distSq(a, b) > threshold * threshold;
}
