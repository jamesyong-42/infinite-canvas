import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Active, Parent, Transform2D } from '../components.js';
import { NavigationStackResource } from '../resources.js';

/**
 * Filter entities to the active navigation layer.
 * Runs on nav-stack changes (full refilter) and incrementally whenever new
 * Transform2D entities are added (so runtime spawns land in the active layer).
 */
export const navigationFilterSystem = defineSystem({
	name: 'navigationFilter',
	after: 'transformPropagate',
	execute: (world: World) => {
		const navStack = world.getResource(NavigationStackResource);
		const stackChanged = navStack.changed;
		const newEntities = world.queryAdded(Transform2D);
		if (!stackChanged && newEntities.length === 0) return;

		const currentFrame = navStack.frames[navStack.frames.length - 1];
		const activeContainer = currentFrame.containerId;

		const belongsToCurrentFrame = (entity: number): boolean => {
			if (activeContainer === null) return !world.hasComponent(entity, Parent);
			return world.getComponent(entity, Parent)?.id === activeContainer;
		};

		if (stackChanged) {
			for (const entity of world.queryTagged(Active)) {
				world.removeTag(entity, Active);
			}
			for (const entity of world.query(Transform2D)) {
				if (belongsToCurrentFrame(entity)) world.addTag(entity, Active);
			}
			// Fix #9: Intentional direct mutation — navStack.changed is a side-channel
			// flag read by engine.tick() before systems run. Using setResource() here
			// would trigger unnecessary resource-change bookkeeping on a hot path.
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
