import type { EntityId } from '@jamesyong42/reactive-ecs';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BufferGeometry, Material, Texture } from 'three';
import { useLayoutEngine } from '../../react/context/engine-context.js';
import { useComponent } from '../../react/hooks/ecs.js';
import { useCompositor } from './CompositorContext.js';
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
		// The tag mutation auto-dirties the engine via the RFC-010 Phase 5
		// mutation proxy, so the state machine picks up the Hot/Cold
		// transition on the next rAF without an explicit invalidate.
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

/**
 * Returns a function that schedules a one-shot repaint of the widget. Use
 * when widget content changes outside of React's render cycle (e.g., a
 * subscription to an external store, an imperative WebSocket message).
 *
 * Internally bumps `paintGeneration` so the compositor's dirty check picks
 * the widget up on the next frame, and invalidates the canvas so that
 * frame is actually scheduled.
 */
export function useWidgetInvalidate(entityId: EntityId): () => void {
	const engine = useLayoutEngine();
	const invalidate = useThree((s) => s.invalidate);
	return useCallback(() => {
		const current = engine.world.getComponent(entityId, R3FRenderState);
		if (!current) {
			// State not tracked yet — just kick the canvas; the state machine
			// will create the component on its next pass.
			invalidate();
			return;
		}
		engine.world.setComponent(entityId, R3FRenderState, {
			...current,
			paintGeneration: current.paintGeneration + 1,
		});
		invalidate();
	}, [engine, entityId, invalidate]);
}

/**
 * Acquires a shared geometry from the Compositor's `ResourceRegistry`,
 * keyed by `cacheKey`. The factory runs only on first acquisition; later
 * callers with the same key get the same instance. Released automatically
 * on unmount; the registry disposes when the last holder releases.
 *
 * Use for geometries that are expensive to build and frequently identical
 * across widget instances — e.g. preset card backs.
 */
export function useSharedGeometry<T extends BufferGeometry>(cacheKey: string, factory: () => T): T {
	const { registry } = useCompositor();
	// Stash factory in a ref so re-renders with a fresh closure don't churn
	// the useMemo deps. The registry only invokes factory on first acquire
	// for `cacheKey`, so the latest closure is what runs when it matters.
	const factoryRef = useRef(factory);
	factoryRef.current = factory;
	const geometry = useMemo(
		() => registry.acquireGeometry(cacheKey, factoryRef.current),
		[registry, cacheKey],
	);
	useEffect(() => {
		return () => registry.releaseGeometry(cacheKey);
	}, [registry, cacheKey]);
	return geometry;
}

/** Same contract as {@link useSharedGeometry}, for materials. */
export function useSharedMaterial<T extends Material>(cacheKey: string, factory: () => T): T {
	const { registry } = useCompositor();
	const factoryRef = useRef(factory);
	factoryRef.current = factory;
	const material = useMemo(
		() => registry.acquireMaterial(cacheKey, factoryRef.current),
		[registry, cacheKey],
	);
	useEffect(() => {
		return () => registry.releaseMaterial(cacheKey);
	}, [registry, cacheKey]);
	return material;
}

/** Same contract as {@link useSharedGeometry}, for textures. */
export function useSharedTexture<T extends Texture>(cacheKey: string, factory: () => T): T {
	const { registry } = useCompositor();
	const factoryRef = useRef(factory);
	factoryRef.current = factory;
	const texture = useMemo(
		() => registry.acquireTexture(cacheKey, factoryRef.current),
		[registry, cacheKey],
	);
	useEffect(() => {
		return () => registry.releaseTexture(cacheKey);
	}, [registry, cacheKey]);
	return texture;
}
