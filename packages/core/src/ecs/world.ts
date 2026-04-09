import type {
	ComponentChangedHandler,
	ComponentType,
	EntityId,
	FrameHandler,
	QueryResult,
	ResourceType,
	TagChangedHandler,
	TagType,
	Unsubscribe,
	World,
} from './types.js';

/** Internal storage for a single component type */
interface ComponentStore<T = any> {
	data: Map<EntityId, T>;
	dirty: Set<EntityId>;
	added: Set<EntityId>;
	handlers: Map<EntityId | '*', Set<ComponentChangedHandler<T>>>;
}

/** Internal storage for a single tag type */
interface TagStore {
	entities: Set<EntityId>;
	addedHandlers: Map<EntityId | '*', Set<TagChangedHandler>>;
	removedHandlers: Map<EntityId | '*', Set<TagChangedHandler>>;
}

export function createWorld(): World {
	let nextEntityId = 1;
	let currentTick = 0;
	const alive = new Set<EntityId>();

	// Component storage: one Map per component type
	const components = new Map<string, ComponentStore>();
	// Tag storage: one Set per tag type
	const tags = new Map<string, TagStore>();
	// Resources: one value per resource type
	const resources = new Map<string, any>();
	// Frame handlers
	const frameHandlers = new Set<FrameHandler>();

	function getComponentStore<T>(type: ComponentType<T>): ComponentStore<T> {
		let store = components.get(type.name);
		if (!store) {
			store = {
				data: new Map(),
				dirty: new Set(),
				added: new Set(),
				handlers: new Map(),
			};
			components.set(type.name, store);
		}
		return store;
	}

	function getTagStore(type: TagType): TagStore {
		let store = tags.get(type.name);
		if (!store) {
			store = {
				entities: new Set(),
				addedHandlers: new Map(),
				removedHandlers: new Map(),
			};
			tags.set(type.name, store);
		}
		return store;
	}

	function emitComponentChanged<T>(
		store: ComponentStore<T>,
		entityId: EntityId,
		prev: T | undefined,
		next: T,
	) {
		// Entity-scoped handlers
		const entityHandlers = store.handlers.get(entityId);
		if (entityHandlers) {
			for (const h of entityHandlers) h(entityId, prev, next);
		}
		// Wildcard handlers
		const wildcardHandlers = store.handlers.get('*');
		if (wildcardHandlers) {
			for (const h of wildcardHandlers) h(entityId, prev, next);
		}
	}

	function emitTagAdded(store: TagStore, entityId: EntityId) {
		const entityHandlers = store.addedHandlers.get(entityId);
		if (entityHandlers) {
			for (const h of entityHandlers) h(entityId);
		}
		const wildcardHandlers = store.addedHandlers.get('*');
		if (wildcardHandlers) {
			for (const h of wildcardHandlers) h(entityId);
		}
	}

	function emitTagRemoved(store: TagStore, entityId: EntityId) {
		const entityHandlers = store.removedHandlers.get(entityId);
		if (entityHandlers) {
			for (const h of entityHandlers) h(entityId);
		}
		const wildcardHandlers = store.removedHandlers.get('*');
		if (wildcardHandlers) {
			for (const h of wildcardHandlers) h(entityId);
		}
	}

	const world: World = {
		get currentTick() {
			return currentTick;
		},

		get entityCount() {
			return alive.size;
		},

		// === Entity lifecycle ===

		createEntity(): EntityId {
			const id = nextEntityId++;
			alive.add(id);
			return id;
		},

		destroyEntity(id: EntityId) {
			if (!alive.has(id)) return;
			alive.delete(id);
			// Remove all components
			for (const store of components.values()) {
				store.data.delete(id);
				store.dirty.delete(id);
				store.added.delete(id);
				store.handlers.delete(id);
			}
			// Remove all tags
			for (const store of tags.values()) {
				store.entities.delete(id);
				store.addedHandlers.delete(id);
				store.removedHandlers.delete(id);
			}
		},

		entityExists(id: EntityId): boolean {
			return alive.has(id);
		},

		// === Component access ===

		addComponent<T>(entity: EntityId, type: ComponentType<T>, data: T) {
			const store = getComponentStore(type);
			const merged = { ...type.defaults, ...data };
			store.data.set(entity, merged);
			store.dirty.add(entity);
			store.added.add(entity);
			emitComponentChanged(store, entity, undefined, merged);
		},

		removeComponent<T>(entity: EntityId, type: ComponentType<T>) {
			const store = getComponentStore(type);
			store.data.delete(entity);
			store.dirty.delete(entity);
		},

		getComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
			const store = getComponentStore(type);
			return store.data.get(entity);
		},

		hasComponent(entity: EntityId, type: ComponentType): boolean {
			const store = getComponentStore(type);
			return store.data.has(entity);
		},

		setComponent<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>) {
			const store = getComponentStore(type);
			const existing = store.data.get(entity);
			if (!existing) return;
			const prev = { ...existing };
			const next = Object.assign(existing, data);
			store.data.set(entity, next);
			store.dirty.add(entity);
			emitComponentChanged(store, entity, prev, next);
		},

		// === Tag access ===

		addTag(entity: EntityId, type: TagType) {
			const store = getTagStore(type);
			if (store.entities.has(entity)) return;
			store.entities.add(entity);
			emitTagAdded(store, entity);
		},

		removeTag(entity: EntityId, type: TagType) {
			const store = getTagStore(type);
			if (!store.entities.has(entity)) return;
			store.entities.delete(entity);
			emitTagRemoved(store, entity);
		},

		hasTag(entity: EntityId, type: TagType): boolean {
			const store = getTagStore(type);
			return store.entities.has(entity);
		},

		// === Queries ===

		query(...types: (ComponentType | TagType)[]): QueryResult {
			if (types.length === 0) return [...alive];

			// Start with the smallest set for efficiency
			let smallest: Set<EntityId> | undefined;
			const componentTypes: ComponentType[] = [];
			const tagTypes: TagType[] = [];

			for (const type of types) {
				if (type.__kind === 'component') {
					const store = getComponentStore(type);
					if (!smallest || store.data.size < smallest.size) {
						smallest = new Set(store.data.keys());
					}
					componentTypes.push(type);
				} else {
					const store = getTagStore(type);
					if (!smallest || store.entities.size < smallest.size) {
						smallest = store.entities;
					}
					tagTypes.push(type);
				}
			}

			if (!smallest) return [];

			const result: EntityId[] = [];
			for (const entity of smallest) {
				if (!alive.has(entity)) continue;
				let match = true;
				for (const ct of componentTypes) {
					if (!getComponentStore(ct).data.has(entity)) {
						match = false;
						break;
					}
				}
				if (match) {
					for (const tt of tagTypes) {
						if (!getTagStore(tt).entities.has(entity)) {
							match = false;
							break;
						}
					}
				}
				if (match) result.push(entity);
			}
			return result;
		},

		queryChanged(type: ComponentType): QueryResult {
			const store = getComponentStore(type);
			return [...store.dirty];
		},

		queryAdded(type: ComponentType): QueryResult {
			const store = getComponentStore(type);
			return [...store.added];
		},

		queryTagged(type: TagType): QueryResult {
			const store = getTagStore(type);
			return [...store.entities];
		},

		// === Resources ===

		getResource<T>(type: ResourceType<T>): T {
			if (!resources.has(type.name)) {
				resources.set(type.name, { ...type.defaults });
			}
			return resources.get(type.name);
		},

		setResource<T>(type: ResourceType<T>, data: Partial<T>) {
			const existing = world.getResource(type);
			Object.assign(existing as Record<string, unknown>, data);
		},

		// === Events ===

		onComponentChanged<T>(
			type: ComponentType<T>,
			handler: ComponentChangedHandler<T>,
			entityId?: EntityId,
		): Unsubscribe {
			const store = getComponentStore(type);
			const key: EntityId | '*' = entityId ?? '*';
			let handlers = store.handlers.get(key);
			if (!handlers) {
				handlers = new Set();
				store.handlers.set(key, handlers);
			}
			handlers.add(handler);
			return () => handlers!.delete(handler);
		},

		onTagAdded(type: TagType, handler: TagChangedHandler, entityId?: EntityId): Unsubscribe {
			const store = getTagStore(type);
			const key: EntityId | '*' = entityId ?? '*';
			let handlers = store.addedHandlers.get(key);
			if (!handlers) {
				handlers = new Set();
				store.addedHandlers.set(key, handlers);
			}
			handlers.add(handler);
			return () => handlers!.delete(handler);
		},

		onTagRemoved(type: TagType, handler: TagChangedHandler, entityId?: EntityId): Unsubscribe {
			const store = getTagStore(type);
			const key: EntityId | '*' = entityId ?? '*';
			let handlers = store.removedHandlers.get(key);
			if (!handlers) {
				handlers = new Set();
				store.removedHandlers.set(key, handlers);
			}
			handlers.add(handler);
			return () => handlers!.delete(handler);
		},

		onFrame(handler: FrameHandler): Unsubscribe {
			frameHandlers.add(handler);
			return () => frameHandlers.delete(handler);
		},

		// Frame lifecycle
		clearDirty() {
			for (const store of components.values()) {
				store.dirty.clear();
				store.added.clear();
			}
		},

		incrementTick() {
			currentTick++;
		},

		emitFrame() {
			for (const h of frameHandlers) h();
		},
	};

	return world;
}
