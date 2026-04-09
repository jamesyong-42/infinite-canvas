import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { WidgetResolverProvider } from '@infinite-canvas/ui';
import type { WidgetRegistry } from './registry.js';

interface WidgetProviderProps {
	registry: WidgetRegistry;
	children?: ReactNode;
}

/**
 * Connects a WidgetRegistry to the InfiniteCanvas.
 * Fix #9: Memoize the resolver so context consumers don't re-render on every parent render.
 */
export function WidgetProvider({ registry, children }: WidgetProviderProps) {
	const resolver = useCallback(
		(_entityId: number, widgetType: string) => {
			const def = registry.get(widgetType);
			return def?.component ?? null;
		},
		[registry],
	);

	return (
		<WidgetResolverProvider value={resolver}>
			{children}
		</WidgetResolverProvider>
	);
}
