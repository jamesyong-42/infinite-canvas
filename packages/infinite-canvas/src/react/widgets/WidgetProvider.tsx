import type { ReactNode } from 'react';
import { useCallback } from 'react';
import type { LayoutEngine } from '../../ecs/engine/index.js';
import type { ResolvedWidget } from '../context/widget-resolver-context.js';
import { WidgetResolverProvider } from '../context/widget-resolver-context.js';
import { isR3FWidget } from './registry.js';

interface WidgetProviderProps {
	engine: LayoutEngine;
	children?: ReactNode;
}

/**
 * Bridges the engine's widget registry to React context so WidgetSlot /
 * R3FManager can resolve components by type.
 */
export function WidgetProvider({ engine, children }: WidgetProviderProps) {
	const resolver = useCallback(
		(_entityId: number, widgetType: string): ResolvedWidget | null => {
			const def = engine.getWidget(widgetType);
			if (!def) return null;
			if (isR3FWidget(def)) {
				return { surface: 'webgl', component: def.component, chrome: def.chrome };
			}
			return { surface: 'dom', component: def.component };
		},
		[engine],
	);

	return <WidgetResolverProvider value={resolver}>{children}</WidgetResolverProvider>;
}
