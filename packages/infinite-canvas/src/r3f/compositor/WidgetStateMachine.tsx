import { useEffect } from 'react';
import { Active, Culled, Visible, Widget } from '../../ecs/components.js';
import type { LayoutEngine } from '../../ecs/engine/index.js';
import { R3FAnimationSignal, type R3FPhase, R3FRenderState } from './state.js';

/**
 * Updates `R3FRenderState` phases for every R3F (`surface === 'webgl'`)
 * widget after each engine tick.
 *
 * At this phase the state machine is bookkeeping only — it does not
 * allocate or paint render targets (that arrives in Phase 4). Consumers
 * such as widget `useFrame` callbacks read the phase to decide whether
 * to do work this frame.
 *
 * Transition rules match RFC-002 § State machine:
 *
 *   Active + Visible + R3FAnimationSignal → Hot
 *   Active + Visible (idle)               → Warm (or Waking if texture invalid — irrelevant pre-Phase-4)
 *   Active + Culled                       → Cold
 *   !Active                               → Dormant
 */
export function WidgetStateMachine({ engine }: { engine: LayoutEngine }) {
	useEffect(() => {
		const world = engine.world;

		function updatePhases() {
			for (const entity of world.query(Widget)) {
				const widget = world.getComponent(entity, Widget);
				if (!widget || widget.surface !== 'webgl') continue;

				const current = world.getComponent(entity, R3FRenderState);
				const animating = world.hasTag(entity, R3FAnimationSignal);
				// fboGeneration starts at -1 and is bumped to >= 0 by the
				// compositor after a successful paint. "Has valid FBO" is the
				// signal the state machine needs to distinguish Waking from
				// Warm.
				const hasFbo = (current?.fboGeneration ?? -1) >= 0;

				const nextPhase = computePhase(
					world.hasTag(entity, Active),
					world.hasTag(entity, Visible),
					world.hasTag(entity, Culled),
					animating,
					hasFbo,
				);

				if (!current) {
					world.addComponent(entity, R3FRenderState, {
						phase: nextPhase,
						paintedAt: { width: 0, height: 0, dpr: 1, zoom: 1 },
						animating,
						paintGeneration: 0,
						fboGeneration: -1,
					});
				} else if (current.phase !== nextPhase || current.animating !== animating) {
					world.setComponent(entity, R3FRenderState, {
						...current,
						phase: nextPhase,
						animating,
					});
				}
			}
		}

		// Run once on mount to populate phases for pre-existing widgets, then
		// re-run after each engine frame.
		updatePhases();
		return engine.onFrame(updatePhases);
	}, [engine]);

	return null;
}

/**
 * Pure function version of the state-machine transition rule. Exported so
 * tests can pin the truth table without mounting React.
 *
 * `hasFbo` distinguishes Warm (texture present, can be sampled) from Waking
 * (Visible but no valid texture yet — the compositor must paint before the
 * widget is composited). After eviction (Phase 6) a Cold widget can lose
 * its texture and re-enter as Waking.
 */
export function computePhase(
	active: boolean,
	visible: boolean,
	culled: boolean,
	animationSignal: boolean,
	hasFbo: boolean,
): R3FPhase {
	if (!active) return 'Dormant';
	if (visible) {
		if (animationSignal) return 'Hot';
		return hasFbo ? 'Warm' : 'Waking';
	}
	if (culled) return 'Cold';
	// No viewport tag yet (e.g. before first cull tick) — treat as Cold so
	// we don't spuriously paint before the engine knows where we are.
	return 'Cold';
}
