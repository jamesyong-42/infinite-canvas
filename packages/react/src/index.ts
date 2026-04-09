// Main component
export { InfiniteCanvas } from './InfiniteCanvas.js';

// Context (for widget packages to provide resolvers)
export {
	useEngine,
	WidgetResolverProvider,
	useWidgetResolver,
} from './context.js';
export type { WidgetResolver } from './context.js';

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
