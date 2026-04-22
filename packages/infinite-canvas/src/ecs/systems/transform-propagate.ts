import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Children, Parent, Transform2D, WorldBounds } from '../components.js';

/**
 * Propagate transforms down the parent-child hierarchy.
 * Computes WorldBounds for every entity with Transform2D.
 * Uses change detection — only processes dirty entities and their descendants.
 */
export const transformPropagateSystem = defineSystem({
	name: 'transformPropagate',
	execute: (world: World) => {
		const changed = world.queryChanged(Transform2D);
		const processed = new Set<number>();

		for (const entity of changed) {
			propagateEntity(world, entity, processed);
		}

		for (const entity of world.queryAdded(Transform2D)) {
			if (!processed.has(entity)) {
				propagateEntity(world, entity, processed);
			}
		}
	},
});

function propagateEntity(world: World, entity: number, processed: Set<number>) {
	if (processed.has(entity)) return;
	processed.add(entity);

	const transform = world.getComponent(entity, Transform2D);
	if (!transform) return;

	let worldX = transform.x;
	let worldY = transform.y;

	const parentComp = world.getComponent(entity, Parent);
	if (parentComp && world.entityExists(parentComp.id)) {
		// Fix #7: Recursively propagate parent first if it hasn't been processed,
		// so we never read stale parent WorldBounds.
		if (!processed.has(parentComp.id)) {
			propagateEntity(world, parentComp.id, processed);
		}
		const parentBounds = world.getComponent(parentComp.id, WorldBounds);
		if (parentBounds) {
			worldX += parentBounds.worldX;
			worldY += parentBounds.worldY;
		}
	}

	if (!world.hasComponent(entity, WorldBounds)) {
		world.addComponent(entity, WorldBounds, {
			worldX,
			worldY,
			worldWidth: transform.width,
			worldHeight: transform.height,
		});
	} else {
		world.setComponent(entity, WorldBounds, {
			worldX,
			worldY,
			worldWidth: transform.width,
			worldHeight: transform.height,
		});
	}

	const children = world.getComponent(entity, Children);
	if (children) {
		for (const childId of children.ids) {
			propagateEntity(world, childId, processed);
		}
	}
}
