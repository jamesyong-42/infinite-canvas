import type { EntityId } from '@jamesyong42/reactive-ecs';
import { createContext, useContext } from 'react';
import type { DomWidgetProps, R3FWidgetProps } from '../widgets/registry.js';

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
