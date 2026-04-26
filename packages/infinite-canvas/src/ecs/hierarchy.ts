import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import { ParentFrame } from './components.js';

/**
 * Walks the `ParentFrame` chain from `descendant` upward and returns
 * true iff `candidate` appears on that chain (inclusive check excluded:
 * an entity is not considered its own ancestor).
 *
 * Used by `CardContainer`'s default `canAccept` as a cycle-guard so
 * dragging a container onto one of its own descendants is rejected
 * before any mutation fires (RFC-004 § Phase 5). Cheap — the chain is
 * typically 0–3 deep. Capped at a sane depth to defend against
 * pathological / malformed worlds.
 */
export function isFrameAncestorOf(
	world: World,
	candidate: EntityId,
	descendant: EntityId,
): boolean {
	if (candidate === descendant) return false;
	let current: EntityId = descendant;
	for (let i = 0; i < 64; i++) {
		const pf: { id: EntityId } | undefined = world.getComponent(current, ParentFrame);
		if (!pf) return false;
		if (pf.id === candidate) return true;
		current = pf.id;
	}
	return false;
}
