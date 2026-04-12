import { defineComponent, defineTag } from './ecs/index.js';
import type { EntityId } from './ecs/index.js';

// === Spatial ===

/** Position, size, and rotation of an entity in local coordinates (world units). */
export const Transform2D = defineComponent('Transform2D', {
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	rotation: 0,
});

/** Computed world-space bounding box. Read-only -- updated by the transform propagation system. */
export const WorldBounds = defineComponent('WorldBounds', {
	worldX: 0,
	worldY: 0,
	worldWidth: 0,
	worldHeight: 0,
});

/** Rendering and hit-test ordering. Higher values render on top. */
export const ZIndex = defineComponent('ZIndex', { value: 0 });

// === Hierarchy ===

/** Parent entity reference. Used for nested containers and handle sync. */
export const Parent = defineComponent('Parent', { id: 0 as EntityId });

/** Child entity IDs. Used for nested containers and handle sync. */
export const Children = defineComponent('Children', { ids: [] as EntityId[] });

// === Widget ===

/** Marks an entity as a renderable widget with a type identifier and rendering surface. */
export const Widget = defineComponent('Widget', {
	surface: 'dom' as 'dom' | 'webgl' | 'webview',
	type: '' as string,
});

/** Arbitrary application data attached to a widget entity. Access via useWidgetData(). */
export const WidgetData = defineComponent('WidgetData', {
	data: {} as Record<string, unknown>,
});

/** Computed responsive breakpoint based on screen-space size. Read-only. */
export const WidgetBreakpoint = defineComponent('WidgetBreakpoint', {
	current: 'normal' as 'micro' | 'compact' | 'normal' | 'expanded' | 'detailed',
	screenWidth: 0,
	screenHeight: 0,
});

// === Container ===

/** Marks an entity as an enterable container (double-click/double-tap to enter). */
export const Container = defineComponent('Container', { enterable: true });

// === Interaction ===

/** Resize handle positions — 4 edges + 4 corners. */
export type ResizeHandlePos = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Rectangular interactable region anchored relative to the parent entity's WorldBounds.
 * Anchor values are in 0..1 space: 0 = parent min edge, 1 = parent max edge.
 * Widget bodies do NOT need Hitbox — their WorldBounds is already their hit area.
 * Hitbox is only for sub-entities (handles, ports) whose position is parent-relative.
 */
export const Hitbox = defineComponent('Hitbox', {
	anchorX: 0,
	anchorY: 0,
	width: 0,
	height: 0,
});

/** Discriminated union of interaction roles an entity can fulfil. */
export type InteractionRoleType =
	| { type: 'drag' }
	| { type: 'select' }
	| { type: 'resize'; handle: ResizeHandlePos }
	| { type: 'rotate' }
	| { type: 'connect' }
	| { type: 'canvas' };

export type InteractionRoleData = {
	/** Hit-test priority — higher wins when multiple entities contain the point. */
	layer: number;
	/** Discriminated role + role-specific data. */
	role: InteractionRoleType;
};

/**
 * Declares what happens when this entity is hit, plus its hit-test priority.
 * Canonical layers: 0=canvas, 5=widget body, 10=edge handles, 15=corner handles, 20=reserved.
 */
export const InteractionRole = defineComponent<InteractionRoleData>('InteractionRole', {
	layer: 0,
	role: { type: 'canvas' },
});

/** Data shape for the HandleSet component. */
export type HandleSetData = {
	ids: EntityId[];
};

/**
 * Component on the parent entity listing the EntityIds of its spawned handle children.
 * Enables O(1) cascade destroy without a reverse-index scan of Parent components.
 */
export const HandleSet = defineComponent<HandleSetData>('HandleSet', {
	ids: [] as EntityId[],
});

/** CSS cursor values the canvas may request. */
export type CSSCursor =
	| 'default'
	| 'grab'
	| 'grabbing'
	| 'crosshair'
	| 'n-resize'
	| 's-resize'
	| 'e-resize'
	| 'w-resize'
	| 'ne-resize'
	| 'nw-resize'
	| 'se-resize'
	| 'sw-resize';

export type CursorHintData = {
	/** Cursor when this entity is hovered in idle state. */
	hover: CSSCursor;
	/** Cursor while this entity is being dragged/resized. */
	active: CSSCursor;
};

/** Declares the cursor this entity requests when hovered and when active. */
export const CursorHint = defineComponent<CursorHintData>('CursorHint', {
	hover: 'default',
	active: 'default',
});

// === Tags ===

/** Marks an entity as selectable by click or marquee. */
export const Selectable = defineTag('Selectable');
/** Marks an entity as draggable via pointer interaction. */
export const Draggable = defineTag('Draggable');
/** Marks an entity as resizable via edge/corner handles. */
export const Resizable = defineTag('Resizable');
/** Prevents an entity from being moved or resized. */
export const Locked = defineTag('Locked');
/** Indicates the entity is currently selected. */
export const Selected = defineTag('Selected');
/** Indicates the entity is currently being interacted with (drag, resize). */
export const Active = defineTag('Active');
/** Indicates the entity is within the visible viewport. Set by the cull system. */
export const Visible = defineTag('Visible');
