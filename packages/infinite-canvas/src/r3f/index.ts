export type {
	CompositorContextValue,
	CompositorWidgetEntry,
	R3FPaintedAt,
	R3FPhase,
	R3FRenderBudgetData,
	R3FRenderStateData,
} from './compositor/index.js';
export {
	CompositionMaterial,
	Compositor,
	CompositorContext,
	R3FAnimationSignal,
	R3FRenderBudget,
	R3FRenderState,
	ResourceRegistry,
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
} from './compositor/index.js';
export { ProfilerProbe } from './ProfilerProbe.js';
export { R3FManager } from './R3FManager.js';
export type {
	CreateGeometryCardWidgetOptions,
	GeometryCardBackground,
	GeometryCardRenderProps,
} from './widgets/geometry-card.js';
export { createGeometryCardWidget } from './widgets/geometry-card.js';
