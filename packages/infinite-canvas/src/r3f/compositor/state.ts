import { defineComponent, defineResource, defineTag } from '@jamesyong42/reactive-ecs';

/**
 * Compositor state-machine phase for an R3F widget (RFC-002).
 *
 * - `Hot`     — Active + Visible + animating. Ticks + paints every invalidation.
 * - `Warm`    — Active + Visible + idle. Texture cached, no tick, no paint.
 * - `Waking`  — Active + Visible but no valid texture yet (just un-culled / un-dormant). One-shot paint then → `Warm`.
 * - `Cold`    — Active + Culled. Off-screen, texture eviction-eligible.
 * - `Dormant` — Not Active. Eviction-protected so re-activation is instant.
 */
export type R3FPhase = 'Hot' | 'Warm' | 'Cold' | 'Waking' | 'Dormant';

/** Pixel resolution + camera zoom at which a widget's texture was last painted. */
export type R3FPaintedAt = {
	width: number;
	height: number;
	dpr: number;
	zoom: number;
};

/** Per-widget state tracked by the compositor. */
export type R3FRenderStateData = {
	phase: R3FPhase;
	paintedAt: R3FPaintedAt;
	/** True while the widget has signalled an animation tick is in progress. */
	animating: boolean;
	/** Bumped by widget state changes / animations that invalidate the texture. */
	paintGeneration: number;
	/** Generation last successfully painted into the FBO. */
	fboGeneration: number;
};

const DEFAULT_PAINTED_AT: R3FPaintedAt = { width: 0, height: 0, dpr: 1, zoom: 1 };

export const R3FRenderState = defineComponent<R3FRenderStateData>('R3FRenderState', {
	phase: 'Cold',
	paintedAt: DEFAULT_PAINTED_AT,
	animating: false,
	paintGeneration: 0,
	fboGeneration: -1,
});

/**
 * Opt-in tag — a widget that wants per-frame ticking sets this. The state
 * machine treats `Visible + R3FAnimationSignal` as the trigger for `Hot`.
 * Removing the tag transitions back to `Warm` when the widget settles.
 */
export const R3FAnimationSignal = defineTag('R3FAnimationSignal');

/** Global compositor memory + stagger budget. */
export type R3FRenderBudgetData = {
	/** Max bytes the widget render-target pool may consume. */
	maxBytes: number;
	/** Current pool consumption (written by the pool once it lands in Phase 4). */
	currentBytes: number;
	/** Max widgets to repaint per composited frame. */
	maxRepaintsPerFrame: number;
};

export const R3FRenderBudget = defineResource<R3FRenderBudgetData>('R3FRenderBudget', {
	maxBytes: 256 * 1024 * 1024,
	currentBytes: 0,
	maxRepaintsPerFrame: 4,
});
