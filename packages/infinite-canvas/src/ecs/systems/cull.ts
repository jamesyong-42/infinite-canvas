import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Active, Culled, Transform2D, Visible } from '../components.js';
import { intersectsAABB, rectToAABB } from '../math.js';
import { CameraResource, SpatialIndexResource, ViewportResource } from '../resources.js';

/**
 * Viewport culling — for every `Active` entity, sets exactly one of `Visible`
 * (intersects viewport+overscan) or `Culled` (outside it). Non-Active entities
 * carry neither tag.
 *
 * The `Culled` tag is consumed by render layers that want to keep cached state
 * without rendering — the R3F compositor (RFC-002) holds Culled widgets in its
 * Cold pool and skips ticks/paints for them.
 */
export const cullSystem = defineSystem({
	name: 'cull',
	phase: 'derive',
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

		// Clear previous frame's tags before recomputing.
		for (const entity of world.queryTagged(Visible)) world.removeTag(entity, Visible);
		for (const entity of world.queryTagged(Culled)) world.removeTag(entity, Culled);

		const visibleIds = new Set<EntityId>();

		if (spatialIndex && spatialIndex.size > 0) {
			const candidates = spatialIndex.search(vpWorldAABB);
			for (const entry of candidates) {
				if (world.hasTag(entry.entityId, Active)) {
					world.addTag(entry.entityId, Visible);
					visibleIds.add(entry.entityId);
				}
			}
		} else {
			for (const entity of world.queryTagged(Active)) {
				const t = world.getComponent(entity, Transform2D);
				if (t && intersectsAABB(rectToAABB(t), vpWorldAABB)) {
					world.addTag(entity, Visible);
					visibleIds.add(entity);
				}
			}
		}

		// Tag remaining Active entities as Culled to maintain the invariant.
		for (const entity of world.queryTagged(Active)) {
			if (!visibleIds.has(entity)) world.addTag(entity, Culled);
		}
	},
});
