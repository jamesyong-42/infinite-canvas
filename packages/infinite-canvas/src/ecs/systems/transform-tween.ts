import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Transform2D, TransformTween, type TweenEasing } from '../components.js';

/**
 * Apply an easing curve to a linear progress value in `[0, 1]`.
 *
 * - `linear` — no curve (`p`).
 * - `ease-out` — cubic ease-out (`1 - (1-p)^3`), default for fly-back.
 * - `ease-in-out` — cubic ease-in-out; symmetric accelerate/decelerate.
 * - `spring` — not yet implemented; falls back to `ease-out` for now.
 *
 * Input is clamped to `[0, 1]`; callers are expected to pass the tween's
 * `elapsed / durationMs` before clamping themselves.
 */
export function applyEasing(p: number, easing: TweenEasing): number {
	const t = p < 0 ? 0 : p > 1 ? 1 : p;
	switch (easing) {
		case 'linear':
			return t;
		case 'ease-in-out':
			return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
		case 'ease-out':
		case 'spring':
			// spring stub — honest ease-out until we actually spec spring's
			// stiffness/damping defaults (RFC-004 § Phase 2 open question).
			return 1 - (1 - t) ** 3;
	}
}

/**
 * Advance every active `TransformTween`, write the interpolated
 * position back to the entity's `Transform2D`, and remove the tween
 * component on completion (RFC-004 § Phase 2).
 *
 * No scheduler ordering constraint — the spatial-index observer fires
 * reactively on every `Transform2D` change, so downstream consumers
 * see the animated values within the same tick regardless of system
 * order.
 */
export const transformTweenSystem = defineSystem({
	name: 'transformTween',
	execute: (world: World) => {
		const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
		for (const entity of world.query(TransformTween)) {
			const t = world.getComponent(entity, TransformTween);
			const x2d = world.getComponent(entity, Transform2D);
			if (!t) continue;
			if (!x2d) {
				// Nothing to animate into — tween is orphaned.
				world.removeComponent(entity, TransformTween);
				continue;
			}
			const elapsed = nowMs - t.startMs;
			// `durationMs === 0` snaps immediately on the first tick because
			// `elapsed >= 0` always holds. No NaN from the divide-below path
			// can slip through.
			if (elapsed >= t.durationMs) {
				// Snap to destination and remove the component. Merging via
				// partial setComponent preserves width / height / rotation.
				world.setComponent(entity, Transform2D, { x: t.toX, y: t.toY });
				world.removeComponent(entity, TransformTween);
				continue;
			}
			const p = applyEasing(elapsed / t.durationMs, t.easing);
			world.setComponent(entity, Transform2D, {
				x: t.fromX + (t.toX - t.fromX) * p,
				y: t.fromY + (t.toY - t.fromY) * p,
			});
		}
	},
});
