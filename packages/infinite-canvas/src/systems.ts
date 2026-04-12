import {
	Active,
	Children,
	CursorHint,
	HandleSet,
	Hitbox,
	InteractionRole,
	Parent,
	Resizable,
	Selected,
	Transform2D,
	Visible,
	Widget,
	WidgetBreakpoint,
	WorldBounds,
} from './components.js';
import type { CSSCursor, ResizeHandlePos } from './components.js';
import { defineSystem } from './ecs/index.js';
import type { EntityId, World } from './ecs/index.js';
import { SpatialIndexResource } from './engine.js';
import { HANDLE_HIT_SIZE_PX } from './interaction-constants.js';
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

/**
 * Specification for the 8 resize handles spawned around a selected resizable.
 * anchorX/anchorY are in 0..1 parent-local coordinates.
 * Corners (layer 15) sit above edges (layer 10) so corners win overlapping hit tests.
 */
const HANDLE_SPECS: Array<{
	pos: ResizeHandlePos;
	ax: number;
	ay: number;
	layer: number;
	cursor: CSSCursor;
}> = [
	{ pos: 'nw', ax: 0, ay: 0, layer: 15, cursor: 'nw-resize' },
	{ pos: 'ne', ax: 1, ay: 0, layer: 15, cursor: 'ne-resize' },
	{ pos: 'sw', ax: 0, ay: 1, layer: 15, cursor: 'sw-resize' },
	{ pos: 'se', ax: 1, ay: 1, layer: 15, cursor: 'se-resize' },
	{ pos: 'n', ax: 0.5, ay: 0, layer: 10, cursor: 'n-resize' },
	{ pos: 's', ax: 0.5, ay: 1, layer: 10, cursor: 's-resize' },
	{ pos: 'w', ax: 0, ay: 0.5, layer: 10, cursor: 'w-resize' },
	{ pos: 'e', ax: 1, ay: 0.5, layer: 10, cursor: 'e-resize' },
];

function spawnResizeHandles(world: World, parentId: EntityId): void {
	const S = HANDLE_HIT_SIZE_PX;
	const parentActive = world.hasTag(parentId, Active);
	const ids: EntityId[] = [];

	for (const spec of HANDLE_SPECS) {
		const id = world.createEntity();
		world.addComponent(id, Parent, { id: parentId });
		world.addComponent(id, Hitbox, {
			anchorX: spec.ax,
			anchorY: spec.ay,
			width: S,
			height: S,
		});
		world.addComponent(id, InteractionRole, {
			layer: spec.layer,
			role: { type: 'resize', handle: spec.pos },
		});
		world.addComponent(id, CursorHint, { hover: spec.cursor, active: spec.cursor });
		if (parentActive) world.addTag(id, Active);
		ids.push(id);
	}

	world.addComponent(parentId, HandleSet, { ids });
}

function despawnHandles(world: World, parentId: EntityId): void {
	const set = world.getComponent(parentId, HandleSet);
	if (!set) return;
	for (const id of set.ids) {
		if (world.entityExists(id)) world.destroyEntity(id);
	}
	world.removeComponent(parentId, HandleSet);
}

/**
 * Spawn/despawn resize handle child entities based on selection state.
 * Handles appear only when exactly one Resizable entity is Selected.
 * Runs after transformPropagate (parent bounds fresh) and before hitboxWorldBounds
 * (so newly-spawned handles get their WorldBounds in the same tick).
 *
 * Phase 5: handles now drive interaction directly via the unified hit test —
 * InteractionRole + Hitbox on each handle entity replaces hitTestResizeHandle.
 */
export const handleSyncSystem = defineSystem({
	name: 'handleSync',
	after: 'transformPropagate',
	before: 'hitboxWorldBounds',
	execute: (world: World) => {
		// Who should have handles right now? Exactly one selected resizable.
		const selectedResizable: EntityId[] = [];
		for (const entity of world.queryTagged(Resizable)) {
			if (world.hasTag(entity, Selected)) selectedResizable.push(entity);
		}
		const shouldSpawn = selectedResizable.length === 1 ? selectedResizable[0] : null;

		// Despawn handles on anything that shouldn't have them.
		// Snapshot the query result before mutating.
		const owners = world.query(HandleSet).slice();
		for (const parentId of owners) {
			if (parentId !== shouldSpawn) despawnHandles(world, parentId);
		}

		// Spawn on the sole selected resizable if it doesn't already have them.
		if (shouldSpawn !== null && !world.hasComponent(shouldSpawn, HandleSet)) {
			spawnResizeHandles(world, shouldSpawn);
		}

		// Orphan sweep: handles whose parent has been destroyed out-of-band.
		// Fix #8: Only auto-destroy handle entities (resize/rotate), not other
		// Hitbox+Parent combos that may be user-created.
		for (const entity of world.query(Hitbox, Parent).slice()) {
			const parent = world.getComponent(entity, Parent);
			if (!parent || !world.entityExists(parent.id)) {
				const role = world.getComponent(entity, InteractionRole);
				if (role && (role.role.type === 'resize' || role.role.type === 'rotate')) {
					world.destroyEntity(entity);
				}
			}
		}
	},
});

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

		// Fix #9: Intentional direct mutation — navStack.changed is a side-channel
		// flag read by engine.tick() before systems run. Using setResource() here
		// would trigger unnecessary resource-change bookkeeping on a hot path.
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
				// Fix #10: Update if breakpoint tier changed OR screen dimensions changed significantly.
				// Compare rounded values to avoid floating-point instability at fractional zoom levels.
				const bpChanged = existing.current !== bp;
				const sizeChanged =
					Math.round(existing.screenWidth) !== Math.round(screenWidth) ||
					Math.round(existing.screenHeight) !== Math.round(screenHeight);

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
