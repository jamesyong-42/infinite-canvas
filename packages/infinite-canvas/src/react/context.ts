import { createContext, useContext } from 'react';
import type { EntityId } from '../ecs/types.js';
import type { LayoutEngine } from '../engine.js';

// === Engine Context ===

const EngineContext = createContext<LayoutEngine | null>(null);

export const EngineProvider = EngineContext.Provider;

// === Container Ref Context ===
// Shared so WidgetSlot can compute container-relative pointer coordinates.

const ContainerRefContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export const ContainerRefProvider = ContainerRefContext.Provider;

export function useContainerRef(): React.RefObject<HTMLDivElement | null> | null {
	return useContext(ContainerRefContext);
}

export function useLayoutEngine(): LayoutEngine {
	const engine = useContext(EngineContext);
	if (!engine) {
		throw new Error('useLayoutEngine must be used within an <InfiniteCanvas>');
	}
	return engine;
}

/** @deprecated Use useLayoutEngine instead */
export const useEngine = useLayoutEngine;

// === Widget Resolver Context ===

export type WidgetSurface = 'dom' | 'webgl';

export interface ResolvedWidget {
	component: React.ComponentType<{ entityId: EntityId }>;
	surface: WidgetSurface;
}

export type WidgetResolver = (entityId: EntityId, widgetType: string) => ResolvedWidget | null;

const WidgetResolverContext = createContext<WidgetResolver | null>(null);

export const WidgetResolverProvider = WidgetResolverContext.Provider;

export function useWidgetResolver(): WidgetResolver | null {
	return useContext(WidgetResolverContext);
}
