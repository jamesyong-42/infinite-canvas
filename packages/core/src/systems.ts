import { defineSystem } from './ecs/index.js';
import type { World } from './ecs/index.js';
import {
	Transform2D,
	WorldBounds,
	Parent,
	Children,
	Widget,
	WidgetBreakpoint,
	Active,
	Visible,
	Container,
} from './components.js';
import {
	CameraResource,
	ViewportResource,
	BreakpointConfigResource,
	NavigationStackResource,
} from './resources.js';
import type { Breakpoint } from './resources.js';
import type { SpatialIndex } from './spatial.js';
import { intersectsAABB, screenToWorld } from './math.js';

/**
 * Propagate transforms down the parent-child hierarchy.
 * Computes WorldBounds for every entity with Transform2D.
 * Uses change detection — only processes dirty entities and their descendants.
 */
export const transformPropagateSystem = defineSystem({
	name: 'transformPropagate',
	execute: (world: World) => {
		// Process entities with Transform2D that changed, or whose parent changed
		const changed = world.queryChanged(Transform2D);
		const processed = new Set<number>();

		for (const entity of changed) {
			propagateEntity(world, entity, processed);
		}

		// Also propagate for newly added Transform2D
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

	// Compute world position (walk up parent chain)
	let worldX = transform.x;
	let worldY = transform.y;

	const parentComp = world.getComponent(entity, Parent);
	if (parentComp && world.entityExists(parentComp.id)) {
		const parentBounds = world.getComponent(parentComp.id, WorldBounds);
		if (parentBounds) {
			worldX += parentBounds.worldX;
			worldY += parentBounds.worldY;
		}
	}

	// Write WorldBounds
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

	// Propagate to children
	const children = world.getComponent(entity, Children);
	if (children) {
		for (const childId of children.ids) {
			propagateEntity(world, childId, processed);
		}
	}
}

/**
 * Update the spatial index for entities whose WorldBounds changed.
 */
export const spatialIndexSystem = defineSystem({
	name: 'spatialIndex',
	after: 'transformPropagate',
	execute: (world: World) => {
		const spatialIndex = (world as any).__spatialIndex as SpatialIndex | undefined;
		if (!spatialIndex) return;

		for (const entity of world.queryChanged(WorldBounds)) {
			const wb = world.getComponent(entity, WorldBounds);
			if (wb) {
				spatialIndex.upsert(entity, {
					minX: wb.worldX,
					minY: wb.worldY,
					maxX: wb.worldX + wb.worldWidth,
					maxY: wb.worldY + wb.worldHeight,
				});
			}
		}

		// Also handle newly added
		for (const entity of world.queryAdded(WorldBounds)) {
			const wb = world.getComponent(entity, WorldBounds);
			if (wb) {
				spatialIndex.upsert(entity, {
					minX: wb.worldX,
					minY: wb.worldY,
					maxX: wb.worldX + wb.worldWidth,
					maxY: wb.worldY + wb.worldHeight,
				});
			}
		}
	},
});

/**
 * Filter entities to the active navigation layer.
 * Only runs when navigation stack changes.
 */
export const navigationFilterSystem = defineSystem({
	name: 'navigationFilter',
	after: 'spatialIndex',
	execute: (world: World) => {
		const navStack = world.getResource(NavigationStackResource);
		if (!navStack.changed) return;

		const currentFrame = navStack.frames[navStack.frames.length - 1];

		// Clear all Active tags
		for (const entity of world.queryTagged(Active)) {
			world.removeTag(entity, Active);
		}

		if (currentFrame.containerId === null) {
			// Root level: activate entities with Transform2D but no Parent
			for (const entity of world.query(Transform2D)) {
				if (!world.hasComponent(entity, Parent)) {
					world.addTag(entity, Active);
				}
			}
		} else {
			// Inside a container: activate only its direct children
			const children = world.getComponent(currentFrame.containerId, Children);
			if (children) {
				for (const childId of children.ids) {
					world.addTag(childId, Active);
				}
			}
		}

		navStack.changed = false;
	},
});

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

		const spatialIndex = (world as any).__spatialIndex as SpatialIndex | undefined;

		// Viewport in world space (with overscan)
		const overscan = 200 / camera.zoom;
		const vpWorldAABB = {
			minX: camera.x - overscan,
			minY: camera.y - overscan,
			maxX: camera.x + viewport.width / camera.zoom + overscan,
			maxY: camera.y + viewport.height / camera.zoom + overscan,
		};

		// Clear all Visible tags
		for (const entity of world.queryTagged(Visible)) {
			world.removeTag(entity, Visible);
		}

		if (spatialIndex && spatialIndex.size > 0) {
			// Use spatial index for efficient culling
			const candidates = spatialIndex.search(vpWorldAABB);
			for (const entry of candidates) {
				if (world.hasTag(entry.entityId, Active)) {
					world.addTag(entry.entityId, Visible);
				}
			}
		} else {
			// Fallback: brute force for entities without spatial index
			for (const entity of world.queryTagged(Active)) {
				const wb = world.getComponent(entity, WorldBounds);
				if (wb) {
					const entityAABB = {
						minX: wb.worldX,
						minY: wb.worldY,
						maxX: wb.worldX + wb.worldWidth,
						maxY: wb.worldY + wb.worldHeight,
					};
					if (intersectsAABB(entityAABB, vpWorldAABB)) {
						world.addTag(entity, Visible);
					}
				}
			}
		}
	},
});

/**
 * Compute breakpoints for visible widgets based on screen size.
 */
export const breakpointSystem = defineSystem({
	name: 'breakpoint',
	after: 'cull',
	execute: (world: World) => {
		const camera = world.getResource(CameraResource);
		const config = world.getResource(BreakpointConfigResource);

		for (const entity of world.query(Widget, Visible)) {
			const transform = world.getComponent(entity, Transform2D);
			if (!transform) continue;

			const screenWidth = transform.width * camera.zoom;
			const screenHeight = transform.height * camera.zoom;

			let bp: Breakpoint;
			if (screenWidth < config.micro) bp = 'micro';
			else if (screenWidth < config.compact) bp = 'compact';
			else if (screenWidth < config.normal) bp = 'normal';
			else if (screenWidth < config.expanded) bp = 'expanded';
			else bp = 'detailed';

			const existing = world.getComponent(entity, WidgetBreakpoint);
			if (!existing) {
				world.addComponent(entity, WidgetBreakpoint, {
					current: bp,
					screenWidth,
					screenHeight,
				});
			} else if (existing.current !== bp) {
				world.setComponent(entity, WidgetBreakpoint, {
					current: bp,
					screenWidth,
					screenHeight,
				});
			}
		}
	},
});

/**
 * Sort visible entities by z-index.
 * Stores result in a resource for renderers to read.
 */
export const sortSystem = defineSystem({
	name: 'sort',
	after: 'breakpoint',
	execute: (world: World) => {
		// The sorted list is computed here and stored for renderers
		// Renderers access it via engine.getVisibleEntities()
		// Implementation is in the engine layer that wraps the world
	},
});
