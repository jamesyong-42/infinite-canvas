import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { NavigationStackResource, TickFlagsResource } from '../resources.js';

/**
 * Snapshot `NavigationStackResource.changed` into
 * `TickFlagsResource.navigationChangedSnapshot` BEFORE
 * `navigationFilterSystem` (`control` phase) resets the flag mid-tick.
 *
 * RFC-004 § Phase 0c invariant — `navigationFilter` mutates
 * `navStack.changed = false` as its reset signal; reading the flag after
 * `control` would always see false and this-tick navigation pushes/pops
 * would silently miss their `FrameChanges.navigationChanged` notification.
 *
 * Lives in `input` (the earliest phase) so the snapshot is taken before
 * any other engine system runs. `frameChangesSystem` (`present` phase)
 * later reads the snapshot when assembling `FrameChanges`.
 *
 * RFC-010 Phase 4 — replaces the inline pre-`scheduler.execute` capture
 * at lines 815–816 of the previous `engine.tick()` body.
 */
export const navStackCaptureSystem = defineSystem({
	name: 'navStackCapture',
	phase: 'input',
	execute: (world: World) => {
		const navStack = world.getResource(NavigationStackResource);
		world.setResource(TickFlagsResource, {
			navigationChangedSnapshot: navStack?.changed ?? false,
		});
	},
});
