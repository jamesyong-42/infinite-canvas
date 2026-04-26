import type { ComponentType, EntityId, TagType, World } from '@jamesyong42/reactive-ecs';
import { Children, ContainerChildren, ParentFrame } from './components.js';
import type { FrameCameraState } from './resources.js';
import { CameraResource, RootCameraResource } from './resources.js';

// === Serialization Types ===

/**
 * JSON-serializable snapshot of the canvas state, including all entities,
 * the current camera, and the persisted root-frame camera.
 *
 * The navigation stack is **not** serialized — reloading a canvas always
 * drops the user at the root frame (RFC-004 § Phase 0c). Per-container
 * camera state is persisted via the `ContainerCamera` component on each
 * container entity (serialized as part of its component set).
 */
export interface CanvasDocument {
	version: number;
	entities: SerializedEntity[];
	resources: {
		/** Current live camera (whatever frame the user was in at serialize time). */
		camera: FrameCameraState;
		/** Persisted root-frame camera — restored on load. */
		rootCamera: FrameCameraState;
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
	camera: FrameCameraState,
	rootCamera: FrameCameraState,
): CanvasDocument {
	const entities: SerializedEntity[] = [];

	// Get all entity IDs (use a broad query)
	const allEntities = world.query();

	for (const entityId of allEntities) {
		const components: Record<string, unknown> = {};
		const tags: string[] = [];

		for (const type of componentTypes) {
			// Skip runtime-only components: `PreDragLayer` is recomputed by
			// dragPromoteSystem on the next Dragging flip; `TransformTween`
			// is an in-flight animation that should not be paused / resumed
			// across reloads (the destination `Transform2D` persists instead);
			// `CardOverlapHotPoint` is drag-scoped visual state with no
			// meaning outside an active drag.
			if (
				type.name === 'PreDragLayer' ||
				type.name === 'TransformTween' ||
				type.name === 'CardOverlapHotPoint'
			) {
				continue;
			}
			const data = world.getComponent(entityId, type);
			if (data !== undefined) {
				components[type.name] = structuredClone(data);
			}
		}

		for (const type of tagTypes) {
			if (world.hasTag(entityId, type)) {
				// Skip runtime-only tags: Active/Visible/Culled are recomputed
				// by the cull pipeline; OverlapCandidate/OverlapTarget are
				// drag-scoped and meaningless outside an active drag.
				if (
					type.name !== 'Active' &&
					type.name !== 'Visible' &&
					type.name !== 'Culled' &&
					type.name !== 'OverlapCandidate' &&
					type.name !== 'OverlapTarget'
				) {
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
			rootCamera: { ...rootCamera },
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

	// Second pass: remap cross-reference components (ParentFrame, Children,
	// ContainerChildren).
	for (const [_oldId, newId] of idMap) {
		const parent = world.getComponent(newId, ParentFrame);
		if (parent && idMap.has(parent.id)) {
			const mappedId = idMap.get(parent.id);
			if (mappedId !== undefined) {
				world.setComponent(newId, ParentFrame, { id: mappedId });
			}
		}

		const children = world.getComponent(newId, Children);
		if (children) {
			world.setComponent(newId, Children, {
				ids: children.ids.map((id: EntityId) => idMap.get(id) ?? id),
			});
		}

		const containerChildren = world.getComponent(newId, ContainerChildren);
		if (containerChildren) {
			// Drop ids that didn't round-trip (child was destroyed before save
			// and still lingered in the list) rather than falling back to the
			// raw pre-save id — that id may have been recycled to an unrelated
			// entity by the post-load world and would leak into the container's
			// child count / navigation target list.
			const mapped: EntityId[] = [];
			for (const id of containerChildren.ids) {
				const remapped = idMap.get(id);
				if (remapped !== undefined) mapped.push(remapped);
			}
			world.setComponent(newId, ContainerChildren, { ids: mapped });
		}
	}

	// Restore camera resources. `gesturing` resets to false on load — it's
	// transient interaction state, not persisted view state.
	const live = doc.resources.camera;
	world.setResource(CameraResource, { x: live.x, y: live.y, zoom: live.zoom, gesturing: false });
	world.setResource(RootCameraResource, { ...doc.resources.rootCamera });

	// NavigationStack is deliberately not restored — users always return
	// to the root frame on load (RFC-004 § Phase 0c).
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
			// Skip runtime-only components: `PreDragLayer` is recomputed by
			// dragPromoteSystem on the next Dragging flip; `TransformTween`
			// is an in-flight animation that should not be paused / resumed
			// across reloads (the destination `Transform2D` persists instead);
			// `CardOverlapHotPoint` is drag-scoped visual state with no
			// meaning outside an active drag.
			if (
				type.name === 'PreDragLayer' ||
				type.name === 'TransformTween' ||
				type.name === 'CardOverlapHotPoint'
			) {
				continue;
			}
			const data = world.getComponent(entityId, type);
			if (data !== undefined) {
				components[type.name] = structuredClone(data);
			}
		}

		for (const type of tagTypes) {
			if (world.hasTag(entityId, type)) {
				if (type.name !== 'Active' && type.name !== 'Visible' && type.name !== 'Culled') {
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
