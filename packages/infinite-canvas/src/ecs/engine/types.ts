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

/** A visible entity with its computed world-space bounds and display metadata. */
export interface VisibleEntity {
	entityId: EntityId;
	worldX: number;
	worldY: number;
	worldWidth: number;
	worldHeight: number;
	breakpoint: Breakpoint;
	zIndex: number;
	surface: string;
	widgetType: string;
}

/** Per-frame change flags indicating what changed during the last tick. */
export interface FrameChanges {
	positionsChanged: EntityId[];
	breakpointsChanged: EntityId[];
	entered: EntityId[];
	exited: EntityId[];
	cameraChanged: boolean;
	navigationChanged: boolean;
	selectionChanged: boolean;
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
		enabled?: boolean;
		threshold?: number;
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

	handlePointerDown(
		screenX: number,
		screenY: number,
		button: number,
		modifiers: Modifiers,
	): PointerDirective;
	handlePointerMove(screenX: number, screenY: number, modifiers: Modifiers): PointerDirective;
	handlePointerUp(): PointerDirective;
	handlePointerCancel(): void;

	// Selection & Hover

	getSelectedEntities(): EntityId[];
	getHoveredEntity(): EntityId | null;

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

	// Performance profiling

	readonly profiler: Profiler;

	// Events

	onFrame(handler: () => void): Unsubscribe;

	// Lifecycle

	destroy(): void;
}
