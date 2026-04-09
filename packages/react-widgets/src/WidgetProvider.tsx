import type { ReactNode } from 'react';
import { WidgetResolverProvider } from '@infinite-canvas/react';
import type { WidgetRegistry } from './registry.js';

interface WidgetProviderProps {
	registry: WidgetRegistry;
	children?: ReactNode;
}

/**
 * Connects a WidgetRegistry to the InfiniteCanvas.
 * The WidgetSlots in @infinite-canvas/react will use this registry
 * to resolve widget type strings to React components.
 */
export function WidgetProvider({ registry, children }: WidgetProviderProps) {
	const resolver = (_entityId: number, widgetType: string) => {
		const def = registry.get(widgetType);
		return def?.component ?? null;
	};

	return (
		<WidgetResolverProvider value={resolver}>
			{children}
		</WidgetResolverProvider>
	);
}
