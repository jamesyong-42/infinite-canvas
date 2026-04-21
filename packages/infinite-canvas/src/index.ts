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
// Archetype API
export type { Archetype, ArchetypeRegistry, SpawnOptions } from './archetype.js';
export { createArchetypeRegistry } from './archetype.js';
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
	Dragging,
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
export type { ResolvedWidget } from './react/context.js';
// Context hooks
export {
	useContainerRef,
	useLayoutEngine,
	useWidgetResolver,
	WidgetResolverProvider,
} from './react/context.js';
// ECS subscription hooks
export {
	useAllEntities,
	useCamera,
	useComponent,
	useEntityComponents,
	useEntityTags,
	useQuery,
	useRegisteredComponents,
	useRegisteredTags,
	useResource,
	useTag,
	useTaggedEntities,
} from './react/hooks.js';
export type { InfiniteCanvasHandle } from './react/InfiniteCanvas.js';
// React component
export { InfiniteCanvas } from './react/InfiniteCanvas.js';
// Widget registry & types
export type {
	DomWidget,
	DomWidgetProps,
	R3FWidget,
	R3FWidgetProps,
	Widget as WidgetDef,
	WidgetRegistry,
	WidgetSurface,
} from './react/registry.js';
export { createWidgetRegistry, isR3FWidget } from './react/registry.js';
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
// Standard Schema v1 (for widget data validation — bring your own validator)
export type { StandardSchemaV1 } from './schema.js';
// Snap types (for reading snap guide state)
export type { EntityBounds, EqualSpacingIndicator, SnapGuide, SnapResult } from './snap.js';
