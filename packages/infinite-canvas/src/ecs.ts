// ECS primitives for advanced users
export {
	defineComponent,
	defineTag,
	defineResource,
	defineSystem,
	createWorld,
	SystemScheduler,
} from './ecs/index.js';

export type {
	EntityId,
	ComponentType,
	TagType,
	ResourceType,
	SystemDef,
	ComponentInit,
	QueryResult,
	World,
	Unsubscribe,
} from './ecs/index.js';
