import type { ComponentInit, EntityId, TagType } from '@jamesyong42/reactive-ecs';

/**
 * An archetype is a recipe for creating an entity: it declares which components
 * and tags the entity should have on spawn. Archetypes may reference a widget
 * type (for visible entities) or stand alone (for logic-only entities).
 *
 * The engine auto-generates a default archetype for every registered widget
 * that does not have an explicit one — so simple widgets don't need to ship
 * an archetype at all. Write an archetype only when you need to bundle extra
 * behaviour (Container, Locked, custom components) with a widget.
 */
export interface Archetype {
	/** Unique archetype id. Pass this to `engine.spawn(id, ...)`. */
	id: string;
	/**
	 * The widget type this archetype renders as. Required for visible entities;
	 * omit for logic-only entities that have no view.
	 */
	widget?: string;
	/** Extra components added on spawn, beyond Transform2D / Widget / WidgetData / ZIndex. */
	components?: ComponentInit[];
	/** Extra tags added on spawn, beyond the interactive defaults. */
	tags?: TagType[];
	/**
	 * Which interaction capabilities to grant on spawn.
	 *
	 * - `true` (default) / `undefined`: add Selectable, Draggable, Resizable,
	 *   SelectionFrame, SnapSource, and SnapTarget — the full bundle.
	 * - `false`: add none (backdrops, decorations, locked entities).
	 * - object form: pick and choose — e.g. iOS-style cards use
	 *   `{ selectable: true, draggable: true, resizable: false,
	 *      selectionFrame: false, snapSource: false, snapTarget: true }`
	 *   so they can be moved and selected but never resized, render their
	 *   own chrome instead of the engine-drawn frame, don't snap to
	 *   neighbours when dragged, but do serve as references that other
	 *   widgets snap to.
	 *
	 * Omitted interaction keys default to `false`. `selectionFrame` is an
	 * exception: if omitted, it follows `selectable` (an entity you can
	 * select gets a frame unless you explicitly opt out).
	 *
	 * NOTE for upgraders from earlier versions: `interactive: true` now
	 * additionally grants `SnapSource` and `SnapTarget`, so widgets using
	 * the default bundle will start participating in alignment-snap math
	 * during drag. If you previously relied on snap being a no-op for
	 * these widgets, switch to the object form and set both to `false`.
	 */
	interactive?:
		| boolean
		| {
				selectable?: boolean;
				draggable?: boolean;
				resizable?: boolean;
				selectionFrame?: boolean;
				/** Dragging this entity invokes alignment-snap math. Default false in the object form. */
				snapSource?: boolean;
				/** Bounds participate as references for other entities' snap math. Default false in the object form. */
				snapTarget?: boolean;
		  };
	/** Overrides the widget's defaultSize. */
	defaultSize?: { width: number; height: number };
}

/**
 * Options for `engine.spawn(archetypeId, opts)`.
 * All fields are optional — defaults come from the archetype + widget.
 */
export interface SpawnOptions {
	/** World-space position. Defaults to { x: 0, y: 0 }. */
	at?: { x: number; y: number };
	/** World-space size. Falls back to archetype.defaultSize → widget.defaultSize. */
	size?: { width: number; height: number };
	/** Initial rotation in radians. Default 0. */
	rotation?: number;
	/** Data patch merged into the widget's defaultData. */
	data?: Record<string, unknown>;
	/** Z-order. Default 0. */
	zIndex?: number;
	/** Parent container entity — writes `ParentFrame` on spawn so the child
	 *  lives in the container's sub-canvas frame. */
	parent?: EntityId;
}

/** Simple in-memory archetype registry. */
export interface ArchetypeRegistry {
	register(archetype: Archetype): void;
	get(id: string): Archetype | null;
	getAll(): Archetype[];
}

export function createArchetypeRegistry(archetypes: Archetype[] = []): ArchetypeRegistry {
	const map = new Map<string, Archetype>();
	for (const a of archetypes) map.set(a.id, a);
	return {
		register(a) {
			map.set(a.id, a);
		},
		get(id) {
			return map.get(id) ?? null;
		},
		getAll() {
			return [...map.values()];
		},
	};
}
