import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Card, Dragging, Layer, PreDragLayer, Widget } from '../components.js';

/**
 * Promotes a dragged DOM card to the 'overlay' layer so it visually pops above
 * its siblings; reverses on drag end. R3F cards opt out — the compositor
 * handles their stacking via `uDraggedRect` clip + renderOrder bump
 * (RFC-002), and a bare DOM widget without `Card` is a debug-style surface
 * that shouldn't acquire card-shaped affordances.
 *
 * Diff signal: presence of `PreDragLayer` is the "currently promoted" flag.
 *   Dragging present, no PreDragLayer  → promote (stash old layer, set overlay)
 *   PreDragLayer present, no Dragging  → restore (write back stashed layer)
 *
 * RFC-010 — runs in the `react` phase so the promote/restore is settled
 * before `derive`-phase systems (`cull`, `breakpoint`, `sort`) and the
 * `present`-phase visibility / frame-changes assembly run.
 */
export const dragPromoteSystem = defineSystem({
	name: 'dragPromote',
	phase: 'react',
	execute: (world: World) => {
		for (const entity of world.queryTagged(Dragging)) {
			if (world.hasComponent(entity, PreDragLayer)) continue;
			if (!world.hasComponent(entity, Card)) continue;
			if (world.getComponent(entity, Widget)?.surface === 'webgl') continue;
			const prev = world.getComponent(entity, Layer)?.name ?? 'base';
			world.addComponent(entity, PreDragLayer, { name: prev });
			if (world.hasComponent(entity, Layer)) {
				world.setComponent(entity, Layer, { name: 'overlay' });
			} else {
				world.addComponent(entity, Layer, { name: 'overlay' });
			}
		}

		for (const entity of world.query(PreDragLayer)) {
			if (world.hasTag(entity, Dragging)) continue;
			const stash = world.getComponent(entity, PreDragLayer);
			if (!stash) continue;
			world.setComponent(entity, Layer, { name: stash.name });
			world.removeComponent(entity, PreDragLayer);
		}
	},
});
