import { useComponent, useTag, useEngine } from '@infinite-canvas/ui';
import {
	WidgetData,
	WidgetBreakpoint,
	Children,
	Selected,
} from '@infinite-canvas/core';
import type { EntityId, Breakpoint } from '@infinite-canvas/core';
import { useCallback } from 'react';

/**
 * Read widget data for an entity. Re-renders when data changes.
 * Convenience wrapper around useComponent(entityId, WidgetData).
 */
export function useWidgetData(entityId: EntityId): Record<string, any> {
	const comp = useComponent(entityId, WidgetData);
	return comp?.data ?? {};
}

/**
 * Read the current breakpoint for an entity. Re-renders when breakpoint changes.
 * Convenience wrapper around useComponent(entityId, WidgetBreakpoint).
 */
export function useBreakpoint(entityId: EntityId): Breakpoint {
	const comp = useComponent(entityId, WidgetBreakpoint);
	return comp?.current ?? 'normal';
}

/**
 * Read child entity IDs. Re-renders when children change.
 */
export function useWidgetChildren(entityId: EntityId): EntityId[] {
	const comp = useComponent(entityId, Children);
	return comp?.ids ?? [];
}

/**
 * Check if this entity is selected. Re-renders when selection changes.
 */
export function useIsSelected(entityId: EntityId): boolean {
	return useTag(entityId, Selected);
}

/**
 * Returns a function to update widget data via the engine command system.
 */
export function useUpdateData(entityId: EntityId): (patch: Record<string, any>) => void {
	const engine = useEngine();
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
