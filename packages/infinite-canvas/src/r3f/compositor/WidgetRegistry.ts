import type { EntityId } from '@jamesyong42/reactive-ecs';
import type { CompositorWidgetEntry } from './CompositorContext.js';

/**
 * Stable per-canvas registry of R3F widget scenes + cameras (RFC-006).
 *
 * Created in `R3FManager` so it's reachable both by the `Compositor`
 * (which adds/removes widgets as `VirtualWidget` mounts) and by the
 * R3F event factory (which resolves the active widget by entityId
 * returned from `engine.pickAt`, then looks up its scene + camera here).
 *
 * Plain Map under the hood — the wrapping class exists to give the
 * registry a stable identity across React renders and to keep the read
 * surface (`get`, `keys`, `all`) discoverable from both consumers.
 */
export class WidgetRegistry {
	private readonly entries = new Map<EntityId, CompositorWidgetEntry>();

	register(entityId: EntityId, entry: CompositorWidgetEntry): () => void {
		this.entries.set(entityId, entry);
		return () => this.entries.delete(entityId);
	}

	get(entityId: EntityId): CompositorWidgetEntry | undefined {
		return this.entries.get(entityId);
	}

	all(): IterableIterator<[EntityId, CompositorWidgetEntry]> {
		return this.entries.entries();
	}

	keys(): IterableIterator<EntityId> {
		return this.entries.keys();
	}

	values(): IterableIterator<CompositorWidgetEntry> {
		return this.entries.values();
	}

	clear(): void {
		this.entries.clear();
	}
}
