import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { ParentFrame } from '../components.js';
import { reconcileEntityActive } from './navigation-filter.js';

/**
 * Keep `Active` in sync with mid-session `ParentFrame` mutations (RFC-004
 * § Phase 5). Covers the consume path (a child gets `ParentFrame` and
 * should leave the current frame) and re-parenting (the id changes).
 * Without this, a consumed card would retain `Active` at root until the
 * next nav-stack change and would render on top of its own container.
 *
 * Diff signal: `world.queryChanged(ParentFrame)` — entities whose
 * `ParentFrame` was added or set this tick (same set the previous
 * `onComponentChanged` observer fired for; reactive-ecs does not emit
 * change events on remove). `navigationFilterSystem` still handles the
 * full refilter when `navStack.changed`.
 *
 * RFC-010 Phase 3 — migrates the `ParentFrame` observer at
 * `LayoutEngine.ts:165–170` into a `react`-phase system.
 */
export const parentFrameActiveSystem = defineSystem({
	name: 'parentFrameActive',
	phase: 'react',
	execute: (world: World) => {
		for (const entity of world.queryChanged(ParentFrame)) {
			reconcileEntityActive(world, entity);
		}
	},
});
