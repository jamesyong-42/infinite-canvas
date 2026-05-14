import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Container, ContainerCamera } from '../components.js';

/**
 * Auto-attach a default `ContainerCamera` on every entity that just received
 * `Container`, so each container has a usable per-frame camera from birth.
 * Serialization round-trips cleanly; `enterContainer` can read without
 * falling back.
 *
 * Diff signal: `world.queryAdded(Container)` — only entities that received
 * the component *this tick*, matching the original observer's
 * `prev === undefined` guard. Mutating an existing `Container.enterable`
 * does not re-stamp a fresh camera.
 *
 * RFC-010 Phase 3 — migrates the `Container` add observer at
 * `LayoutEngine.ts:147–155` into a `react`-phase system.
 */
export const containerCameraSystem = defineSystem({
	name: 'containerCamera',
	phase: 'react',
	execute: (world: World) => {
		for (const entity of world.queryAdded(Container)) {
			if (!world.hasComponent(entity, ContainerCamera)) {
				world.addComponent(entity, ContainerCamera, { x: 0, y: 0, zoom: 1 });
			}
		}
	},
});
