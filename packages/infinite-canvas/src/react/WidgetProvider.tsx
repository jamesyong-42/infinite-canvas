import type { ReactNode } from 'react';
import { useCallback } from 'react';
import type { LayoutEngine } from '../engine.js';
import type { ResolvedWidget } from './context.js';
import { WidgetResolverProvider } from './context.js';
import { isR3FWidget } from './registry.js';

interface WidgetProviderProps {
	engine: LayoutEngine;
	children?: ReactNode;
}

/**
 * Bridges the engine's widget registry to React context so WidgetSlot /
 * WebGLWidgetLayer can resolve components by type.
 */
export function WidgetProvider({ engine, children }: WidgetProviderProps) {
	const resolver = useCallback(
		(_entityId: number, widgetType: string): ResolvedWidget | null => {
			const def = engine.getWidget(widgetType);
			if (!def) return null;
			if (isR3FWidget(def)) {
				return { surface: 'webgl', component: def.component };
			}
			return { surface: 'dom', component: def.component };
		},
		[engine],
	);

	return <WidgetResolverProvider value={resolver}>{children}</WidgetResolverProvider>;
}
