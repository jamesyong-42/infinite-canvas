import type { EntityId } from '@jamesyong42/reactive-ecs';
import { defineComponent, defineTag } from '@jamesyong42/reactive-ecs';

// === Spatial ===

/** Position, size, and rotation of an entity in local coordinates (world units). */
export const Transform2D = defineComponent('Transform2D', {
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	rotation: 0,
});

/** Rendering and hit-test ordering. Higher values render on top. */
export const ZIndex = defineComponent('ZIndex', { value: 0 });

/** Easing curves supported by `transformTweenSystem` (RFC-004 § Phase 2). */
export type TweenEasing = 'linear' | 'ease-out' | 'ease-in-out' | 'spring';

/**
 * Generic animated transition of `Transform2D.x` / `.y` over time.
 * Runtime-only: the tween component is auto-removed on completion,
 * and in-flight tweens are not serialized (the destination Transform2D
 * is what survives a save/load).
 *
 * Introduced for RFC-004 Phase 4 fly-back but designed to be reusable
 * for any future position-animation need (snap, drop-in, consume-pop).
 * Starting a new tween on an entity that already has one overwrites.
 */
export const TransformTween = defineComponent('TransformTween', {
	fromX: 0,
	fromY: 0,
	toX: 0,
	toY: 0,
	/** `performance.now()`-ish timestamp captured at tween start. */
	startMs: 0,
	/** Total duration in ms. */
	durationMs: 250,
	easing: 'ease-out' as TweenEasing,
	/**
	 * Discriminator so downstream systems can react per kind
	 * (e.g. `'flyback'`, `'snap'`, `'spawn'`). The tween system
	 * itself is kind-agnostic.
	 */
	kind: 'generic',
});

// === Hierarchy ===

/**
 * Container-hierarchy parenthood: the entity lives inside another
 * entity's sub-canvas. Read by `navigationFilterSystem` to filter the
 * active widget set by the current navigation frame.
 *
 * Container children have their own `Transform2D` in the container's
 * local coord space — **no coord accumulation** through this reference.
 * Replaces the old `Parent` component's container-hierarchy usage
 * (RFC-005).
 */
export const ParentFrame = defineComponent('ParentFrame', { id: 0 as EntityId });

/** Child entity IDs. Used for nested containers and handle sync. */
export const Children = defineComponent('Children', { ids: [] as EntityId[] });

/**
 * Ordered list of the entities a container owns (RFC-004 § Phase 5).
 * Redundant with `ParentFrame` (the inverse relation) but materialised
 * so UI / compositor paths can cheaply read "give me this container's
 * children" without a reverse-index scan. `applyMutation` /
 * `revertMutation` keep the two in sync. Serialized; IDs are remapped
 * alongside `ParentFrame` on load.
 */
export const ContainerChildren = defineComponent('ContainerChildren', {
	ids: [] as EntityId[],
});

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

// === Card ===

/** iOS-style card size presets. Actual dimensions live in CardPresetsResource. */
export type CardPreset = 'small' | 'medium' | 'large' | 'xl';

/**
 * Marks an entity as an iOS-style card with a fixed preset size, AND
 * opts the entity into the full card-shaped behavior bundle:
 *
 *   - DOM `<CardChrome>` slot (rounded body, hairline ring, shadow,
 *     CSS lift transition on Dragging)
 *   - drag-promote to the 'overlay' layer for DOM cards (so dragged
 *     DOM cards visually pop above the R3F canvas)
 *   - composition discard rect for R3F cards (so other R3F widgets
 *     are clipped out of the dragged card's screen rect — defends
 *     the chrome from being painted over)
 *   - drop-to-consume contracts (`accepts` / `provides`) — RFC-004.
 *
 * Widgets *without* `Card` get none of this — they render bare (no
 * chrome, no lift transition), and on drag they only get the
 * compositor's renderOrder bump if they're R3F (so they stack on
 * top of other R3F widgets they overlap).
 *
 * The `cardSystem` reconciles `Transform2D.width/height` from the
 * preset each tick, so cards cannot be resized freely — change
 * `preset` instead.
 */
export const Card = defineComponent('Card', {
	preset: 'small' as CardPreset,
	/**
	 * CSS background for the chrome's surface (any valid background value;
	 * defaults to the dark iOS card colour). Picked up by the
	 * `<CardChrome>` component rendered for this entity.
	 */
	background: '#1C1C1E',
	/**
	 * Drop-to-consume contract — what this card accepts as a *parent*.
	 * An incoming dragged card's `provides` must intersect this list
	 * for the consume mechanic to fire (RFC-004 § Phase 3). Empty
	 * array = card never consumes anything.
	 */
	accepts: [] as readonly string[],
	/**
	 * Drop-to-consume contract — what this card offers when dropped
	 * as a *child*. Empty array = card is never consumed by anything.
	 */
	provides: [] as readonly string[],
});

/**
 * Transient — set by the card-overlap pass on every card whose AABB
 * intersects the dragged card's AABB during drag. Layer 1 of the
 * two-layer overlap visual state (RFC-004 § Phase 3). Cleared on drag
 * end. Runtime-only — not serialized.
 */
export const OverlapCandidate = defineTag('OverlapCandidate');

/**
 * Transient — set on the single primary candidate (closest centre
 * distance) iff its `accepts` contract intersects the dragged card's
 * `provides` contract AND the optional `canAccept` gate passes.
 * Layer 2 of the two-layer overlap visual state. Cleared on drag end
 * or when match becomes false. Runtime-only — not serialized.
 */
export const OverlapTarget = defineTag('OverlapTarget');

/**
 * Per-candidate "hot point" for the position-dependent radial glow
 * (RFC-004 § Phase 3). `x` and `y` are normalized [0..1] local coords
 * within the overlapped card, pointing at the intersection centroid.
 * `strength` ramps between 0 and 1 for the fade-in / fade-out.
 * Runtime-only — not serialized.
 */
export const CardOverlapHotPoint = defineComponent('CardOverlapHotPoint', {
	x: 0.5,
	y: 0.5,
	strength: 0,
});

// === Container ===

/** Marks an entity as an enterable container (double-click/double-tap to enter). */
export const Container = defineComponent('Container', { enterable: true });

/**
 * Per-container persistent camera state. When the user navigates out of
 * a container, their current pan/zoom is snapshotted here; when they
 * navigate back in, it's restored. Serialized — containers remember
 * their view across save/load (RFC-004 § Phase 0c).
 */
export const ContainerCamera = defineComponent('ContainerCamera', {
	x: 0,
	y: 0,
	zoom: 1,
});

// === Interaction ===

/** Resize handle positions — 4 edges + 4 corners. */
export type ResizeHandlePos = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

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
 * Canonical layers: 0=canvas, 5=widget body, 20=reserved.
 *
 * Resize corner/edge roles are emitted inline by `interaction.ts` from the
 * selected `Resizable` widget's Transform2D; they are NOT stored as
 * per-handle entities (RFC-005).
 */
export const InteractionRole = defineComponent<InteractionRoleData>('InteractionRole', {
	layer: 0,
	role: { type: 'canvas' },
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
/**
 * Marks an entity that, when dragged, runs alignment-snap math against
 * the set of `SnapTarget` entities. Without this tag, dragging proceeds
 * with raw pointer deltas (no snapping). Independent of `SnapTarget`:
 * an entity can be a source without being a target (rare) or a target
 * without being a source (e.g. cards — they participate as references
 * for other widgets but never snap themselves).
 *
 * Multi-select drag: only the first selected entity's bounds drive the
 * snap calculation; followers receive the same correction delta. Tag a
 * follower-only entity with `SnapSource` if you also want it to lead a
 * single-entity drag, but be aware its geometry is ignored when it is
 * being dragged as part of a multi-select group.
 */
export const SnapSource = defineTag('SnapSource');
/**
 * Marks an entity whose bounds are usable as a snap reference when
 * another `SnapSource` entity is being dragged. References are further
 * filtered by `Active`, so only entities in the current navigation
 * frame can pull a drag — a `SnapTarget` inside a closed container
 * does not leak into a root-level drag. Visibility of the resulting
 * guide lines is controlled separately by the engine's
 * `snap.guidesVisible` config — this tag only governs participation
 * in the math.
 */
export const SnapTarget = defineTag('SnapTarget');
/** Prevents an entity from being moved or resized. */
export const Locked = defineTag('Locked');
/** Indicates the entity is currently selected. */
export const Selected = defineTag('Selected');
/**
 * Indicates the entity is currently being dragged by the user.
 * Added after the drag dead-zone is crossed; removed on pointer up/cancel.
 * Renderers read this to apply transient drag affordances (e.g. scale/shadow lift).
 */
export const Dragging = defineTag('Dragging');
/**
 * Entities with this tag get the engine-drawn selection + hover outline frame.
 * Granted automatically to Selectable entities unless explicitly disabled via
 * `Archetype.interactive.selectionFrame: false`. Widgets that render their own
 * selected/hover chrome (e.g. iOS-style cards) opt out.
 */
export const SelectionFrame = defineTag('SelectionFrame');
/** Indicates the entity is currently being interacted with (drag, resize). */
export const Active = defineTag('Active');
/** Indicates the entity is within the visible viewport. Set by the cull system. */
export const Visible = defineTag('Visible');
/**
 * Indicates the entity is `Active` but **outside** the visible viewport
 * (+overscan). The complement of `Visible` for Active entities — the cull
 * system maintains the invariant that every Active entity carries exactly
 * one of `Visible` or `Culled`.
 *
 * Render layers consume this to keep state cached without rendering: DOM
 * widgets may stay mounted-but-hidden for fast re-reveal, and the R3F
 * compositor (RFC-002) holds widget render targets in its Cold pool.
 */
export const Culled = defineTag('Culled');

// === Layer system (RFC-003) ===

/**
 * Named DOM stacking layer a widget renders into. Three layers are
 * rendered out of the box by `<InfiniteCanvas>`:
 *
 *   `'background'` — DOM widgets behind everything user-content.
 *   `'base'`       — default; DOM widgets and R3F card chrome.
 *   `'overlay'`    — DOM widgets and R3F chrome promoted above the R3F
 *                    canvas (e.g. dragged widget, future tooltips).
 *
 * Per-widget `ZIndex` continues to control intra-layer ordering;
 * `Layer.name` picks which layer container the widget mounts into.
 *
 * R3F widgets always render through the R3F canvas regardless of layer
 * — `Layer.name` only controls where their CSS chrome / interaction
 * surface mounts.
 */
export type LayerName = 'background' | 'base' | 'overlay';

export type LayerData = {
	name: LayerName;
};

export const Layer = defineComponent<LayerData>('Layer', { name: 'base' });

/**
 * Sidecar component on a widget that has been promoted to a higher
 * layer by `dragPromoteSystem`; stores the widget's pre-drag
 * `Layer.name` so it can be restored when `Dragging` is removed.
 *
 * Internal — not part of the public API. Serialization-skipped because
 * it only carries transient interaction state.
 */
export type PreDragLayerData = {
	name: LayerName;
};

export const PreDragLayer = defineComponent<PreDragLayerData>('PreDragLayer', {
	name: 'base',
});
