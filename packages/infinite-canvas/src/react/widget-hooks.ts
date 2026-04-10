import { useCallback } from 'react';
import { Children, Selected, WidgetBreakpoint, WidgetData } from '../components.js';
import type { EntityId } from '../ecs/types.js';
import type { Breakpoint } from '../resources.js';
import { useLayoutEngine } from './context.js';
import { useComponent, useTag } from './hooks.js';

/**
 * Read widget data for an entity. Re-renders when data changes.
 */
export function useWidgetData(entityId: EntityId): Record<string, any> {
	const comp = useComponent(entityId, WidgetData);
	return comp?.data ?? {};
}

/**
 * Read the current breakpoint for an entity. Re-renders when breakpoint changes.
 */
export function useBreakpoint(entityId: EntityId): Breakpoint {
	const comp = useComponent(entityId, WidgetBreakpoint);
	return comp?.current ?? 'normal';
}

/**
 * Read child entity IDs. Re-renders when children change.
 */
export function useChildren(entityId: EntityId): EntityId[] {
	const comp = useComponent(entityId, Children);
	return comp?.ids ?? [];
}

/** @deprecated Use useChildren instead */
export const useWidgetChildren = useChildren;

/**
 * Check if this entity is selected. Re-renders when selection changes.
 */
export function useIsSelected(entityId: EntityId): boolean {
	return useTag(entityId, Selected);
}

/**
 * Returns a function to update widget data via the engine.
 */
export function useUpdateWidget(entityId: EntityId): (patch: Record<string, any>) => void {
	const engine = useLayoutEngine();
	return useCallback(
		(patch: Record<string, any>) => {
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

/** @deprecated Use useUpdateWidget instead */
export const useUpdateData = useUpdateWidget;
