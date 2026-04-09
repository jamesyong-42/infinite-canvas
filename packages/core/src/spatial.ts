import RBushImport from 'rbush';
// Handle CJS/ESM interop — rbush exports differently depending on context
const RBush = (typeof (RBushImport as any).default === 'function'
	? (RBushImport as any).default
	: RBushImport) as typeof RBushImport;
import type { EntityId } from './ecs/index.js';
import type { AABB } from './math.js';

export interface SpatialEntry extends AABB {
	entityId: EntityId;
}

/**
 * Spatial index backed by an R-tree (rbush).
 * Stores world-space AABBs for fast viewport culling and hit testing.
 */
export class SpatialIndex {
	private tree = new RBush<SpatialEntry>();
	private entries = new Map<EntityId, SpatialEntry>();

	upsert(entityId: EntityId, bounds: AABB) {
		const existing = this.entries.get(entityId);
		if (existing) {
			this.tree.remove(existing, (a: SpatialEntry, b: SpatialEntry) => a.entityId === b.entityId);
		}
		const entry: SpatialEntry = { ...bounds, entityId };
		this.entries.set(entityId, entry);
		this.tree.insert(entry);
	}

	remove(entityId: EntityId) {
		const existing = this.entries.get(entityId);
		if (existing) {
			this.tree.remove(existing, (a: SpatialEntry, b: SpatialEntry) => a.entityId === b.entityId);
			this.entries.delete(entityId);
		}
	}

	/** Query all entries intersecting the given AABB */
	search(bounds: AABB): SpatialEntry[] {
		return this.tree.search(bounds);
	}

	/** Find the topmost entity at a point (by z-order — caller sorts) */
	searchPoint(x: number, y: number, tolerance: number = 0): SpatialEntry[] {
		return this.tree.search({
			minX: x - tolerance,
			minY: y - tolerance,
			maxX: x + tolerance,
			maxY: y + tolerance,
		});
	}

	clear() {
		this.tree.clear();
		this.entries.clear();
	}

	get size(): number {
		return this.entries.size;
	}
}
