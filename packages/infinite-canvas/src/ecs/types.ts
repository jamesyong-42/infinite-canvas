/** Opaque entity identifier — sequential integer internally */
export type EntityId = number;

/** Component type definition created by defineComponent() */
export interface ComponentType<T = unknown> {
	readonly name: string;
	readonly defaults: T;
	/** Internal brand to distinguish components from tags */
	readonly __kind: 'component';
}

/** Tag type definition created by defineTag() — marker with no data */
export interface TagType {
	readonly name: string;
	readonly __kind: 'tag';
}

/** Resource type definition created by defineResource() */
export interface ResourceType<T = unknown> {
	readonly name: string;
	readonly defaults: T;
	readonly __kind: 'resource';
}

/** System definition created by defineSystem() */
export interface SystemDef {
	readonly name: string;
	readonly reads?: ReadonlyArray<ComponentType | TagType>;
	readonly writes?: ReadonlyArray<ComponentType | TagType>;
	readonly after?: string | string[];
	readonly before?: string | string[];
	execute: (world: World) => void;
}

/** Query result — array of entity IDs */
export type QueryResult = EntityId[];

/** Component initializer for entity creation */
export type ComponentInit = [ComponentType<unknown>, unknown] | [TagType];

/** Event handler types */
export type ComponentChangedHandler<T = unknown> = (
	entityId: EntityId,
	prev: T | undefined,
	next: T,
) => void;

export type TagChangedHandler = (entityId: EntityId) => void;

export type FrameHandler = () => void;

export type Unsubscribe = () => void;

/** The World interface -- core ECS container managing entities, components, tags, and resources. */
export interface World {
	/** Current tick number, incremented each frame. */
	readonly currentTick: number;
	/** Number of live entities. */
	readonly entityCount: number;

	// Entity lifecycle

	/** Creates a new entity and returns its ID. */
	createEntity(): EntityId;
	/** Destroys an entity and removes all its components and tags. */
	destroyEntity(id: EntityId): void;
	/** Checks if an entity ID is still alive. */
	entityExists(id: EntityId): boolean;

	// Component access

	/** Attaches a component with data to an entity. */
	addComponent<T>(entity: EntityId, type: ComponentType<T>, data: T): void;
	/** Removes a component from an entity. */
	removeComponent<T>(entity: EntityId, type: ComponentType<T>): void;
	/** Reads a component from an entity. Returns undefined if not present. */
	getComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined;
	/** Checks if an entity has a component. */
	hasComponent(entity: EntityId, type: ComponentType): boolean;
	/** Partially updates a component on an entity (shallow merge). */
	setComponent<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>): void;

	// Tag access

	/** Adds a boolean tag to an entity. */
	addTag(entity: EntityId, type: TagType): void;
	/** Removes a tag from an entity. */
	removeTag(entity: EntityId, type: TagType): void;
	/** Checks if an entity has a tag. */
	hasTag(entity: EntityId, type: TagType): boolean;

	// Queries

	/** Returns entity IDs matching all specified component/tag types. */
	query(...types: (ComponentType | TagType)[]): QueryResult;
	/** Returns entities whose component changed this tick. */
	queryChanged(type: ComponentType): QueryResult;
	/** Returns entities that received this component this tick. */
	queryAdded(type: ComponentType): QueryResult;
	/** Returns all entities with a specific tag. */
	queryTagged(type: TagType): QueryResult;

	// Resources

	/** Reads a singleton resource. */
	getResource<T>(type: ResourceType<T>): T;
	/** Partially updates a singleton resource (shallow merge). */
	setResource<T>(type: ResourceType<T>, data: Partial<T>): void;

	// Events

	/** Subscribes to component changes, optionally filtered to a single entity. */
	onComponentChanged<T>(
		type: ComponentType<T>,
		handler: ComponentChangedHandler<T>,
		entityId?: EntityId,
	): Unsubscribe;
	/** Subscribes to tag additions, optionally filtered to a single entity. */
	onTagAdded(type: TagType, handler: TagChangedHandler, entityId?: EntityId): Unsubscribe;
	/** Subscribes to tag removals, optionally filtered to a single entity. */
	onTagRemoved(type: TagType, handler: TagChangedHandler, entityId?: EntityId): Unsubscribe;
	/** Subscribes to entity destruction events. */
	onEntityDestroyed(callback: (entity: EntityId) => void): Unsubscribe;
	/** Subscribes to frame-end events (emitted after each tick). */
	onFrame(handler: FrameHandler): Unsubscribe;

	// Frame lifecycle (used by engine after tick)

	/** Clears per-frame dirty tracking state. */
	clearDirty(): void;
	/** Increments the tick counter. */
	incrementTick(): void;
	/** Emits frame-end events to all onFrame subscribers. */
	emitFrame(): void;
}
