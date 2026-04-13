// Engine

// Re-exported from @jamesyong42/reactive-ecs for convenience
export type {
	ComponentInit,
	ComponentType,
	EntityId,
	ResourceType,
	TagType,
	Unsubscribe,
} from '@jamesyong42/reactive-ecs';
export type { Command } from './commands.js';
// Commands
export { CommandBuffer, MoveCommand, ResizeCommand, SetComponentCommand } from './commands.js';
export type {
	CSSCursor,
	CursorHintData,
	HandleSetData,
	InteractionRoleData,
	InteractionRoleType,
} from './components.js';
// Built-in components & tags
export {
	Active,
	Children,
	Container,
	CursorHint,
	Draggable,
	HandleSet,
	Hitbox,
	InteractionRole,
	Locked,
	Parent,
	Resizable,
	Selectable,
	Selected,
	Transform2D,
	Visible,
	Widget,
	WidgetBreakpoint,
	WidgetData,
	WorldBounds,
	ZIndex,
} from './components.js';
export type {
	AddWidgetOptions,
	FrameChanges,
	LayoutEngine,
	LayoutEngineConfig,
	Modifiers,
	PointerDirective,
	ResizeHandlePos,
	VisibleEntity,
} from './engine.js';
export { createLayoutEngine } from './engine.js';
export type { AABB, Rect, Vec2 } from './math.js';
// Math
export {
	clamp,
	intersectsAABB,
	pointInAABB,
	screenToWorld,
	worldBoundsToAABB,
	worldToScreen,
} from './math.js';
// Profiler types (commonly needed)
export type { FrameSample, ProfilerStats } from './profiler.js';
export type { ResolvedWidget, WidgetResolver } from './react/context.js';
// Context hooks
export {
	useContainerRef,
	useLayoutEngine,
	useWidgetResolver,
	WidgetResolverProvider,
} from './react/context.js';
// ECS subscription hooks
export {
	useCamera,
	useComponent,
	useQuery,
	useResource,
	useTag,
	useTaggedEntities,
} from './react/hooks.js';
export type { InfiniteCanvasHandle } from './react/InfiniteCanvas.js';
// React component
export { InfiniteCanvas } from './react/InfiniteCanvas.js';
export type { WidgetDef, WidgetProps, WidgetRegistry, WidgetSurface } from './react/registry.js';
// Widget registry & provider
export { createWidgetRegistry } from './react/registry.js';
export { WidgetProvider } from './react/WidgetProvider.js';
export type { GridConfig } from './react/webgl/GridRenderer.js';

// Grid & selection config (commonly needed for InfiniteCanvas props)
export { DEFAULT_GRID_CONFIG } from './react/webgl/GridRenderer.js';
export type { SelectionBounds, SelectionConfig } from './react/webgl/SelectionRenderer.js';
export { DEFAULT_SELECTION_CONFIG } from './react/webgl/SelectionRenderer.js';
// Widget hooks
export {
	useBreakpoint,
	useChildren,
	useIsSelected,
	useUpdateWidget,
	useWidgetData,
} from './react/widget-hooks.js';
export type { Breakpoint, CursorResourceData, NavigationFrame } from './resources.js';
// Resources
export {
	BreakpointConfigResource,
	CameraResource,
	CursorResource,
	NavigationStackResource,
	ViewportResource,
	ZoomConfigResource,
} from './resources.js';
// Snap types (for reading snap guide state)
export type { EntityBounds, EqualSpacingIndicator, SnapGuide, SnapResult } from './snap.js';
