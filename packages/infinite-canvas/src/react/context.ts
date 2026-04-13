import type { EntityId } from '@jamesyong42/reactive-ecs';
import { createContext, useContext } from 'react';
import type { LayoutEngine } from '../engine.js';
import type { DomWidgetProps, R3FWidgetProps, WidgetSurface } from './registry.js';

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

/**
 * Returns the LayoutEngine instance from the nearest InfiniteCanvas context.
 * Throws if used outside an InfiniteCanvas provider.
 */
export function useLayoutEngine(): LayoutEngine {
	const engine = useContext(EngineContext);
	if (!engine) {
		throw new Error('useLayoutEngine must be used within an <InfiniteCanvas>');
	}
	return engine;
}

// === Widget Resolver Context ===

export type { WidgetSurface };

/**
 * Discriminated resolution of a widget by type. The surface determines which
 * layer renders the component and with what prop shape.
 */
export type ResolvedWidget =
	| { surface: 'dom'; component: React.ComponentType<DomWidgetProps> }
	| { surface: 'webgl'; component: React.ComponentType<R3FWidgetProps> };

export type WidgetResolver = (entityId: EntityId, widgetType: string) => ResolvedWidget | null;

const WidgetResolverContext = createContext<WidgetResolver | null>(null);

export const WidgetResolverProvider = WidgetResolverContext.Provider;

export function useWidgetResolver(): WidgetResolver | null {
	return useContext(WidgetResolverContext);
}
