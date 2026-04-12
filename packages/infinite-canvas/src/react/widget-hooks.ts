import { useCallback } from 'react';
import { Children, Selected, WidgetBreakpoint, WidgetData } from '../components.js';
import type { EntityId } from '../ecs/types.js';
import type { Breakpoint } from '../resources.js';
import { useLayoutEngine } from './context.js';
import { useComponent, useTag } from './hooks.js';

/**
 * Returns the custom data attached to a widget entity.
 * Use the generic parameter for type safety: `useWidgetData<MyData>(entityId)`. Re-renders when data changes.
 */
export function useWidgetData<T = Record<string, unknown>>(entityId: EntityId): T {
	const comp = useComponent(entityId, WidgetData);
	return (comp?.data ?? {}) as T;
}

/**
 * Returns the current responsive breakpoint for a widget based on its screen-space size.
 * Re-renders when the breakpoint changes.
 */
export function useBreakpoint(entityId: EntityId): Breakpoint {
	const comp = useComponent(entityId, WidgetBreakpoint);
	return comp?.current ?? 'normal';
}

/**
 * Returns child entity IDs of a container entity.
 * Re-renders when children are added or removed.
 */
export function useChildren(entityId: EntityId): EntityId[] {
	const comp = useComponent(entityId, Children);
	return comp?.ids ?? [];
}

/**
 * Returns whether the entity is currently selected.
 * Re-renders when the entity's selection state changes.
 */
export function useIsSelected(entityId: EntityId): boolean {
	return useTag(entityId, Selected);
}

/**
 * Returns a function to update the widget's custom data.
 * Merges the patch into existing data via shallow spread.
 */
export function useUpdateWidget(entityId: EntityId): (patch: Record<string, unknown>) => void {
	const engine = useLayoutEngine();
	return useCallback(
		(patch: Record<string, unknown>) => {
			const existing = engine.get(entityId, WidgetData);
			if (existing) {
				engine.set(entityId, WidgetData, {
					data: { ...existing.data, ...patch },
				});
			}
		},
		[engine, entityId],
	);
}
