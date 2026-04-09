import { createContext, useContext } from 'react';
import type { CanvasEngine } from '@infinite-canvas/core';
import type { EntityId } from '@infinite-canvas/core';

// === Engine Context ===

const EngineContext = createContext<CanvasEngine | null>(null);

export const EngineProvider = EngineContext.Provider;

export function useEngine(): CanvasEngine {
	const engine = useContext(EngineContext);
	if (!engine) {
		throw new Error('useEngine must be used within an <InfiniteCanvas>');
	}
	return engine;
}

// === Widget Resolver Context ===
// Provided by @infinite-canvas/react-widgets (or custom user code).
// The react package defines the context; the widgets package fills it.

export type WidgetResolver = (
	entityId: EntityId,
	widgetType: string,
) => React.ComponentType<{ entityId: EntityId }> | null;

const WidgetResolverContext = createContext<WidgetResolver | null>(null);

export const WidgetResolverProvider = WidgetResolverContext.Provider;

export function useWidgetResolver(): WidgetResolver | null {
	return useContext(WidgetResolverContext);
}
