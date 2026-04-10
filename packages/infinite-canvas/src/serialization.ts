import type { ComponentType, EntityId, TagType, World } from './ecs/index.js';
import type { NavigationFrame } from './resources.js';

// === Serialization Types ===

export interface CanvasDocument {
	version: number;
	entities: SerializedEntity[];
	resources: {
		camera: { x: number; y: number; zoom: number };
		navigationStack: NavigationFrame[];
	};
}

export interface SerializedEntity {
	id: EntityId;
	components: Record<string, any>;
	tags: string[];
}

// === Serialize/Deserialize ===

/**
 * Serialize the entire world to a JSON-serializable document.
 * Requires registries of known component types and tag types.
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
		const components: Record<string, any> = {};
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
 * Deserialize a document into the world.
 * Clears existing world state first.
 */
export function deserializeWorld(
	world: World,
	doc: CanvasDocument,
	componentTypes: ComponentType[],
	tagTypes: TagType[],
): void {
	// Build lookup maps
	const compByName = new Map<string, ComponentType>();
	for (const t of componentTypes) compByName.set(t.name, t);

	const tagByName = new Map<string, TagType>();
	for (const t of tagTypes) tagByName.set(t.name, t);

	// Destroy all existing entities
	for (const entityId of world.query()) {
		world.destroyEntity(entityId);
	}

	// Create entities from document
	for (const entry of doc.entities) {
		const entity = world.createEntity();
		// Note: entity IDs may differ from the serialized IDs.
		// For now, we create new sequential IDs. A more sophisticated
		// approach would use an ID mapping for parent-child references.

		for (const [compName, data] of Object.entries(entry.components)) {
			const type = compByName.get(compName);
			if (type) {
				world.addComponent(entity, type, data);
			}
		}

		for (const tagName of entry.tags) {
			const type = tagByName.get(tagName);
			if (type) {
				world.addTag(entity, type);
			}
		}
	}
}

/**
 * Serialize a subset of entities (e.g., for copy/paste).
 * Includes children recursively.
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

		const components: Record<string, any> = {};
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

		// Recurse into children
		const children = components['Children'];
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
