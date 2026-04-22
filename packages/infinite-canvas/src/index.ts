// Re-exported from @jamesyong42/reactive-ecs for convenience
export type {
	ComponentInit,
	ComponentType,
	EntityId,
	ResourceType,
	TagType,
	Unsubscribe,
} from '@jamesyong42/reactive-ecs';

// === ECS core ===

export type { Archetype, ArchetypeRegistry, SpawnOptions } from './ecs/archetype.js';
export { createArchetypeRegistry } from './ecs/archetype.js';
export type { Command } from './ecs/commands.js';
export {
	CommandBuffer,
	MoveCommand,
	ResizeCommand,
	SetComponentCommand,
} from './ecs/commands.js';
export type {
	CardPreset,
	CSSCursor,
	CursorHintData,
	HandleSetData,
	InteractionRoleData,
	InteractionRoleType,
} from './ecs/components.js';
export {
	Active,
	Card,
	Children,
	Container,
	Culled,
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
	SelectionFrame,
	Transform2D,
	Visible,
	Widget,
	WidgetBreakpoint,
	WidgetData,
	WorldBounds,
	ZIndex,
} from './ecs/components.js';

// === Engine ===

export type {
	FrameChanges,
	LayoutEngine,
	LayoutEngineConfig,
	Modifiers,
	PointerDirective,
	ResizeHandlePos,
	VisibleEntity,
} from './ecs/engine/index.js';
export { createLayoutEngine } from './ecs/engine/index.js';

// === Math ===

export type { AABB, Rect, Vec2 } from './ecs/math.js';
export {
	clamp,
	intersectsAABB,
	pointInAABB,
	screenToWorld,
	worldBoundsToAABB,
	worldToScreen,
} from './ecs/math.js';

// === Profiler types (commonly needed) ===

export type {
	EcsStats,
	FrameTimeStats,
	ProfilerStats,
	R3FPhaseHistogram,
	R3FSample,
	R3FStats,
	TickSample,
	WebGLPass,
	WebGLStats,
} from './profiler/Profiler.js';

// === Resources ===

export type { Breakpoint, CursorResourceData, NavigationFrame } from './ecs/resources.js';
export {
	BreakpointConfigResource,
	CameraResource,
	CardPresetsResource,
	CursorResource,
	NavigationStackResource,
	ViewportResource,
	ZoomConfigResource,
} from './ecs/resources.js';

// === Standard Schema v1 (for widget data validation) ===

export type { StandardSchemaV1 } from './ecs/schema.js';

// === Snap ===

export type {
	EntityBounds,
	EqualSpacingIndicator,
	SnapGuide,
	SnapResult,
} from './ecs/spatial/snap.js';

// === React components and hooks ===

export type { ResolvedWidget } from './react/context/index.js';
export {
	useContainerRef,
	useLayoutEngine,
	useWidgetResolver,
	WidgetResolverProvider,
} from './react/context/index.js';
export {
	useAllEntities,
	useBreakpoint,
	useCamera,
	useChildren,
	useComponent,
	useEntityComponents,
	useEntityTags,
	useIsSelected,
	useQuery,
	useRegisteredComponents,
	useRegisteredTags,
	useResource,
	useTag,
	useTaggedEntities,
	useUpdateWidget,
	useWidgetData,
} from './react/hooks/index.js';
export type { InfiniteCanvasHandle } from './react/InfiniteCanvas.js';
export { InfiniteCanvas } from './react/InfiniteCanvas.js';
export type {
	DomWidget,
	DomWidgetProps,
	R3FWidget,
	R3FWidgetProps,
	Widget as WidgetDef,
	WidgetRegistry,
	WidgetSurface,
} from './react/widgets/registry.js';
export { createWidgetRegistry, isR3FWidget } from './react/widgets/registry.js';
export { WidgetProvider } from './react/widgets/WidgetProvider.js';

// === DOM card widget helper ===

export type { CardFrameProps, CreateCardWidgetOptions } from './react/widgets/card.js';
export { CardFrame, createCardWidget } from './react/widgets/card.js';

// === R3F geometry card widget helper ===

export type {
	CreateGeometryCardWidgetOptions,
	GeometryCardBackground,
	GeometryCardRenderProps,
} from './r3f/widgets/geometry-card.js';
export { createGeometryCardWidget } from './r3f/widgets/geometry-card.js';

// === R3F compositor hooks (for widget authors) ===

export type { R3FPhase } from './r3f/compositor/index.js';
export {
	useSharedGeometry,
	useSharedMaterial,
	useSharedTexture,
	useWidgetAnimation,
	useWidgetInvalidate,
	useWidgetPhase,
} from './r3f/compositor/index.js';

// === Grid + selection config (needed for InfiniteCanvas props) ===

export type { GridConfig } from './webgl/renderers/GridRenderer.js';
export { DEFAULT_GRID_CONFIG } from './webgl/renderers/GridRenderer.js';
export type {
	SelectionBounds,
	SelectionConfig,
} from './webgl/renderers/SelectionRenderer.js';
export { DEFAULT_SELECTION_CONFIG } from './webgl/renderers/SelectionRenderer.js';
