import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import type { StandardSchemaV1 } from '../schema.js';

/** Rendering surface for a widget. */
export type WidgetSurface = 'dom' | 'webgl';

/**
 * Drop-to-consume interaction handlers for a widget type (RFC-004 § Phase 1).
 *
 * All fields are optional. A widget that sets `accepts` on its `Card`
 * component should typically also supply `onReceiveChild` so it can
 * actually do something on consume; a widget that sets `provides`
 * rarely needs `onDroppedOnParent` unless it wants to veto or run
 * side effects.
 *
 * Handlers live on the widget *type* (not the entity) so `Card` data
 * stays serializable and one handler triple drives every instance of
 * the widget type.
 */
export interface WidgetInteractionHandlers {
	/**
	 * Parent-side: called on drop when a child lands on this widget.
	 * Return `{ consume: true }` to accept the drop; the optional
	 * `mutation` payload is passed to `applyMutation` / `revertMutation`
	 * so undo can be symmetric.
	 */
	onReceiveChild?(ctx: { parent: EntityId; child: EntityId; world: World }): {
		consume: boolean;
		mutation?: unknown;
	};

	/**
	 * Child-side: called on drop when this widget is being dropped
	 * onto a parent. Optional side effects and optional veto.
	 */
	onDroppedOnParent?(ctx: {
		child: EntityId;
		parent: EntityId;
		world: World;
	}): { veto: boolean } | undefined;

	/**
	 * Parent-side runtime gate on top of the static `accepts` /
	 * `provides` intersection — e.g. "container is full, refuse further
	 * children." Returning `false` blocks the consume before
	 * `onReceiveChild` is called.
	 */
	canAccept?(ctx: { parent: EntityId; child: EntityId; world: World }): boolean;

	/**
	 * Apply the mutation returned by `onReceiveChild` (forward path).
	 * Called by `ConsumeCommand.execute`.
	 */
	applyMutation?(world: World, mutation: unknown): void;

	/**
	 * Reverse the mutation (undo path). Called by `ConsumeCommand.undo`.
	 */
	revertMutation?(world: World, mutation: unknown): void;
}

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
	/**
	 * Optional drop-to-consume handlers. Only meaningful for `Card`-tagged
	 * widgets; non-card widgets don't participate in the consume mechanic
	 * so any handlers here are dead code for them.
	 */
	interaction?: WidgetInteractionHandlers;
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
