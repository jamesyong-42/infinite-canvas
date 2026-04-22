import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';

/**
 * Sort visible entities by z-index (handled in engine.tick()).
 */
export const sortSystem = defineSystem({
	name: 'sort',
	after: 'breakpoint',
	execute: (_world: World) => {
		// Sorting is done in engine.tick() after systems run
	},
});
