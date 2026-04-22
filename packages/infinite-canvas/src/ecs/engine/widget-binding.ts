import type { StandardSchemaV1 } from '../schema.js';

/** Rendering surface for a widget. */
export type WidgetSurface = 'dom' | 'webgl';

/**
 * Framework-free widget contract used by the engine.
 *
 * The React layer (see `react/widgets/registry.ts`) extends this with a
 * `component` field to carry the rendered React component. The engine never
 * reads that field — it only needs the metadata here — which keeps the
 * `ecs/` layer free of React imports.
 */
export interface WidgetBinding<T = Record<string, unknown>> {
	/** Unique widget type id. Matches `Widget { type }` on spawned entities. */
	type: string;
	/** Rendering surface; defaults to `'dom'`. */
	surface?: WidgetSurface;
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

/** Simple in-memory registry of widget bindings. */
export interface WidgetRegistry<W extends WidgetBinding = WidgetBinding> {
	register(def: W): void;
	get(type: string): W | null;
	getAll(): W[];
}

export function createWidgetRegistry<W extends WidgetBinding = WidgetBinding>(
	defs: W[] = [],
): WidgetRegistry<W> {
	const map = new Map<string, W>();
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
