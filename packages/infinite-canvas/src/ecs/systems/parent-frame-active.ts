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
 * `onComponentChanged` observer fired for).
 *
 * **Limitation: `ParentFrame` removal is not handled here.** Neither
 * `reactive-ecs`'s `onComponentChanged` observer (the previous
 * implementation) nor `queryChanged` emits on `removeComponent`, so the
 * "undo (ParentFrame removed, child returns to root)" case described in
 * the original RFC-004 § Phase 5 comment was never actually covered by
 * this code path. It is recovered by `navigationFilterSystem`'s full
 * refilter on the next `navStack.changed` event. If an `Active` invariant
 * needs to be live across removes, either add `world.queryRemoved` to
 * reactive-ecs or push `navStack.changed = true` from the remover.
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
