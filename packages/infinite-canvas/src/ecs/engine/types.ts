import type {
	ComponentInit,
	ComponentType,
	EntityId,
	SystemDef,
	TagType,
	Unsubscribe,
	World,
} from '@jamesyong42/reactive-ecs';
import type { Profiler } from '../../profiler/Profiler.js';
// Type-only import from react/ — this is the DEFAULT widget shape for the
// public LayoutEngine type so existing user code `LayoutEngine` stays
// assignable to an engine that holds React widgets. There is zero runtime
// coupling: bundlers erase `import type`, and the engine itself only ever
// touches `WidgetBinding`-level fields. Users who want a different widget
// shape can parameterise: `createLayoutEngine<MyBinding>({...})`.
import type { Widget } from '../../react/widgets/registry.js';
import type { Archetype, SpawnOptions } from '../archetype.js';
import type { Command } from '../commands.js';
import type { CardPreset, ResizeHandlePos } from '../components.js';
import type { Breakpoint } from '../resources.js';
import type { StandardSchemaV1 } from '../schema.js';
import type { SpatialIndex } from '../spatial/SpatialIndex.js';
import type { EqualSpacingIndicator, SnapGuide } from '../spatial/snap.js';
import type { WidgetBinding } from './widget-binding.js';

export type { ResizeHandlePos } from '../components.js';

/** Directive returned by pointer handlers indicating how the canvas should handle capture. */
export type PointerDirective =
	| { action: 'passthrough' }
	| { action: 'passthrough-track-drag' }
	| { action: 'capture-drag' }
	| { action: 'capture-resize'; handle: ResizeHandlePos }
	| { action: 'capture-marquee' };

/** Keyboard modifier state captured alongside pointer events. */
export interface Modifiers {
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
}

/**
 * A visible entity with its computed frame-local bounds and display metadata.
 *
 * Bounds are copied from the entity's `Transform2D` — post-RFC-004 Phase 0b,
 * every entity's Transform2D is already in its frame's local coord system,
 * so there is no distinct "world" space to translate into.
 */
export interface VisibleEntity {
	entityId: EntityId;
	x: number;
	y: number;
	width: number;
	height: number;
	breakpoint: Breakpoint;
	zIndex: number;
	surface: string;
	widgetType: string;
}

/** Per-frame change flags indicating what changed during the last tick. */
export interface FrameChanges {
	positionsChanged: EntityId[];
	breakpointsChanged: EntityId[];
	/**
	 * Entities whose `ZIndex` component value changed during the last
	 * tick. Consumed by `<InfiniteCanvas>` to write `el.style.zIndex` on
	 * each slot so R3F cards (which intentionally skip the `Layer`
	 * re-bucket path during drag) still stack correctly when their
	 * `ZIndex` is bumped — without this, a dragged R3F card's CSS chrome
	 * retains its drag-start DOM order and hides beneath sibling
	 * chromes whose intrinsic ZIndex was lower.
	 */
	zIndicesChanged: EntityId[];
	entered: EntityId[];
	exited: EntityId[];
	cameraChanged: boolean;
	navigationChanged: boolean;
	selectionChanged: boolean;
	/**
	 * True when at least one entity's `Layer` component value changed
	 * during the last tick. Render layers consume this to re-bucket
	 * widget slots into their target layer container — see RFC-003 §
	 * dragPromoteSystem and `<InfiniteCanvas>`'s bucket memo.
	 */
	layersChanged: boolean;
}

/** Configuration options for `createLayoutEngine()`. */
export interface LayoutEngineConfig<W extends WidgetBinding = Widget> {
	/** Maximum entity count (default: 10000). */
	maxEntities?: number;
	/** Minimum and maximum zoom levels. */
	zoom?: { min: number; max: number };
	/** Screen-space pixel thresholds for responsive breakpoints. */
	breakpoints?: { micro: number; compact: number; normal: number; expanded: number };
	/** Snap alignment configuration. */
	snap?: {
		/** Run alignment-snap math during drag. Default true. */
		enabled?: boolean;
		/** Threshold in world pixels. Default 5. Zoom-corrected at use site. */
		threshold?: number;
		/**
		 * Render the magenta guide lines and equal-spacing indicators while
		 * snap math is active. Default true. Independent of `enabled` —
		 * you can run snap math without showing chrome (e.g. screenshot
		 * mode) or vice versa for demos.
		 */
		guidesVisible?: boolean;
	};
	/** Widget definitions available to `spawn()`. */
	widgets?: W[];
	/** Archetype definitions available to `spawn()`. */
	archetypes?: Archetype[];
	/**
	 * Override the default iOS-style card preset sizes (small/medium/large/xl).
	 * Partial — unspecified presets keep their built-in defaults.
	 */
	cardPresets?: {
		presets?: Partial<Record<CardPreset, { width: number; height: number }>>;
		gap?: number;
	};
}

/**
 * The core layout engine. Manages the ECS world, camera, input, undo/redo,
 * spatial indexing, and frame lifecycle for an infinite canvas.
 */
export interface LayoutEngine<W extends WidgetBinding = Widget> {
	/** The underlying ECS world. Use for direct component/tag/resource access. */
	readonly world: World;

	// Entity CRUD

	createEntity(inits?: ComponentInit[]): EntityId;
	spawn(id: string, opts?: SpawnOptions): EntityId;
	spawnAtCameraCenter(id: string, opts?: Omit<SpawnOptions, 'at'>): EntityId;
	destroyEntity(id: EntityId): void;

	// Widget / Archetype registries

	registerWidget(widget: W): void;
	getWidget(type: string): W | null;
	getWidgets(): W[];
	registerArchetype(archetype: Archetype): void;
	getArchetype(id: string): Archetype | null;

	// Shorthand

	get<T>(entity: EntityId, type: ComponentType<T>): T | undefined;
	set<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>): void;
	has(entity: EntityId, type: ComponentType | TagType): boolean;
	addComponent<T>(entity: EntityId, type: ComponentType<T>, data?: T): void;
	removeComponent(entity: EntityId, type: ComponentType): void;
	addTag(entity: EntityId, type: TagType): void;
	removeTag(entity: EntityId, type: TagType): void;
	getSchemaFor(entity: EntityId): StandardSchemaV1 | undefined;

	// Extensions

	registerSystem(system: SystemDef): void;
	removeSystem(name: string): void;

	// Camera

	getCamera(): { x: number; y: number; zoom: number; gesturing: boolean };
	panBy(dx: number, dy: number): void;
	panTo(worldX: number, worldY: number): void;
	zoomAtPoint(screenX: number, screenY: number, delta: number): void;
	zoomTo(zoom: number): void;
	zoomToFit(entityIds?: EntityId[], padding?: number): void;
	/** Mark the camera as actively manipulated (continuous wheel / pinch / pan). */
	setGesturing(active: boolean): void;

	// Viewport

	setViewport(width: number, height: number, dpr?: number): void;

	// Pointer input

	/**
	 * @deprecated RFC-008 Phase 3d retired the canvas's runtime use of these
	 * methods — `InputManager` now drives the engine via `beginDrag` /
	 * `beginResize` / `beginMarquee` etc. Kept as a backwards-compat shim
	 * for tests and external integrations that still drive the state
	 * machine via screen coordinates. Will be removed in a future release.
	 */
	handlePointerDown(
		screenX: number,
		screenY: number,
		button: number,
		modifiers: Modifiers,
	): PointerDirective;
	/** @deprecated See {@link LayoutEngine.handlePointerDown}. */
	handlePointerMove(screenX: number, screenY: number, modifiers: Modifiers): PointerDirective;
	/** @deprecated See {@link LayoutEngine.handlePointerDown}. */
	handlePointerUp(): PointerDirective;
	/** @deprecated See {@link LayoutEngine.handlePointerDown}. */
	handlePointerCancel(): void;
	/**
	 * Topmost interactable entity at a screen-space point. Same hit-test
	 * the pointer state machine uses, exposed for callers that need to
	 * resolve coords without firing pointer side-effects — RFC-006's
	 * `PointerEventBus` (double-click) and the R3F `EventRouter`.
	 */
	pickAt(screenX: number, screenY: number): EntityId | null;

	// RFC-008 Phase 3b — Engine entry points for the InputManager pipeline.
	// World-coord variants of the legacy handlePointer* state transitions.
	// `entity` arguments document intent; the engine drags/resizes whatever
	// is currently `Selected` (drag) or the named entity (resize).

	beginDrag(entity: EntityId, worldX: number, worldY: number): void;
	updateDrag(entity: EntityId, worldX: number, worldY: number): void;
	endDrag(entity: EntityId, opts: { cancelled: boolean }): void;
	getDraggingEntity(): EntityId | null;
	/**
	 * Cancel whatever interaction is in progress — drag, resize, marquee,
	 * tracking, or fly-back. Used by the InputManager pipeline's `cancel`
	 * engine handler so a native `pointercancel` (system dialog, palm
	 * rejection, etc.) leaves no orphaned state behind.
	 */
	cancelInteraction(): void;

	beginResize(entity: EntityId, handle: ResizeHandlePos, worldX: number, worldY: number): boolean;
	updateResize(entity: EntityId, worldX: number, worldY: number): void;
	endResize(entity: EntityId, opts: { cancelled: boolean }): void;

	beginMarquee(worldX: number, worldY: number): void;
	updateMarquee(worldX: number, worldY: number): void;
	endMarquee(): void;
	isMarqueeActive(): boolean;

	// Selection & Hover

	getSelectedEntities(): EntityId[];
	/**
	 * Add `entity` to the selection. `additive=false` clears every other
	 * `Selected` first; `additive=true` toggles `entity` and leaves the
	 * rest untouched. Mirrors the legacy click-to-select semantics that
	 * Phase 3d's `tap` and `drag-start` engine handlers will drive.
	 */
	selectEntity(entity: EntityId, additive: boolean): void;
	clearSelection(): void;
	getHoveredEntity(): EntityId | null;
	setHoveredEntity(entity: EntityId | null): void;

	// Navigation

	enterContainer(entity: EntityId): void;
	exitContainer(): void;
	getActiveContainer(): EntityId | null;
	getNavigationDepth(): number;

	// Commands + Undo/Redo

	execute(command: Command): void;
	beginCommandGroup(): void;
	endCommandGroup(): void;
	undo(): boolean;
	redo(): boolean;
	canUndo(): boolean;
	canRedo(): boolean;

	// Frame

	markDirty(): void;
	tick(): void;
	flushIfDirty(): boolean;

	// Output

	getVisibleEntities(): VisibleEntity[];
	getFrameChanges(): FrameChanges;

	// Spatial index

	getSpatialIndex(): SpatialIndex;

	// Snap guides

	getSnapGuides(): SnapGuide[];
	getEqualSpacing(): EqualSpacingIndicator[];
	setSnapEnabled(on: boolean): void;
	setSnapThreshold(worldPx: number): void;
	getSnapGuidesVisible(): boolean;
	setSnapGuidesVisible(on: boolean): void;

	// Performance profiling

	readonly profiler: Profiler;

	// Events

	onFrame(handler: () => void): Unsubscribe;

	// Lifecycle

	destroy(): void;
}
