import { Children, HandleSet, Parent } from './components.js';
import type { ComponentType, EntityId, TagType, World } from './ecs/index.js';
import type { NavigationFrame } from './resources.js';

// === Serialization Types ===

/** JSON-serializable snapshot of the canvas state, including all entities and camera. */
export interface CanvasDocument {
	version: number;
	entities: SerializedEntity[];
	resources: {
		camera: { x: number; y: number; zoom: number };
		navigationStack: NavigationFrame[];
	};
}

/** A single serialized entity with its components and tags. */
export interface SerializedEntity {
	id: EntityId;
	components: Record<string, unknown>;
	tags: string[];
}

// === Serialize/Deserialize ===

/**
 * Serializes all entities, components, and tags to a JSON-compatible document.
 * Requires registries of known component and tag types for enumeration.
 */
export function serializeWorld(
	world: World,
	componentTypes: ComponentType[],
	tagTypes: TagType[],
	camera: { x: number; y: number; zoom: number },
	navigationFrames: NavigationFrame[],
): CanvasDocument {
	const entities: SerializedEntity[] = [];

	// Get all entity IDs (use a broad query)
	const allEntities = world.query();

	for (const entityId of allEntities) {
		const components: Record<string, unknown> = {};
		const tags: string[] = [];

		for (const type of componentTypes) {
			const data = world.getComponent(entityId, type);
			if (data !== undefined) {
				components[type.name] = structuredClone(data);
			}
		}

		for (const type of tagTypes) {
			if (world.hasTag(entityId, type)) {
				// Skip runtime-only tags (Active, Visible — they're recomputed)
				if (type.name !== 'Active' && type.name !== 'Visible') {
					tags.push(type.name);
				}
			}
		}

		if (Object.keys(components).length > 0 || tags.length > 0) {
			entities.push({ id: entityId, components, tags });
		}
	}

	return {
		version: 1,
		entities,
		resources: {
			camera: { ...camera },
			navigationStack: structuredClone(navigationFrames),
		},
	};
}

/**
 * Restores entities from a serialized document into the world.
 * Clears existing state first and remaps entity IDs automatically.
 */
export function deserializeWorld(
	world: World,
	doc: CanvasDocument,
	componentTypes: ComponentType[],
	tagTypes: TagType[],
): void {
	if (doc.version !== 1) {
		throw new Error(`Unsupported canvas document version: ${doc.version}. Expected version 1.`);
	}

	// Build lookup maps
	const compByName = new Map<string, ComponentType>();
	for (const t of componentTypes) compByName.set(t.name, t);

	const tagByName = new Map<string, TagType>();
	for (const t of tagTypes) tagByName.set(t.name, t);

	// Destroy all existing entities
	for (const entityId of world.query()) {
		world.destroyEntity(entityId);
	}

	// First pass: create entities and build old-to-new ID mapping
	const idMap = new Map<EntityId, EntityId>();

	for (const entry of doc.entities) {
		const newId = world.createEntity();
		idMap.set(entry.id as EntityId, newId);

		for (const [compName, data] of Object.entries(entry.components)) {
			const type = compByName.get(compName);
			if (type) {
				world.addComponent(newId, type, data);
			}
		}

		for (const tagName of entry.tags) {
			const type = tagByName.get(tagName);
			if (type) {
				world.addTag(newId, type);
			}
		}
	}

	// Second pass: remap cross-reference components (Parent, Children, HandleSet)
	for (const [_oldId, newId] of idMap) {
		const parent = world.getComponent(newId, Parent);
		if (parent && idMap.has(parent.id)) {
			const mappedId = idMap.get(parent.id);
			if (mappedId !== undefined) {
				world.setComponent(newId, Parent, { id: mappedId });
			}
		}

		const children = world.getComponent(newId, Children);
		if (children) {
			world.setComponent(newId, Children, {
				ids: children.ids.map((id: EntityId) => idMap.get(id) ?? id),
			});
		}

		const handleSet = world.getComponent(newId, HandleSet);
		if (handleSet) {
			world.setComponent(newId, HandleSet, {
				ids: handleSet.ids.map((id: EntityId) => idMap.get(id) ?? id),
			});
		}
	}
}

/**
 * Serializes a subset of entities (e.g., for copy/paste).
 * Recursively includes children of the specified entities.
 */
export function serializeEntities(
	world: World,
	entityIds: EntityId[],
	componentTypes: ComponentType[],
	tagTypes: TagType[],
): SerializedEntity[] {
	const result: SerializedEntity[] = [];
	const visited = new Set<EntityId>();

	function visit(entityId: EntityId) {
		if (visited.has(entityId)) return;
		visited.add(entityId);

		const components: Record<string, unknown> = {};
		const tags: string[] = [];

		for (const type of componentTypes) {
			const data = world.getComponent(entityId, type);
			if (data !== undefined) {
				components[type.name] = structuredClone(data);
			}
		}

		for (const type of tagTypes) {
			if (world.hasTag(entityId, type)) {
				if (type.name !== 'Active' && type.name !== 'Visible') {
					tags.push(type.name);
				}
			}
		}

		result.push({ id: entityId, components, tags });

		// Recurse into children. components.Children is typed as unknown via
		// the Record<string, unknown> shape, so narrow through a cast.
		const children = components.Children as { ids?: EntityId[] } | undefined;
		if (children?.ids) {
			for (const childId of children.ids) {
				visit(childId);
			}
		}
	}

	for (const id of entityIds) {
		visit(id);
	}

	return result;
}
