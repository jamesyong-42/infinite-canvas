import {
	Active,
	Children,
	Parent,
	Transform2D,
	Visible,
	Widget,
	WidgetBreakpoint,
	WorldBounds,
} from './components.js';
import { defineSystem } from './ecs/index.js';
import type { World } from './ecs/index.js';
import { SpatialIndexResource } from './engine.js';
import { intersectsAABB, worldBoundsToAABB } from './math.js';
import {
	BreakpointConfigResource,
	CameraResource,
	NavigationStackResource,
	ViewportResource,
} from './resources.js';
import type { Breakpoint } from './resources.js';

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

/**
 * Filter entities to the active navigation layer.
 * Only runs when navigation stack changes.
 */
export const navigationFilterSystem = defineSystem({
	name: 'navigationFilter',
	after: 'transformPropagate',
	execute: (world: World) => {
		const navStack = world.getResource(NavigationStackResource);
		if (!navStack.changed) return;

		const currentFrame = navStack.frames[navStack.frames.length - 1];

		for (const entity of world.queryTagged(Active)) {
			world.removeTag(entity, Active);
		}

		if (currentFrame.containerId === null) {
			for (const entity of world.query(Transform2D)) {
				if (!world.hasComponent(entity, Parent)) {
					world.addTag(entity, Active);
				}
			}
		} else {
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

/**
 * Compute breakpoints for visible widgets based on screen size.
 * Fix #10: Always update screenWidth/screenHeight even if breakpoint tier doesn't change.
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
			} else {
				// Fix #10: Update if breakpoint tier changed OR screen dimensions changed significantly
				const bpChanged = existing.current !== bp;
				const sizeChanged =
					Math.abs(existing.screenWidth - screenWidth) > 1 ||
					Math.abs(existing.screenHeight - screenHeight) > 1;

				if (bpChanged || sizeChanged) {
					world.setComponent(entity, WidgetBreakpoint, {
						current: bp,
						screenWidth,
						screenHeight,
					});
				}
			}
		}
	},
});

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
