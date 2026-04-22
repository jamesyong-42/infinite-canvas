import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Active, Visible, WorldBounds } from '../components.js';
import { intersectsAABB, worldBoundsToAABB } from '../math.js';
import { CameraResource, SpatialIndexResource, ViewportResource } from '../resources.js';

/**
 * Viewport culling — mark Active entities that intersect the viewport as Visible.
 */
export const cullSystem = defineSystem({
	name: 'cull',
	after: 'navigationFilter',
	execute: (world: World) => {
		const camera = world.getResource(CameraResource);
		const viewport = world.getResource(ViewportResource);
		if (viewport.width === 0 || viewport.height === 0) return;

		const res = world.getResource(SpatialIndexResource);
		const spatialIndex = res.instance;

		const overscan = 200 / camera.zoom;
		const vpWorldAABB = {
			minX: camera.x - overscan,
			minY: camera.y - overscan,
			maxX: camera.x + viewport.width / camera.zoom + overscan,
			maxY: camera.y + viewport.height / camera.zoom + overscan,
		};

		for (const entity of world.queryTagged(Visible)) {
			world.removeTag(entity, Visible);
		}

		if (spatialIndex && spatialIndex.size > 0) {
			const candidates = spatialIndex.search(vpWorldAABB);
			for (const entry of candidates) {
				if (world.hasTag(entry.entityId, Active)) {
					world.addTag(entry.entityId, Visible);
				}
			}
		} else {
			for (const entity of world.queryTagged(Active)) {
				const wb = world.getComponent(entity, WorldBounds);
				if (wb && intersectsAABB(worldBoundsToAABB(wb), vpWorldAABB)) {
					world.addTag(entity, Visible);
				}
			}
		}
	},
});
