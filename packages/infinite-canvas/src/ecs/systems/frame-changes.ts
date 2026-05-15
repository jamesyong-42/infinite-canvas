import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Layer, Transform2D, WidgetBreakpoint, ZIndex } from '../components.js';
import { FrameChangesResource, TickFlagsResource, VisibleEntitiesResource } from '../resources.js';

/**
 * Assemble the `FrameChanges` snapshot consumed by `<InfiniteCanvas>`'s
 * rAF tail (DOM transform writes, R3F invalidate, layer re-bucket, event
 * callbacks). Runs in `present` after `visibility` so the prev/current
 * sets are populated.
 *
 * Inputs:
 *   - `world.queryChanged(Transform2D | WidgetBreakpoint | ZIndex | Layer)`
 *     — entityId arrays for each tracked component change.
 *   - `VisibleEntitiesResource.{current, prev}` — set diffing for entered
 *     and exited.
 *   - `TickFlagsResource` — camera / selection / navigation flags set out
 *     of band by engine APIs and `navStackCaptureSystem`.
 *
 * Side effects:
 *   - Writes `FrameChangesResource.changes`.
 *   - Resets `TickFlagsResource.cameraChanged` and `selectionChanged` to
 *     `false` (the flags are per-tick; consuming them clears them so the
 *     next tick starts fresh). `navigationChangedSnapshot` is overwritten
 *     by `navStackCaptureSystem` next tick — no need to reset here.
 *
 * RFC-010 Phase 4 — replaces lines 859–883 of the inline tail of
 * `engine.tick()`.
 */
export const frameChangesSystem = defineSystem({
	name: 'frameChanges',
	phase: 'present',
	after: 'visibility',
	execute: (world: World) => {
		const visible = world.getResource(VisibleEntitiesResource);
		const flags = world.getResource(TickFlagsResource);

		const newSet = new Set<EntityId>();
		for (const v of visible.current) newSet.add(v.entityId);

		const entered: EntityId[] = [];
		const exited: EntityId[] = [];
		for (const id of newSet) {
			if (!visible.prev.has(id)) entered.push(id);
		}
		for (const id of visible.prev) {
			if (!newSet.has(id)) exited.push(id);
		}

		world.setResource(FrameChangesResource, {
			changes: {
				positionsChanged: world.queryChanged(Transform2D),
				breakpointsChanged: world.queryChanged(WidgetBreakpoint),
				zIndicesChanged: world.queryChanged(ZIndex),
				entered,
				exited,
				cameraChanged: flags.cameraChanged,
				navigationChanged: flags.navigationChangedSnapshot,
				selectionChanged: flags.selectionChanged,
				layersChanged: world.queryChanged(Layer).length > 0,
			},
		});

		// Reset the flags consumed this tick. `navigationChangedSnapshot`
		// is overwritten by `navStackCaptureSystem` next tick.
		world.setResource(TickFlagsResource, {
			cameraChanged: false,
			selectionChanged: false,
		});
	},
});
