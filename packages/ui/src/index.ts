// Main component
export { InfiniteCanvas } from './InfiniteCanvas.js';

// Context (for widget packages to provide resolvers)
export {
	useEngine,
	useContainerRef,
	WidgetResolverProvider,
	useWidgetResolver,
} from './context.js';
export type { WidgetResolver, ResolvedWidget, WidgetSurface } from './context.js';

// Generic ECS hooks (the primitives — widget packages build on these)
export {
	useComponent,
	useTag,
	useResource,
	useQuery,
	useTaggedEntities,
} from './hooks.js';

// Sub-components (for advanced composition)
export { WidgetSlot } from './WidgetSlot.js';
export { SelectionFrame } from './SelectionFrame.js';
export { SelectionOverlaySlot } from './SelectionOverlaySlot.js';

// WebGL
export { GridRenderer, DEFAULT_GRID_CONFIG } from './webgl/GridRenderer.js';
export type { GridConfig } from './webgl/GridRenderer.js';
export { SelectionRenderer, DEFAULT_SELECTION_CONFIG } from './webgl/SelectionRenderer.js';
export type { SelectionConfig, SelectionBounds } from './webgl/SelectionRenderer.js';
export { WebGLWidgetLayer } from './webgl/WebGLWidgetLayer.js';
export { WebGLWidgetSlot } from './webgl/WebGLWidgetSlot.js';
