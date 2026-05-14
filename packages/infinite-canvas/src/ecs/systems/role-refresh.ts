import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import {
	CursorHint,
	Draggable,
	InteractionRole,
	type InteractionRoleType,
	Selectable,
} from '../components.js';

/**
 * Reconcile `InteractionRole` and `CursorHint` for a single entity against
 * its current `Draggable` / `Selectable` tag state. Bails if the entity has
 * a custom role (rotate, connect, etc.) — only the default drag/select/
 * canvas roles are auto-managed.
 */
function refreshInteractionRole(world: World, entity: EntityId): void {
	const current = world.getComponent(entity, InteractionRole);
	if (
		current &&
		current.role.type !== 'drag' &&
		current.role.type !== 'select' &&
		current.role.type !== 'canvas'
	) {
		return;
	}

	const hasDraggable = world.hasTag(entity, Draggable);
	const hasSelectable = world.hasTag(entity, Selectable);
	const desiredRole: InteractionRoleType | null = hasDraggable
		? { type: 'drag' }
		: hasSelectable
			? { type: 'select' }
			: null;

	if (desiredRole === null) {
		if (current) world.removeComponent(entity, InteractionRole);
		if (world.hasComponent(entity, CursorHint)) world.removeComponent(entity, CursorHint);
		return;
	}

	if (!current) {
		world.addComponent(entity, InteractionRole, { layer: 5, role: desiredRole });
	} else if (current.role.type !== desiredRole.type) {
		world.setComponent(entity, InteractionRole, { role: desiredRole });
	}

	if (desiredRole.type === 'drag' && !world.hasComponent(entity, CursorHint)) {
		world.addComponent(entity, CursorHint, { hover: 'grab', active: 'grabbing' });
	}
}

/**
 * Auto-attach `InteractionRole` and `CursorHint` based on `Draggable` /
 * `Selectable` tag presence. Entities with an explicit non-drag/non-select
 * role (rotate/connect/etc.) are left alone.
 *
 * Diff signal: `reactive-ecs` has no `queryAddedTag` / `queryRemovedTag`
 * primitive, so this system recomputes idempotently each tick over the
 * union {Draggable ∪ Selectable ∪ InteractionRole}. The refresh helper
 * skips entities whose role is already correct, so steady-state writes are
 * zero.
 *
 * RFC-010 Phase 3 — migrates the four tag observers at
 * `LayoutEngine.ts:175–213` (Draggable/Selectable add/remove) into a
 * `react`-phase system.
 */
export const roleRefreshSystem = defineSystem({
	name: 'roleRefresh',
	phase: 'react',
	execute: (world: World) => {
		const candidates = new Set<EntityId>();
		for (const e of world.queryTagged(Draggable)) candidates.add(e);
		for (const e of world.queryTagged(Selectable)) candidates.add(e);
		for (const e of world.query(InteractionRole)) candidates.add(e);
		for (const entity of candidates) refreshInteractionRole(world, entity);
	},
});
