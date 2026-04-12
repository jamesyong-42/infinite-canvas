// WebGL renderers
// Note: DEFAULT_GRID_CONFIG, GridConfig, DEFAULT_SELECTION_CONFIG, SelectionConfig,
// and SelectionBounds are exported from the main entry point (index.ts) since they
// are needed for InfiniteCanvas prop typing.
export { GridRenderer } from './react/webgl/GridRenderer.js';
export { SelectionRenderer } from './react/webgl/SelectionRenderer.js';
export { WebGLWidgetLayer } from './react/webgl/WebGLWidgetLayer.js';
export { WebGLWidgetSlot } from './react/webgl/WebGLWidgetSlot.js';

// Sub-components (for advanced composition)
export { WidgetSlot } from './react/WidgetSlot.js';
export { SelectionOverlaySlot } from './react/SelectionOverlaySlot.js';

// Serialization
export { serializeWorld, deserializeWorld, serializeEntities } from './serialization.js';
export type { CanvasDocument, SerializedEntity } from './serialization.js';

// Snap guide computation
export { computeSnapGuides } from './snap.js';

// Profiler
export { Profiler } from './profiler.js';
export type { FrameSample, ProfilerStats } from './profiler.js';

// Spatial index
export { SpatialIndex } from './spatial.js';

// Context providers (for custom composition)
export { EngineProvider, ContainerRefProvider } from './react/context.js';
