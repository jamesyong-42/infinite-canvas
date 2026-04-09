// Widget registry
export { createWidgetRegistry } from './registry.js';
export type { WidgetDef, WidgetRegistry } from './registry.js';

// Provider (connects registry to InfiniteCanvas)
export { WidgetProvider } from './WidgetProvider.js';

// Convenience hooks (thin wrappers around generic ECS hooks)
export {
	useWidgetData,
	useBreakpoint,
	useWidgetChildren,
	useIsSelected,
	useUpdateData,
} from './hooks.js';
