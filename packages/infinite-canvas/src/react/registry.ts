import type { EntityId } from '@jamesyong42/reactive-ecs';

export type WidgetSurface = 'dom' | 'webgl';

export interface WidgetProps {
	entityId: EntityId;
	width?: number;
	height?: number;
	zoom?: number;
}

export interface WidgetDef {
	type: string;
	/** Rendering surface — 'dom' (default) or 'webgl' (R3F). */
	surface?: WidgetSurface;
	component: React.ComponentType<WidgetProps>;
	defaultSize?: { width: number; height: number };
	minSize?: { width: number; height: number };
}

export interface WidgetRegistry {
	register(def: WidgetDef): void;
	get(type: string): WidgetDef | null;
	getAll(): WidgetDef[];
}

export function createWidgetRegistry(defs: WidgetDef[] = []): WidgetRegistry {
	const map = new Map<string, WidgetDef>();

	for (const def of defs) {
		map.set(def.type, def);
	}

	return {
		register(def: WidgetDef) {
			map.set(def.type, def);
		},
		get(type: string) {
			return map.get(type) ?? null;
		},
		getAll() {
			return [...map.values()];
		},
	};
}
