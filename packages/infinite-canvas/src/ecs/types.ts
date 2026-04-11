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

/** The World interface — core ECS container */
export interface World {
	readonly currentTick: number;
	readonly entityCount: number;

	// Entity lifecycle
	createEntity(): EntityId;
	destroyEntity(id: EntityId): void;
	entityExists(id: EntityId): boolean;

	// Component access
	addComponent<T>(entity: EntityId, type: ComponentType<T>, data: T): void;
	removeComponent<T>(entity: EntityId, type: ComponentType<T>): void;
	getComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined;
	hasComponent(entity: EntityId, type: ComponentType): boolean;
	setComponent<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>): void;

	// Tag access
	addTag(entity: EntityId, type: TagType): void;
	removeTag(entity: EntityId, type: TagType): void;
	hasTag(entity: EntityId, type: TagType): boolean;

	// Queries
	query(...types: (ComponentType | TagType)[]): QueryResult;
	queryChanged(type: ComponentType): QueryResult;
	queryAdded(type: ComponentType): QueryResult;
	queryTagged(type: TagType): QueryResult;

	// Resources
	getResource<T>(type: ResourceType<T>): T;
	setResource<T>(type: ResourceType<T>, data: Partial<T>): void;

	// Events
	onComponentChanged<T>(
		type: ComponentType<T>,
		handler: ComponentChangedHandler<T>,
		entityId?: EntityId,
	): Unsubscribe;
	onTagAdded(type: TagType, handler: TagChangedHandler, entityId?: EntityId): Unsubscribe;
	onTagRemoved(type: TagType, handler: TagChangedHandler, entityId?: EntityId): Unsubscribe;
	onFrame(handler: FrameHandler): Unsubscribe;

	// Frame lifecycle (used by engine after tick)
	clearDirty(): void;
	incrementTick(): void;
	emitFrame(): void;
}
