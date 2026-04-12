// Engine
export {
	createLayoutEngine,
} from './engine.js';
export type {
	LayoutEngine,
	LayoutEngineConfig,
	AddWidgetOptions,
	PointerDirective,
	ResizeHandlePos,
	Modifiers,
	VisibleEntity,
	FrameChanges,
} from './engine.js';

// React component
export { InfiniteCanvas } from './react/InfiniteCanvas.js';
export type { InfiniteCanvasHandle } from './react/InfiniteCanvas.js';

// Context hooks
export {
	useLayoutEngine,
	useContainerRef,
	useWidgetResolver,
	WidgetResolverProvider,
} from './react/context.js';
export type { WidgetResolver, ResolvedWidget } from './react/context.js';

// ECS subscription hooks
export {
	useComponent,
	useTag,
	useResource,
	useQuery,
	useTaggedEntities,
	useCamera,
} from './react/hooks.js';

// Widget hooks
export {
	useWidgetData,
	useBreakpoint,
	useChildren,
	useIsSelected,
	useUpdateWidget,
} from './react/widget-hooks.js';

// Widget registry & provider
export { createWidgetRegistry } from './react/registry.js';
export type { WidgetDef, WidgetRegistry, WidgetProps, WidgetSurface } from './react/registry.js';
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
	Hitbox,
	InteractionRole,
	HandleSet,
	CursorHint,
	Selectable,
	Draggable,
	Resizable,
	Locked,
	Selected,
	Active,
	Visible,
} from './components.js';
export type {
	InteractionRoleType,
	InteractionRoleData,
	HandleSetData,
	CursorHintData,
	CSSCursor,
} from './components.js';

// Resources
export {
	CameraResource,
	ViewportResource,
	ZoomConfigResource,
	BreakpointConfigResource,
	NavigationStackResource,
	CursorResource,
} from './resources.js';
export type { Breakpoint, NavigationFrame, CursorResourceData } from './resources.js';

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

// Re-exported from ./ecs/types for convenience — also available via @jamesyong42/infinite-canvas/ecs
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
