// ECS primitives for advanced users

export type {
	ComponentInit,
	ComponentType,
	EntityId,
	QueryResult,
	ResourceType,
	SystemDef,
	TagType,
	Unsubscribe,
	World,
} from './ecs/index.js';
export {
	createWorld,
	defineComponent,
	defineResource,
	defineSystem,
	defineTag,
	SystemScheduler,
} from './ecs/index.js';
