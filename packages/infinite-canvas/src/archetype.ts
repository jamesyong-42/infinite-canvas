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
	 * Whether the entity is user-interactive (Selectable + Draggable + Resizable).
	 * Default: true. Set `false` for backdrops, decorations, or locked entities.
	 */
	interactive?: boolean;
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
	/** Parent entity for hierarchy nesting. */
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
