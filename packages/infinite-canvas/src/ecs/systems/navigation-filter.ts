import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Active, ParentFrame, Transform2D } from '../components.js';
import { NavigationStackResource } from '../resources.js';

/**
 * Reconcile `Active` for a single entity against the given nav frame.
 * Exported so the engine can wire a reactive `ParentFrame` observer
 * that keeps the consume / re-parent / undo paths in sync without
 * waiting for a nav-stack change (RFC-004 § Phase 5).
 */
export function reconcileEntityActive(world: World, entity: number): void {
	const navStack = world.getResource(NavigationStackResource);
	const activeContainer = navStack.frames[navStack.frames.length - 1].containerId;
	const pf = world.getComponent(entity, ParentFrame);
	const belongs = activeContainer === null ? pf === undefined : pf?.id === activeContainer;
	const isActive = world.hasTag(entity, Active);
	if (belongs && !isActive) world.addTag(entity, Active);
	else if (!belongs && isActive) world.removeTag(entity, Active);
}

/**
 * Filter entities to the active navigation layer.
 * Runs on nav-stack changes (full refilter) and incrementally whenever new
 * Transform2D entities are added (so runtime spawns land in the active layer).
 *
 * Mid-session `ParentFrame` mutations (consume / undo) are handled out of
 * band by a reactive observer in the engine — see
 * {@link reconcileEntityActive}.
 */
export const navigationFilterSystem = defineSystem({
	name: 'navigationFilter',
	execute: (world: World) => {
		const navStack = world.getResource(NavigationStackResource);
		const stackChanged = navStack.changed;
		const newEntities = world.queryAdded(Transform2D);
		if (!stackChanged && newEntities.length === 0) return;

		const currentFrame = navStack.frames[navStack.frames.length - 1];
		const activeContainer = currentFrame.containerId;

		const belongsToCurrentFrame = (entity: number): boolean => {
			if (activeContainer === null) return !world.hasComponent(entity, ParentFrame);
			return world.getComponent(entity, ParentFrame)?.id === activeContainer;
		};

		if (stackChanged) {
			for (const entity of world.queryTagged(Active)) {
				world.removeTag(entity, Active);
			}
			for (const entity of world.query(Transform2D)) {
				if (belongsToCurrentFrame(entity)) world.addTag(entity, Active);
			}
			// Direct mutation is intentional: `navStack.changed` is a side-
			// channel flag. `engine.tick()` captures its value into a local
			// `const` BEFORE `scheduler.execute()` runs (see the INVARIANT
			// comment there) — this reset clears the flag for the NEXT tick
			// without affecting this tick's `FrameChanges.navigationChanged`
			// signal. Do not switch to `setResource` here; it would trigger
			// unnecessary change bookkeeping on a hot path.
			navStack.changed = false;
		} else {
			for (const entity of newEntities) {
				if (belongsToCurrentFrame(entity) && !world.hasTag(entity, Active)) {
					world.addTag(entity, Active);
				}
			}
		}
	},
});
