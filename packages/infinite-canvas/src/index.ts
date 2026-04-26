// Re-exported from @jamesyong42/reactive-ecs for convenience
export type {
	ComponentInit,
	ComponentType,
	EntityId,
	ResourceType,
	TagType,
	Unsubscribe,
	World,
} from '@jamesyong42/reactive-ecs';

// === ECS core ===

export type { Archetype, ArchetypeRegistry, SpawnOptions } from './ecs/archetype.js';
export { createArchetypeRegistry } from './ecs/archetype.js';
export type { Command, EntitySnapshot } from './ecs/commands.js';
export {
	CommandBuffer,
	ConsumeCommand,
	MoveCommand,
	ResizeCommand,
	rehydrateEntity,
	SetComponentCommand,
	snapshotEntity,
} from './ecs/commands.js';
export type {
	CardPreset,
	CSSCursor,
	CursorHintData,
	InteractionRoleData,
	InteractionRoleType,
	LayerData,
	LayerName,
	TweenEasing,
} from './ecs/components.js';
export {
	Active,
	Card,
	CardOverlapHotPoint,
	Children,
	Container,
	ContainerCamera,
	ContainerChildren,
	Culled,
	CursorHint,
	Draggable,
	Dragging,
	InteractionRole,
	Layer,
	Locked,
	OverlapCandidate,
	OverlapTarget,
	ParentFrame,
	Resizable,
	Selectable,
	Selected,
	SelectionFrame,
	SnapSource,
	SnapTarget,
	Transform2D,
	TransformTween,
	Visible,
	Widget,
	WidgetBreakpoint,
	WidgetData,
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
	aabbToRect,
	clamp,
	intersectsAABB,
	pointInAABB,
	rectToAABB,
	screenToWorld,
	worldToScreen,
} from './ecs/math.js';

// === Hierarchy helpers ===

export { isFrameAncestorOf } from './ecs/hierarchy.js';

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

export type {
	Breakpoint,
	CursorResourceData,
	FrameCameraState,
	LayerOrderData,
	NavigationFrame,
} from './ecs/resources.js';
export {
	BreakpointConfigResource,
	CameraResource,
	CardPresetsResource,
	CursorResource,
	LayerOrderResource,
	NavigationStackResource,
	RootCameraResource,
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
	WidgetInteractionHandlers,
	WidgetRegistry,
	WidgetSurface,
} from './react/widgets/registry.js';
export { createWidgetRegistry, isR3FWidget } from './react/widgets/registry.js';
export { WidgetProvider } from './react/widgets/WidgetProvider.js';

// === DOM card widget helper ===

export type { CardChromeProps } from './react/widgets/CardChrome.js';
export { CardChrome } from './react/widgets/CardChrome.js';
export type { CardFrameProps, CreateCardWidgetOptions } from './react/widgets/card.js';
export { CardFrame, createCardWidget } from './react/widgets/card.js';

// === R3F geometry card widget helper ===

export type {
	CreateGeometryCardWidgetOptions,
	GeometryCardRenderProps,
} from './r3f/widgets/geometry-card.js';
export { createGeometryCardWidget } from './r3f/widgets/geometry-card.js';

// === R3F compositor hooks (for widget authors) ===

export type { R3FPhase } from './r3f/compositor/index.js';
export {
	isOutOfBand,
	selectBand,
	useSharedGeometry,
	useSharedMaterial,
	useSharedTexture,
	useWidgetAnimation,
	useWidgetInvalidate,
	useWidgetPhase,
	ZOOM_BANDS,
} from './r3f/compositor/index.js';

// === Grid + selection config (needed for InfiniteCanvas props) ===

export type { OverlapGlowConfig } from './react/widgets/overlap-glow.js';
export { DEFAULT_OVERLAP_GLOW_CONFIG } from './react/widgets/overlap-glow.js';
export type { GridConfig } from './webgl/renderers/GridRenderer.js';
export { DEFAULT_GRID_CONFIG } from './webgl/renderers/GridRenderer.js';
export type {
	SelectionBounds,
	SelectionConfig,
} from './webgl/renderers/SelectionRenderer.js';
export { DEFAULT_SELECTION_CONFIG } from './webgl/renderers/SelectionRenderer.js';
export type { SnapGuideConfig } from './webgl/renderers/SnapGuideRenderer.js';
export { DEFAULT_SNAP_GUIDE_CONFIG } from './webgl/renderers/SnapGuideRenderer.js';
