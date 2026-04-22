import type { EntityId } from '@jamesyong42/reactive-ecs';
import { useEffect } from 'react';
import { useLayoutEngine } from '../../react/context/engine-context.js';
import { useComponent } from '../../react/hooks/ecs.js';
import { R3FAnimationSignal, type R3FPhase, R3FRenderState } from './state.js';

/**
 * Marks the current R3F widget as actively animating. While `active` is true,
 * the state machine places the widget in `Hot`; when false, it returns to
 * `Warm` on the next frame.
 *
 * Widgets should call this whenever they want per-frame ticking (e.g. during
 * a spring settle, hover lerp, or an external animation). Without this
 * signal, `useFrame` bodies may still fire when the canvas re-renders for
 * other reasons — check `useWidgetPhase() === 'Hot'` to early-exit work
 * that's only meaningful during the animation.
 */
export function useWidgetAnimation(entityId: EntityId, active: boolean): void {
	const engine = useLayoutEngine();
	useEffect(() => {
		if (active) {
			engine.world.addTag(entityId, R3FAnimationSignal);
			return () => {
				engine.world.removeTag(entityId, R3FAnimationSignal);
			};
		}
		// Ensure clean-up if the active → inactive transition happens mid-effect.
		engine.world.removeTag(entityId, R3FAnimationSignal);
		return undefined;
	}, [engine, entityId, active]);
}

/**
 * Returns the current compositor phase for the widget. Re-renders when the
 * phase changes.
 */
export function useWidgetPhase(entityId: EntityId): R3FPhase | null {
	const state = useComponent(entityId, R3FRenderState);
	return state?.phase ?? null;
}
