// Engine
export {
	createLayoutEngine,
	createCanvasEngine,
	SpatialIndexResource,
} from './engine.js';
export type {
	LayoutEngine,
	LayoutEngineConfig,
	CanvasEngine,
	CanvasEngineConfig,
	AddWidgetOptions,
	PointerDirective,
	ResizeHandlePos,
	Modifiers,
	VisibleEntity,
	FrameChanges,
} from './engine.js';

// React component
export { InfiniteCanvas } from './react/InfiniteCanvas.js';

// Context hooks
export {
	useLayoutEngine,
	useEngine,
	useContainerRef,
	useWidgetResolver,
	WidgetResolverProvider,
} from './react/context.js';
export type { WidgetResolver, ResolvedWidget, WidgetSurface } from './react/context.js';

// ECS subscription hooks
export {
	useComponent,
	useTag,
	useResource,
	useQuery,
	useTaggedEntities,
} from './react/hooks.js';

// Widget hooks
export {
	useWidgetData,
	useBreakpoint,
	useChildren,
	useWidgetChildren,
	useIsSelected,
	useUpdateWidget,
	useUpdateData,
} from './react/widget-hooks.js';

// Widget registry & provider
export { createWidgetRegistry } from './react/registry.js';
export type { WidgetDef, WidgetRegistry } from './react/registry.js';
export { WidgetProvider } from './react/WidgetProvider.js';

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
export {
	screenToWorld,
	worldToScreen,
	intersectsAABB,
	pointInAABB,
	worldBoundsToAABB,
	clamp,
} from './math.js';
export type { Vec2, Rect, AABB } from './math.js';

// Commands
export { CommandBuffer, MoveCommand, ResizeCommand, SetComponentCommand } from './commands.js';
export type { Command } from './commands.js';

// Grid & selection config (commonly needed for InfiniteCanvas props)
export { DEFAULT_GRID_CONFIG } from './react/webgl/GridRenderer.js';
export type { GridConfig } from './react/webgl/GridRenderer.js';
export { DEFAULT_SELECTION_CONFIG } from './react/webgl/SelectionRenderer.js';
export type { SelectionConfig, SelectionBounds } from './react/webgl/SelectionRenderer.js';

// Snap types (for reading snap guide state)
export type { SnapGuide, EqualSpacingIndicator, SnapResult, EntityBounds } from './snap.js';

// ECS types (commonly needed)
export type {
	EntityId,
	ComponentType,
	TagType,
	ResourceType,
	ComponentInit,
	Unsubscribe,
} from './ecs/types.js';

// Profiler types (commonly needed)
export type { FrameSample, ProfilerStats } from './profiler.js';
