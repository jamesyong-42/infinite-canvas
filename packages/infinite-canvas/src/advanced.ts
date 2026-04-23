// Advanced composition surface. Stable but lower-level than the main entry.
// Use these when you need to drop below <InfiniteCanvas> and compose the
// layers yourself — e.g. to replace the WebGL manager, insert custom R3F
// content, or ship the devtools separately.

// === ECS internals ===

export { SpatialIndexResource } from './ecs/resources.js';
export { SpatialIndex } from './ecs/spatial/SpatialIndex.js';
export { computeSnapGuides } from './ecs/spatial/snap.js';

// === Profiler ===

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
export { Profiler } from './profiler/Profiler.js';

// === Serialization ===

export type { CanvasDocument, SerializedEntity } from './ecs/serialization.js';
export { deserializeWorld, serializeEntities, serializeWorld } from './ecs/serialization.js';

// === React composition ===

export { ContainerRefProvider, EngineProvider } from './react/context/index.js';
export { SelectionOverlaySlot } from './react/overlays/SelectionOverlaySlot.js';
export { WidgetSlot } from './react/widgets/WidgetSlot.js';

// === WebGL layer (vanilla Three.js) ===

export { GridRenderer } from './webgl/renderers/GridRenderer.js';
export { SelectionRenderer } from './webgl/renderers/SelectionRenderer.js';
export type { WebGLFrameInput, WebGLManagerOptions } from './webgl/WebGLManager.js';
export { WebGLManager } from './webgl/WebGLManager.js';

// === R3F layer (React Three Fiber) ===

export type {
	CompositorContextValue,
	CompositorWidgetEntry,
	R3FPaintedAt,
	R3FPhase,
	R3FRenderBudgetData,
	R3FRenderStateData,
} from './r3f/compositor/index.js';
export {
	Compositor,
	CompositorContext,
	isOutOfBand,
	R3FAnimationSignal,
	R3FRenderBudget,
	R3FRenderState,
	ResourceRegistry,
	selectBand,
	useCompositor,
	useSharedGeometry,
	useSharedMaterial,
	useSharedTexture,
	useWidgetAnimation,
	useWidgetInvalidate,
	useWidgetPhase,
	VirtualWidget,
	WidgetRenderTargetPool,
	WidgetStateMachine,
	ZOOM_BANDS,
} from './r3f/compositor/index.js';
export { ProfilerProbe } from './r3f/ProfilerProbe.js';
export { R3FManager } from './r3f/R3FManager.js';
