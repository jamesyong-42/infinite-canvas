import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Card, Transform2D } from '../components.js';
import { CardPresetsResource } from '../resources.js';

/**
 * Stamp Transform2D width/height from Card.preset.
 * Runs before transformPropagateSystem so WorldBounds reflect the preset
 * size in the same tick. Manual writes to Transform2D.width/height on a
 * card entity get overwritten — to change card size, update `Card.preset`.
 */
export const cardSystem = defineSystem({
	name: 'card',
	before: 'transformPropagate',
	execute: (world: World) => {
		const resource = world.getResource(CardPresetsResource);
		if (!resource) return;
		const { presets } = resource;

		for (const entity of world.query(Card, Transform2D)) {
			const card = world.getComponent(entity, Card);
			const transform = world.getComponent(entity, Transform2D);
			if (!card || !transform) continue;
			const size = presets[card.preset];
			if (!size) continue;
			if (transform.width !== size.width || transform.height !== size.height) {
				world.setComponent(entity, Transform2D, {
					width: size.width,
					height: size.height,
				});
			}
		}
	},
});
