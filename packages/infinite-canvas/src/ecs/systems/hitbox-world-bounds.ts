import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Hitbox, Parent, WorldBounds } from '../components.js';

/**
 * Derive WorldBounds for every entity with Hitbox + Parent from the parent's
 * WorldBounds + anchor offset. Runs after transformPropagateSystem so parent
 * WorldBounds are up to date. No-op until Phase 4 spawns entities with Hitbox.
 */
export const hitboxWorldBoundsSystem = defineSystem({
	name: 'hitboxWorldBounds',
	after: 'transformPropagate',
	execute: (world: World) => {
		for (const entity of world.query(Hitbox, Parent)) {
			const parentRef = world.getComponent(entity, Parent);
			if (!parentRef) continue;
			if (!world.entityExists(parentRef.id)) continue;

			const parentWB = world.getComponent(parentRef.id, WorldBounds);
			if (!parentWB) continue;

			const hb = world.getComponent(entity, Hitbox);
			if (!hb) continue;

			const cx = parentWB.worldX + parentWB.worldWidth * hb.anchorX;
			const cy = parentWB.worldY + parentWB.worldHeight * hb.anchorY;

			const next = {
				worldX: cx - hb.width / 2,
				worldY: cy - hb.height / 2,
				worldWidth: hb.width,
				worldHeight: hb.height,
			};

			if (world.hasComponent(entity, WorldBounds)) {
				world.setComponent(entity, WorldBounds, next);
			} else {
				world.addComponent(entity, WorldBounds, next);
			}
		}
	},
});
