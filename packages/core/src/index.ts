// ECS primitives
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

// Engine
export { createCanvasEngine } from './engine.js';
export type {
	CanvasEngine,
	CanvasEngineConfig,
	PointerDirective,
	ResizeHandlePos,
	Modifiers,
	VisibleEntity,
	FrameChanges,
} from './engine.js';

// Built-in components & tags
export {
	Transform2D,
	WorldBounds,
	ZIndex,
	Parent,
	Children,
	Widget,
	WidgetData,
	WidgetBreakpoint,
	Container,
	Selectable,
	Draggable,
	Resizable,
	Locked,
	Selected,
	Active,
	Visible,
} from './components.js';

// Resources
export {
	CameraResource,
	ViewportResource,
	ZoomConfigResource,
	BreakpointConfigResource,
	NavigationStackResource,
} from './resources.js';
export type { Breakpoint, NavigationFrame } from './resources.js';

// Math
export { screenToWorld, worldToScreen, intersectsAABB, pointInAABB, clamp } from './math.js';
export type { Vec2, Rect, AABB } from './math.js';

// Spatial
export { SpatialIndex } from './spatial.js';
