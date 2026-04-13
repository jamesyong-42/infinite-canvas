import type { EntityId } from '@jamesyong42/reactive-ecs';
import type { StandardSchemaV1 } from '../schema.js';

/** Rendering surface for a widget. */
export type WidgetSurface = 'dom' | 'webgl';

// === Widget Prop Contracts ===

/** Props passed to every DOM widget component. */
export interface DomWidgetProps {
	entityId: EntityId;
}

/** Props passed to every R3F widget component. Rendered in local coords. */
export interface R3FWidgetProps {
	entityId: EntityId;
	/** Widget width in world units. */
	width: number;
	/** Widget height in world units. */
	height: number;
}

// === Widget Definitions ===

interface WidgetBase<T> {
	/** Unique widget type id. Matches `Widget { type }` on spawned entities. */
	type: string;
	/**
	 * Standard Schema v1-compatible schema for the widget's data.
	 * Use Zod 3.24+, Valibot, ArkType, or any other conforming validator.
	 * The schema's output type drives the widget's data type.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: schema Input is intentionally permissive
	schema: StandardSchemaV1<any, T>;
	/** Default data shape for new instances. Merged with user-supplied data at spawn. */
	defaultData: T;
	/** Default world-space size at spawn. */
	defaultSize: { width: number; height: number };
	/** Minimum world-space size when resizing. */
	minSize?: { width: number; height: number };
}

/** A DOM-rendered widget. The component is wrapped in a sized div — size via CSS. */
export interface DomWidget<T = Record<string, unknown>> extends WidgetBase<T> {
	surface?: 'dom';
	component: React.ComponentType<DomWidgetProps>;
}

/** An R3F (React Three Fiber) widget. The component receives local-space width/height. */
export interface R3FWidget<T = Record<string, unknown>> extends WidgetBase<T> {
	surface: 'webgl';
	component: React.ComponentType<R3FWidgetProps>;
}

/** Either kind of widget. */
export type Widget<T = Record<string, unknown>> = DomWidget<T> | R3FWidget<T>;

// === Registry ===

export interface WidgetRegistry {
	register(def: Widget): void;
	get(type: string): Widget | null;
	getAll(): Widget[];
}

export function createWidgetRegistry(defs: Widget[] = []): WidgetRegistry {
	const map = new Map<string, Widget>();
	for (const def of defs) map.set(def.type, def);
	return {
		register(def) {
			map.set(def.type, def);
		},
		get(type) {
			return map.get(type) ?? null;
		},
		getAll() {
			return [...map.values()];
		},
	};
}

/** Narrows to the R3F variant. */
export function isR3FWidget<T>(widget: Widget<T>): widget is R3FWidget<T> {
	return widget.surface === 'webgl';
}
