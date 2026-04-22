import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import type { CSSCursor, ResizeHandlePos } from '../components.js';
import {
	Active,
	CursorHint,
	HandleSet,
	Hitbox,
	InteractionRole,
	Parent,
	Resizable,
	Selected,
} from '../components.js';
import { HANDLE_HIT_SIZE_PX } from '../interaction-constants.js';

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
