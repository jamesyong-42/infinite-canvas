import type { Command } from './commands.js';
import { CommandBuffer, MoveCommand, ResizeCommand } from './commands.js';
import type {
	CSSCursor,
	InteractionRoleData,
	InteractionRoleType,
	ResizeHandlePos,
} from './components.js';
import {
	Active,
	Children,
	Container,
	CursorHint,
	Draggable,
	HandleSet,
	Hitbox,
	InteractionRole,
	Parent,
	Resizable,
	Selectable,
	Selected,
	Transform2D,
	Visible,
	Widget,
	WidgetBreakpoint,
	WidgetData,
	WorldBounds,
	ZIndex,
} from './components.js';
import type {
	ComponentInit,
	ComponentType,
	EntityId,
	SystemDef,
	TagType,
	Unsubscribe,
	World,
} from './ecs/index.js';
import { createWorld, defineResource, SystemScheduler } from './ecs/index.js';
import { DEAD_ZONE_MOUSE_PX, MIN_WIDGET_SIZE } from './interaction-constants.js';
import { clamp, screenToWorld, worldBoundsToAABB } from './math.js';
import { Profiler } from './profiler.js';
import type { Breakpoint } from './resources.js';
import {
	BreakpointConfigResource,
	CameraResource,
	CursorResource,
	NavigationStackResource,
	ViewportResource,
	ZoomConfigResource,
} from './resources.js';
import type { EqualSpacingIndicator, SnapGuide, SnapResult } from './snap.js';
import { computeSnapGuides } from './snap.js';
import { SpatialIndex } from './spatial.js';
import {
	breakpointSystem,
	cullSystem,
	handleSyncSystem,
	hitboxWorldBoundsSystem,
	navigationFilterSystem,
	sortSystem,
	transformPropagateSystem,
} from './systems.js';

/** ECS resource holding the SpatialIndex instance for viewport culling and hit testing. */
export const SpatialIndexResource = defineResource('SpatialIndex', {
	instance: null as SpatialIndex | null,
});

// === Pointer Directives ===

/** Directive returned by pointer handlers indicating how the canvas should handle capture. */
export type PointerDirective =
	| { action: 'passthrough' }
	| { action: 'passthrough-track-drag' }
	| { action: 'capture-drag' }
	| { action: 'capture-resize'; handle: ResizeHandlePos }
	| { action: 'capture-marquee' };

export type { ResizeHandlePos } from './components.js';

/** Keyboard modifier state captured alongside pointer events. */
export interface Modifiers {
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
}

// === Input state machine ===

type InputState =
	| { mode: 'idle' }
	| { mode: 'tracking'; entityId: EntityId; startX: number; startY: number }
	| {
			mode: 'dragging';
			entityId: EntityId;
			startScreenX: number;
			startScreenY: number;
			startPositions: Map<EntityId, { x: number; y: number }>;
			originalZIndices: Map<EntityId, number>;
	  }
	| {
			mode: 'resizing';
			entityId: EntityId;
			/**
			 * The child handle entity that was hit (not the parent widget).
			 * Phase 7's cursorSystem reads CursorHint from this id.
			 */
			handleEntityId: EntityId;
			handle: ResizeHandlePos;
			startX: number;
			startY: number;
			startBounds: { x: number; y: number; width: number; height: number };
	  }
	| { mode: 'marquee'; startX: number; startY: number };

// === Visible entity for renderers ===

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

// === Frame changes ===

/** Per-frame change flags indicating what changed during the last tick. */
export interface FrameChanges {
	/** Entities whose world-space position or size changed. */
	positionsChanged: EntityId[];
	/** Entities whose responsive breakpoint changed. */
	breakpointsChanged: EntityId[];
	/** Entities that entered the visible viewport. */
	entered: EntityId[];
	/** Entities that exited the visible viewport. */
	exited: EntityId[];
	/** Whether the camera position or zoom changed. */
	cameraChanged: boolean;
	/** Whether the navigation stack changed (entered/exited container). */
	navigationChanged: boolean;
	/** Whether the selection set changed. */
	selectionChanged: boolean;
}

// === Engine Config ===

/** Options for creating a new widget entity via `engine.addWidget()`. */
export interface AddWidgetOptions {
	/** Widget type identifier, matched against registered widget definitions. */
	type: string;
	/** Initial world-space position. */
	position: { x: number; y: number };
	/** Initial world-space size. */
	size: { width: number; height: number };
	/** Initial rotation in radians. */
	rotation?: number;
	/** Arbitrary application data attached to the widget. */
	data?: Record<string, unknown>;
	/** Rendering surface: DOM (default) or WebGL. */
	surface?: 'dom' | 'webgl';
	/** Rendering and hit-test ordering. Higher values render on top. */
	zIndex?: number;
	/** Whether the widget can be selected (default: true). */
	selectable?: boolean;
	/** Whether the widget can be dragged (default: true). */
	draggable?: boolean;
	/** Whether the widget can be resized (default: true). */
	resizable?: boolean;
	/** Parent entity for hierarchy nesting. */
	parent?: EntityId;
}

/** Configuration options for `createLayoutEngine()`. */
export interface LayoutEngineConfig {
	/** Maximum entity count (default: 10000). */
	maxEntities?: number;
	/** Minimum and maximum zoom levels. */
	zoom?: { min: number; max: number };
	/** Screen-space pixel thresholds for responsive breakpoints. */
	breakpoints?: { micro: number; compact: number; normal: number; expanded: number };
	/** Snap alignment configuration. */
	snap?: {
		/** Whether snapping is enabled initially. */
		enabled?: boolean;
		/** Snap distance threshold in screen pixels. */
		threshold?: number;
	};
}

// === Engine ===

/**
 * The core layout engine. Manages the ECS world, camera, input, undo/redo,
 * spatial indexing, and frame lifecycle for an infinite canvas.
 */
export interface LayoutEngine {
	/** The underlying ECS world. Use for direct component/tag/resource access. */
	readonly world: World;

	// Entity CRUD

	/** Creates a bare entity with optional initial components/tags. */
	createEntity(inits?: ComponentInit[]): EntityId;
	/** Creates a new widget entity with the given type, position, size, and data. */
	addWidget(opts: AddWidgetOptions): EntityId;
	/** Removes an entity and cleans up all components, tags, and spatial index entries. */
	destroyEntity(id: EntityId): void;

	// Shorthand

	/** Reads a component from an entity. Returns undefined if not present. */
	get<T>(entity: EntityId, type: ComponentType<T>): T | undefined;
	/** Updates a component on an entity (partial merge). */
	set<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>): void;
	/** Checks if an entity has a component or tag. */
	has(entity: EntityId, type: ComponentType | TagType): boolean;

	// Extensions

	/** Registers a custom ECS system to run each tick. */
	registerSystem(system: SystemDef): void;
	/** Removes a registered system by name. */
	removeSystem(name: string): void;

	// Camera

	/** Returns the current camera state {x, y, zoom}. */
	getCamera(): { x: number; y: number; zoom: number };
	/** Moves the camera by the specified screen-space delta. */
	panBy(dx: number, dy: number): void;
	/** Moves the camera to the specified world coordinates. */
	panTo(worldX: number, worldY: number): void;
	/** Adjusts zoom level anchored at a screen point. Delta is a multiplier offset. */
	zoomAtPoint(screenX: number, screenY: number, delta: number): void;
	/** Sets the zoom level directly. */
	zoomTo(zoom: number): void;
	/** Adjusts camera to fit all entities (or specified entities) in the viewport. */
	zoomToFit(entityIds?: EntityId[], padding?: number): void;

	// Viewport

	/** Updates the viewport dimensions. Called automatically by InfiniteCanvas on resize. */
	setViewport(width: number, height: number, dpr?: number): void;

	// Pointer input

	/** Pointer-down handler. Returns a directive for how the canvas should capture the pointer. */
	handlePointerDown(
		screenX: number,
		screenY: number,
		button: number,
		modifiers: Modifiers,
	): PointerDirective;
	/** Pointer-move handler. Returns a directive reflecting the current interaction. */
	handlePointerMove(screenX: number, screenY: number, modifiers: Modifiers): PointerDirective;
	/** Pointer-up handler. Commits drags/resizes and returns a directive. */
	handlePointerUp(): PointerDirective;
	/** Cancels the current pointer interaction without committing changes. */
	handlePointerCancel(): void;

	// Selection & Hover

	/** Returns IDs of all currently selected entities. */
	getSelectedEntities(): EntityId[];
	/** Returns the entity currently under the pointer, or null. */
	getHoveredEntity(): EntityId | null;

	// Navigation

	/** Navigates into a container entity, pushing the current camera onto the navigation stack. */
	enterContainer(entity: EntityId): void;
	/** Navigates out of the current container, restoring the previous camera state. */
	exitContainer(): void;
	/** Returns the entity ID of the currently active container, or null if at root. */
	getActiveContainer(): EntityId | null;
	/** Returns the current navigation depth (0 = root). */
	getNavigationDepth(): number;

	// Commands + Undo/Redo

	/** Executes a command and pushes it onto the undo stack. */
	execute(command: Command): void;
	/** Begins a command group -- subsequent commands are bundled into one undo step. */
	beginCommandGroup(): void;
	/** Ends the current command group. */
	endCommandGroup(): void;
	/** Undoes the last command or command group. Returns true if anything was undone. */
	undo(): boolean;
	/** Redoes the last undone command. Returns true if anything was redone. */
	redo(): boolean;
	/** Returns whether there is a command to undo. */
	canUndo(): boolean;
	/** Returns whether there is a command to redo. */
	canRedo(): boolean;

	// Frame

	/** Schedules a tick on the next animation frame. Call after programmatic changes. */
	markDirty(): void;
	/** Runs one frame: executes all ECS systems, updates spatial index, emits frame events. */
	tick(): void;
	/** Ticks only if dirty. Returns true if a tick was performed. */
	flushIfDirty(): boolean;

	// Output

	/** Returns visible entities with their world-space bounds, breakpoint, and surface info. */
	getVisibleEntities(): VisibleEntity[];
	/** Returns per-frame change flags from the last tick. */
	getFrameChanges(): FrameChanges;

	// Spatial index (exposed for systems)

	/** Returns the spatial index used for viewport culling and hit testing. */
	getSpatialIndex(): SpatialIndex;

	// Snap guides

	/** Returns active snap guide lines from the last tick. */
	getSnapGuides(): SnapGuide[];
	/** Returns equal-spacing indicators from the last tick. */
	getEqualSpacing(): EqualSpacingIndicator[];
	/** Enables or disables snap alignment. */
	setSnapEnabled(on: boolean): void;
	/** Sets the snap distance threshold in world pixels. */
	setSnapThreshold(worldPx: number): void;

	// Performance profiling

	/** Performance profiler for measuring system execution times. */
	readonly profiler: Profiler;

	// Events

	/** Registers a callback invoked after each tick. Returns an unsubscribe function. */
	onFrame(handler: () => void): Unsubscribe;

	// Lifecycle

	/** Destroys the engine, releasing all resources and subscriptions. */
	destroy(): void;
}

/**
 * Creates a new LayoutEngine instance with the given configuration.
 * This is the main entry point for the infinite canvas library.
 */
export function createLayoutEngine(config?: LayoutEngineConfig): LayoutEngine {
	const world = createWorld();
	const scheduler = new SystemScheduler();
	const spatialIndex = new SpatialIndex();
	const profiler = new Profiler();
	scheduler.profiler = profiler;

	// Fix #11: Store spatial index as a proper resource
	world.setResource(SpatialIndexResource, { instance: spatialIndex });

	const commandBuffer = new CommandBuffer();

	// Apply config
	if (config?.zoom) {
		world.setResource(ZoomConfigResource, config.zoom);
	}
	if (config?.breakpoints) {
		world.setResource(BreakpointConfigResource, config.breakpoints);
	}

	// Apply snap config
	let snapEnabledInit = true;
	let snapThresholdInit = 5;
	if (config?.snap?.enabled !== undefined) snapEnabledInit = config.snap.enabled;
	if (config?.snap?.threshold !== undefined) snapThresholdInit = config.snap.threshold;

	// Register built-in systems
	scheduler.register(transformPropagateSystem);
	scheduler.register(handleSyncSystem);
	scheduler.register(hitboxWorldBoundsSystem);
	scheduler.register(navigationFilterSystem);
	scheduler.register(cullSystem);
	scheduler.register(breakpointSystem);
	scheduler.register(sortSystem);

	// Collect observer unsubscribe functions for cleanup in destroy()
	const unsubscribers: Unsubscribe[] = [];

	// P3: Wire spatial index reactively via observer instead of per-frame system scan
	unsubscribers.push(
		world.onComponentChanged(WorldBounds, (entityId, _prev, wb) => {
			if (wb) {
				spatialIndex.upsert(entityId, worldBoundsToAABB(wb));
			}
		}),
	);

	// Fix #3: Clean up spatial index when ANY entity is destroyed (including
	// handles destroyed directly by systems via world.destroyEntity).
	unsubscribers.push(
		world.onEntityDestroyed((entity) => {
			spatialIndex.remove(entity);
		}),
	);

	// Auto-attach InteractionRole and CursorHint based on Draggable/Selectable
	// tag presence. This lets users create entities via createEntity() with the
	// traditional tag-based API without needing to know about the new
	// InteractionRole component introduced in RFC-001. addWidget's path
	// continues to work because it adds the same tags. Entities with an
	// explicit resize/rotate/connect role (e.g. spawned handles) are left
	// alone so this never fights handleSyncSystem.
	function refreshInteractionRole(entity: EntityId): void {
		const current = world.getComponent(entity, InteractionRole);
		// Never touch roles we don't own (resize/rotate/connect live on handles
		// and future sub-entities; they are managed explicitly by their spawner).
		if (
			current &&
			current.role.type !== 'drag' &&
			current.role.type !== 'select' &&
			current.role.type !== 'canvas'
		) {
			return;
		}

		const hasDraggable = world.hasTag(entity, Draggable);
		const hasSelectable = world.hasTag(entity, Selectable);
		const desiredRole: InteractionRoleType | null = hasDraggable
			? { type: 'drag' }
			: hasSelectable
				? { type: 'select' }
				: null;

		if (desiredRole === null) {
			if (current) world.removeComponent(entity, InteractionRole);
			if (world.hasComponent(entity, CursorHint)) world.removeComponent(entity, CursorHint);
			return;
		}

		if (!current) {
			world.addComponent(entity, InteractionRole, { layer: 5, role: desiredRole });
		} else if (current.role.type !== desiredRole.type) {
			world.setComponent(entity, InteractionRole, { role: desiredRole });
		}

		if (desiredRole.type === 'drag' && !world.hasComponent(entity, CursorHint)) {
			world.addComponent(entity, CursorHint, { hover: 'grab', active: 'grabbing' });
		}
	}
	unsubscribers.push(world.onTagAdded(Draggable, refreshInteractionRole));
	unsubscribers.push(world.onTagRemoved(Draggable, refreshInteractionRole));
	unsubscribers.push(world.onTagAdded(Selectable, refreshInteractionRole));
	unsubscribers.push(world.onTagRemoved(Selectable, refreshInteractionRole));

	// Initialize navigation — mark root entities as Active on first tick
	world.setResource(NavigationStackResource, { changed: true });

	// State
	let inputState: InputState = { mode: 'idle' };
	let hoveredEntity: EntityId | null = null;
	let snapEnabled = snapEnabledInit;
	let snapThreshold = snapThresholdInit; // screen pixels — divided by zoom to convert to world units
	let currentSnap: SnapResult = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
	let dirty = false;
	let cameraChangedThisTick = false;
	let selectionChangedThisTick = false; // Fix #2: proper selection tracking
	let prevVisible = new Set<EntityId>();
	let currentVisible: VisibleEntity[] = [];
	let frameChanges: FrameChanges = {
		positionsChanged: [],
		breakpointsChanged: [],
		entered: [],
		exited: [],
		cameraChanged: false,
		navigationChanged: false,
		selectionChanged: false,
	};

	function markDirtyInternal() {
		dirty = true;
	}

	function hitTest(
		screenX: number,
		screenY: number,
	): { entityId: EntityId; role: InteractionRoleData } | null {
		const camera = world.getResource(CameraResource);
		const worldPos = screenToWorld(screenX, screenY, camera);

		// Zero-tolerance point query: RBush returns only entries whose AABB
		// strictly contains the point, so no secondary pointInAABB check is
		// needed. Generous hit slop lives in Hitbox size, not in tolerance.
		const candidates = spatialIndex.searchPoint(worldPos.x, worldPos.y, 0);

		// Filter: must be Active (in current navigation frame) AND have a role.
		type Candidate = { entityId: EntityId; role: InteractionRoleData };
		const interactable: Candidate[] = [];
		for (const c of candidates) {
			if (!world.hasTag(c.entityId, Active)) continue;
			const role = world.getComponent(c.entityId, InteractionRole);
			if (!role) continue;
			interactable.push({ entityId: c.entityId, role });
		}
		if (interactable.length === 0) return null;

		// Sort: role.layer desc, then ZIndex desc as tiebreaker.
		interactable.sort((a, b) => {
			if (b.role.layer !== a.role.layer) return b.role.layer - a.role.layer;
			const zA = world.getComponent(a.entityId, ZIndex)?.value ?? 0;
			const zB = world.getComponent(b.entityId, ZIndex)?.value ?? 0;
			return zB - zA;
		});

		return interactable[0];
	}

	/**
	 * RFC-001 Phase 7: derive the root-container cursor from input state +
	 * hover, write to CursorResource. Closes over `inputState`, `hoveredEntity`
	 * and `world`, which is why it's a plain function instead of a SystemDef.
	 * Called from engine.tick() after scheduler.execute(world).
	 */
	function cursorSystem(): void {
		let cursor: CSSCursor = 'default';

		switch (inputState.mode) {
			case 'idle':
			case 'marquee': {
				if (hoveredEntity !== null) {
					cursor = world.getComponent(hoveredEntity, CursorHint)?.hover ?? 'default';
				}
				break;
			}
			case 'tracking': {
				// Dead zone not yet crossed — show hover intent (grab), not active (grabbing).
				cursor = world.getComponent(inputState.entityId, CursorHint)?.hover ?? 'default';
				break;
			}
			case 'dragging': {
				cursor = world.getComponent(inputState.entityId, CursorHint)?.active ?? 'grabbing';
				break;
			}
			case 'resizing': {
				cursor = world.getComponent(inputState.handleEntityId, CursorHint)?.active ?? 'default';
				break;
			}
		}

		world.setResource(CursorResource, { cursor });
	}

	// Fix #2: track selection changes explicitly
	function selectEntity(entity: EntityId, additive: boolean) {
		if (!world.hasTag(entity, Selectable)) return;

		if (additive) {
			if (world.hasTag(entity, Selected)) {
				world.removeTag(entity, Selected);
			} else {
				world.addTag(entity, Selected);
			}
		} else {
			for (const e of world.queryTagged(Selected)) {
				if (e !== entity) world.removeTag(e, Selected);
			}
			world.addTag(entity, Selected);
		}
		selectionChangedThisTick = true;
	}

	function clearSelection() {
		const selected = world.queryTagged(Selected);
		if (selected.length > 0) {
			for (const e of selected) {
				world.removeTag(e, Selected);
			}
			selectionChangedThisTick = true;
		}
	}

	const engine: LayoutEngine = {
		world,

		// === Entity CRUD ===

		createEntity(inits?: ComponentInit[]): EntityId {
			const entity = world.createEntity();
			if (inits) {
				for (const init of inits) {
					const type = init[0];
					if (type.__kind === 'tag') {
						world.addTag(entity, type as TagType);
					} else {
						world.addComponent(entity, type as ComponentType, init[1] ?? {});
					}
				}
			}
			markDirtyInternal();
			return entity;
		},

		addWidget(opts: AddWidgetOptions): EntityId {
			const inits: ComponentInit[] = [
				[
					Transform2D,
					{
						x: opts.position.x,
						y: opts.position.y,
						width: opts.size.width,
						height: opts.size.height,
						rotation: opts.rotation ?? 0,
					},
				],
				[Widget, { surface: opts.surface ?? 'dom', type: opts.type }],
			];
			if (opts.data !== undefined) {
				inits.push([WidgetData, { data: opts.data }]);
			}
			inits.push([ZIndex, { value: opts.zIndex ?? 0 }]);
			// Selectable / Draggable trigger the reactive observer in
			// createLayoutEngine which auto-attaches InteractionRole and (for
			// Draggable) CursorHint. Users building entities via createEntity()
			// with these tags get the same wiring for free.
			if (opts.selectable !== false) inits.push([Selectable]);
			if (opts.draggable !== false) inits.push([Draggable]);
			if (opts.resizable !== false) inits.push([Resizable]);
			if (opts.parent !== undefined) {
				inits.push([Parent, { id: opts.parent }]);
			}
			return engine.createEntity(inits);
		},

		destroyEntity(id: EntityId) {
			// Cascade through HandleSet first so handles get cleaned up.
			const set = world.getComponent(id, HandleSet);
			if (set) {
				for (const handleId of set.ids) {
					if (world.entityExists(handleId)) {
						spatialIndex.remove(handleId);
						world.destroyEntity(handleId);
					}
				}
			}
			spatialIndex.remove(id);
			world.destroyEntity(id);
			markDirtyInternal();
		},

		get<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
			return world.getComponent(entity, type);
		},

		set<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>) {
			world.setComponent(entity, type, data);
			markDirtyInternal();
		},

		has(entity: EntityId, type: ComponentType | TagType): boolean {
			if (type.__kind === 'tag') return world.hasTag(entity, type as TagType);
			return world.hasComponent(entity, type as ComponentType);
		},

		// === Extensions ===

		registerSystem(system: SystemDef) {
			scheduler.register(system);
		},

		removeSystem(name: string) {
			scheduler.remove(name);
		},

		// === Camera ===

		getCamera() {
			return world.getResource(CameraResource);
		},

		panBy(dx: number, dy: number) {
			const camera = world.getResource(CameraResource);
			camera.x -= dx / camera.zoom;
			camera.y -= dy / camera.zoom;
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		panTo(worldX: number, worldY: number) {
			const camera = world.getResource(CameraResource);
			const viewport = world.getResource(ViewportResource);
			camera.x = worldX - viewport.width / (2 * camera.zoom);
			camera.y = worldY - viewport.height / (2 * camera.zoom);
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		zoomAtPoint(screenX: number, screenY: number, delta: number) {
			const camera = world.getResource(CameraResource);
			const zoomConfig = world.getResource(ZoomConfigResource);

			const worldBefore = screenToWorld(screenX, screenY, camera);
			const newZoom = clamp(camera.zoom * (1 + delta), zoomConfig.min, zoomConfig.max);
			camera.zoom = newZoom;
			camera.x = worldBefore.x - screenX / newZoom;
			camera.y = worldBefore.y - screenY / newZoom;
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		zoomTo(zoom: number) {
			const camera = world.getResource(CameraResource);
			const zoomConfig = world.getResource(ZoomConfigResource);
			const viewport = world.getResource(ViewportResource);
			const centerWorldX = camera.x + viewport.width / (2 * camera.zoom);
			const centerWorldY = camera.y + viewport.height / (2 * camera.zoom);
			camera.zoom = clamp(zoom, zoomConfig.min, zoomConfig.max);
			camera.x = centerWorldX - viewport.width / (2 * camera.zoom);
			camera.y = centerWorldY - viewport.height / (2 * camera.zoom);
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		zoomToFit(entityIds?: EntityId[], padding = 50) {
			const viewport = world.getResource(ViewportResource);
			if (viewport.width === 0) return;

			const entities = entityIds ?? world.queryTagged(Active);
			if (entities.length === 0) return;

			let minX = Number.POSITIVE_INFINITY;
			let minY = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;
			for (const e of entities) {
				const wb = world.getComponent(e, WorldBounds);
				if (!wb) continue;
				minX = Math.min(minX, wb.worldX);
				minY = Math.min(minY, wb.worldY);
				maxX = Math.max(maxX, wb.worldX + wb.worldWidth);
				maxY = Math.max(maxY, wb.worldY + wb.worldHeight);
			}
			if (!Number.isFinite(minX)) return;

			const contentWidth = maxX - minX + padding * 2;
			const contentHeight = maxY - minY + padding * 2;
			const zoomConfig = world.getResource(ZoomConfigResource);
			const zoom = clamp(
				Math.min(viewport.width / contentWidth, viewport.height / contentHeight),
				zoomConfig.min,
				zoomConfig.max,
			);

			const camera = world.getResource(CameraResource);
			camera.zoom = zoom;
			camera.x = minX - padding - (viewport.width / zoom - contentWidth) / 2;
			camera.y = minY - padding - (viewport.height / zoom - contentHeight) / 2;
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		// === Viewport ===

		setViewport(width: number, height: number, dpr?: number) {
			world.setResource(ViewportResource, { width, height, dpr: dpr ?? 1 });
			markDirtyInternal();
		},

		// === Commands + Undo/Redo ===

		execute(command: Command) {
			commandBuffer.execute(command, world);
			markDirtyInternal();
		},

		beginCommandGroup() {
			commandBuffer.beginGroup();
		},

		endCommandGroup() {
			commandBuffer.endGroup();
		},

		undo(): boolean {
			const did = commandBuffer.undo(world);
			if (did) markDirtyInternal();
			return did;
		},

		redo(): boolean {
			const did = commandBuffer.redo(world);
			if (did) markDirtyInternal();
			return did;
		},

		canUndo(): boolean {
			return commandBuffer.canUndo();
		},

		canRedo(): boolean {
			return commandBuffer.canRedo();
		},

		// === Pointer Input ===

		handlePointerDown(screenX, screenY, _button, modifiers): PointerDirective {
			const hit = hitTest(screenX, screenY);

			if (!hit) {
				clearSelection();
				inputState = { mode: 'marquee', startX: screenX, startY: screenY };
				markDirtyInternal();
				return { action: 'capture-marquee' };
			}

			switch (hit.role.role.type) {
				case 'resize': {
					const parentRef = world.getComponent(hit.entityId, Parent);
					if (!parentRef) return { action: 'passthrough' };
					const parentId = parentRef.id;
					const t = world.getComponent(parentId, Transform2D);
					if (!t) return { action: 'passthrough' };
					commandBuffer.beginGroup(); // undo group for entire resize
					inputState = {
						mode: 'resizing',
						entityId: parentId,
						handleEntityId: hit.entityId,
						handle: hit.role.role.handle,
						startX: screenX,
						startY: screenY,
						startBounds: { x: t.x, y: t.y, width: t.width, height: t.height },
					};
					markDirtyInternal();
					return { action: 'capture-resize', handle: hit.role.role.handle };
				}

				case 'drag': {
					selectEntity(hit.entityId, modifiers.shift);
					if (world.hasTag(hit.entityId, Draggable)) {
						inputState = {
							mode: 'tracking',
							entityId: hit.entityId,
							startX: screenX,
							startY: screenY,
						};
					}
					markDirtyInternal();
					return { action: 'passthrough-track-drag' };
				}

				case 'select': {
					selectEntity(hit.entityId, modifiers.shift);
					markDirtyInternal();
					return { action: 'passthrough' };
				}

				// 'canvas' | 'rotate' | 'connect' — no handler yet, fall through.
				default:
					return { action: 'passthrough' };
			}
		},

		handlePointerMove(screenX, screenY, _modifiers): PointerDirective {
			if (inputState.mode === 'tracking') {
				const dx = screenX - inputState.startX;
				const dy = screenY - inputState.startY;
				if (Math.abs(dx) > DEAD_ZONE_MOUSE_PX || Math.abs(dy) > DEAD_ZONE_MOUSE_PX) {
					// Fix #5: Save original z-indices, temporarily bring to top
					const originalZIndices = new Map<EntityId, number>();
					let maxZ = 0;
					for (const e of world.queryTagged(Active)) {
						const z = world.getComponent(e, ZIndex);
						if (z && z.value > maxZ) maxZ = z.value;
					}
					for (const e of world.queryTagged(Selected)) {
						const z = world.getComponent(e, ZIndex);
						originalZIndices.set(e, z?.value ?? 0);
						world.setComponent(e, ZIndex, { value: maxZ + 1 });
					}

					// Capture start positions for all selected entities
					const startPositions = new Map<EntityId, { x: number; y: number }>();
					for (const e of world.queryTagged(Selected)) {
						const t = world.getComponent(e, Transform2D);
						if (t) startPositions.set(e, { x: t.x, y: t.y });
					}

					// Start undo group for the entire drag operation
					commandBuffer.beginGroup();

					inputState = {
						mode: 'dragging',
						entityId: inputState.entityId,
						startScreenX: screenX,
						startScreenY: screenY,
						startPositions,
						originalZIndices,
					};
					markDirtyInternal();
					return { action: 'capture-drag' };
				}
				return { action: 'passthrough' };
			}

			if (inputState.mode === 'dragging') {
				const camera = world.getResource(CameraResource);
				const totalDx = (screenX - inputState.startScreenX) / camera.zoom;
				const totalDy = (screenY - inputState.startScreenY) / camera.zoom;

				// Compute snap guides against visible non-dragged entities
				if (snapEnabled && inputState.startPositions.size > 0) {
					// Build dragged bounds (use first entity as reference for snap)
					const draggedIds = new Set(inputState.startPositions.keys());
					const firstId = inputState.startPositions.keys().next().value as EntityId;
					const firstStart = inputState.startPositions.get(firstId);
					const firstT = world.getComponent(firstId, Transform2D);
					if (firstT && firstStart) {
						const draggedBounds = {
							x: firstStart.x + totalDx,
							y: firstStart.y + totalDy,
							width: firstT.width,
							height: firstT.height,
						};

						// Collect reference bounds from visible entities. Skip the dragged
						// set and skip anything with a Hitbox component — Hitbox entities
						// are sub-entity interaction zones (resize handles), not snap
						// targets. Without this filter the dragged widget's own 8 handles
						// become snap refs and every axis matches trivially, producing
						// guide lines for every edge on every drag frame.
						const refs = [];
						for (const entity of world.queryTagged(Active)) {
							if (draggedIds.has(entity)) continue;
							if (world.hasComponent(entity, Hitbox)) continue;
							const wb = world.getComponent(entity, WorldBounds);
							if (wb) {
								refs.push({
									x: wb.worldX,
									y: wb.worldY,
									width: wb.worldWidth,
									height: wb.worldHeight,
								});
							}
						}

						currentSnap = computeSnapGuides(draggedBounds, refs, snapThreshold / camera.zoom);
					}
				} else {
					currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
				}

				// Apply snap-corrected positions
				const finalDx = totalDx + currentSnap.snapDx;
				const finalDy = totalDy + currentSnap.snapDy;
				for (const [e, start] of inputState.startPositions) {
					world.setComponent(e, Transform2D, {
						x: start.x + finalDx,
						y: start.y + finalDy,
					});
				}
				markDirtyInternal();
				return { action: 'capture-drag' };
			}

			if (inputState.mode === 'resizing') {
				const camera = world.getResource(CameraResource);
				const dx = (screenX - inputState.startX) / camera.zoom;
				const dy = (screenY - inputState.startY) / camera.zoom;
				const { x, y, width: w, height: h } = inputState.startBounds;
				const handle = inputState.handle;

				let newX = x;
				let newY = y;
				let newW = w;
				let newH = h;

				if (handle.includes('e')) {
					newW = Math.max(MIN_WIDGET_SIZE, w + dx);
				}
				if (handle.includes('w')) {
					const clampedW = Math.max(MIN_WIDGET_SIZE, w - dx);
					newX = x + w - clampedW; // right edge stays fixed
					newW = clampedW;
				}
				if (handle.includes('s')) {
					newH = Math.max(MIN_WIDGET_SIZE, h + dy);
				}
				if (handle.includes('n')) {
					const clampedH = Math.max(MIN_WIDGET_SIZE, h - dy);
					newY = y + h - clampedH; // bottom edge stays fixed
					newH = clampedH;
				}

				world.setComponent(inputState.entityId, Transform2D, {
					x: newX,
					y: newY,
					width: newW,
					height: newH,
				});
				markDirtyInternal();
				return { action: 'capture-resize', handle: inputState.handle };
			}

			if (inputState.mode === 'marquee') {
				// TODO: marquee selection in Phase 7
				return { action: 'capture-marquee' };
			}

			// Hover tracking in idle mode
			if (inputState.mode === 'idle') {
				const hit = hitTest(screenX, screenY);
				// RFC-001 Phase 7: use the raw hit id so cursorSystem can read
				// CursorHint from handles (e.g. 'se-resize'). Selection outline is
				// already drawn for the parent via Selected tag whenever handles
				// exist — hover-to-parent resolution would only clobber the
				// directional cursor affordance with no benefit.
				const hoverTarget: EntityId | null = hit ? hit.entityId : null;
				if (hoverTarget !== hoveredEntity) {
					hoveredEntity = hoverTarget;
					markDirtyInternal();
				}
			}

			return { action: 'passthrough' };
		},

		handlePointerUp(): PointerDirective {
			const prevState = inputState;

			if (prevState.mode === 'dragging') {
				// Fix #5: Restore original z-indices on drag end
				for (const [entity, originalZ] of prevState.originalZIndices) {
					world.setComponent(entity, ZIndex, { value: originalZ });
				}
				// Compute total delta from any moved entity
				const entityIds = [...prevState.startPositions.keys()];
				if (entityIds.length > 0) {
					const firstId = entityIds[0];
					const start = prevState.startPositions.get(firstId);
					const current = world.getComponent(firstId, Transform2D);
					if (current && start) {
						const totalDx = current.x - start.x;
						const totalDy = current.y - start.y;
						if (totalDx !== 0 || totalDy !== 0) {
							// Revert all to start positions, then commit as single command
							for (const [e, s] of prevState.startPositions) {
								world.setComponent(e, Transform2D, { x: s.x, y: s.y });
							}
							commandBuffer.execute(
								new MoveCommand(entityIds, totalDx, totalDy, Transform2D),
								world,
							);
						}
					}
				}
				commandBuffer.endGroup();
				currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
			}

			if (prevState.mode === 'resizing') {
				// Capture final bounds before reverting
				const t = world.getComponent(prevState.entityId, Transform2D);
				if (t) {
					const finalBounds = { x: t.x, y: t.y, width: t.width, height: t.height };
					const sb = prevState.startBounds;
					// Revert to start bounds so the command's execute() applies cleanly
					world.setComponent(prevState.entityId, Transform2D, sb);
					commandBuffer.execute(
						new ResizeCommand(prevState.entityId, sb, finalBounds, Transform2D),
						world,
					);
				}
				commandBuffer.endGroup();
			}

			// Fix #12: TODO — emit a 'widget-clicked' event when prevState.mode === 'tracking'

			inputState = { mode: 'idle' };

			if (prevState.mode === 'dragging' || prevState.mode === 'resizing') {
				markDirtyInternal();
			}

			return { action: 'passthrough' };
		},

		handlePointerCancel(): void {
			// End any open undo group to prevent leaked groups
			if (inputState.mode === 'dragging' || inputState.mode === 'resizing') {
				commandBuffer.endGroup();
			}
			// Clear snap state
			currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
			// Reset interaction state to idle
			inputState = { mode: 'idle' };
			markDirtyInternal();
		},

		// === Selection ===

		getSelectedEntities(): EntityId[] {
			return world.queryTagged(Selected);
		},

		getHoveredEntity(): EntityId | null {
			return hoveredEntity;
		},

		// === Snap Guides ===

		getSnapGuides(): SnapGuide[] {
			return currentSnap.guides;
		},

		getEqualSpacing(): EqualSpacingIndicator[] {
			return currentSnap.spacings;
		},

		setSnapEnabled(on: boolean) {
			snapEnabled = on;
		},

		setSnapThreshold(worldPx: number) {
			snapThreshold = worldPx;
		},

		// === Navigation ===

		enterContainer(entity: EntityId) {
			if (!world.hasComponent(entity, Container)) return;
			if (!world.hasComponent(entity, Children)) return;

			const navStack = world.getResource(NavigationStackResource);
			const camera = world.getResource(CameraResource);

			const currentFrame = navStack.frames[navStack.frames.length - 1];
			currentFrame.camera = { x: camera.x, y: camera.y, zoom: camera.zoom };

			navStack.frames.push({
				containerId: entity,
				camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
			});
			navStack.changed = true;

			clearSelection();
			markDirtyInternal();
		},

		exitContainer() {
			const navStack = world.getResource(NavigationStackResource);
			if (navStack.frames.length <= 1) return;

			navStack.frames.pop();
			navStack.changed = true;

			const parentFrame = navStack.frames[navStack.frames.length - 1];
			const camera = world.getResource(CameraResource);
			camera.x = parentFrame.camera.x;
			camera.y = parentFrame.camera.y;
			camera.zoom = parentFrame.camera.zoom;

			clearSelection();
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		getActiveContainer(): EntityId | null {
			const navStack = world.getResource(NavigationStackResource);
			return navStack.frames[navStack.frames.length - 1].containerId;
		},

		getNavigationDepth(): number {
			return world.getResource(NavigationStackResource).frames.length - 1;
		},

		// === Frame ===

		markDirty() {
			markDirtyInternal();
		},

		profiler,

		tick() {
			profiler.beginFrame(world.currentTick);

			// Fix #4: Capture navigation changed flag before systems clear it
			const navStackPreTick = world.getResource(NavigationStackResource);
			const navigationChangedThisTick = navStackPreTick?.changed ?? false;

			// Run all systems
			scheduler.execute(world);

			// RFC-001 Phase 7: derive the root-container cursor from input state + hover.
			cursorSystem();

			// Compute visible entities for renderers
			profiler.beginVisibility();
			const newVisible: VisibleEntity[] = [];
			const newVisibleSet = new Set<EntityId>();

			for (const entity of world.query(Widget, Visible)) {
				const wb = world.getComponent(entity, WorldBounds);
				const widget = world.getComponent(entity, Widget);
				const bp = world.getComponent(entity, WidgetBreakpoint);
				const zIdx = world.getComponent(entity, ZIndex);
				if (!wb || !widget) continue;

				newVisibleSet.add(entity);
				newVisible.push({
					entityId: entity,
					worldX: wb.worldX,
					worldY: wb.worldY,
					worldWidth: wb.worldWidth,
					worldHeight: wb.worldHeight,
					breakpoint: bp?.current ?? 'normal',
					zIndex: zIdx?.value ?? 0,
					surface: widget.surface,
					widgetType: widget.type,
				});
			}

			// Sort by z-index
			newVisible.sort((a, b) => a.zIndex - b.zIndex);
			profiler.endVisibility();

			// Compute frame changes
			const entered: EntityId[] = [];
			const exited: EntityId[] = [];
			for (const entity of newVisibleSet) {
				if (!prevVisible.has(entity)) entered.push(entity);
			}
			for (const entity of prevVisible) {
				if (!newVisibleSet.has(entity)) exited.push(entity);
			}

			// Fix #2: Use selectionChangedThisTick instead of wrong breakpoint check
			frameChanges = {
				positionsChanged: world.queryChanged(WorldBounds),
				breakpointsChanged: world.queryChanged(WidgetBreakpoint),
				entered,
				exited,
				cameraChanged: cameraChangedThisTick,
				navigationChanged: navigationChangedThisTick,
				selectionChanged: selectionChangedThisTick,
			};

			currentVisible = newVisible;
			prevVisible = newVisibleSet;
			cameraChangedThisTick = false;
			selectionChangedThisTick = false;

			profiler.endFrame(world.entityCount, newVisible.length);

			// Clear dirty sets and increment tick
			world.clearDirty();
			world.incrementTick();
			world.emitFrame();

			dirty = false;
		},

		flushIfDirty(): boolean {
			if (!dirty) return false;
			engine.tick();
			return true;
		},

		// === Output ===

		getVisibleEntities(): VisibleEntity[] {
			return currentVisible;
		},

		getFrameChanges(): FrameChanges {
			return frameChanges;
		},

		// Fix #11: Expose spatial index properly
		getSpatialIndex(): SpatialIndex {
			return spatialIndex;
		},

		// === Events ===

		onFrame(handler: () => void): Unsubscribe {
			return world.onFrame(handler);
		},

		// === Lifecycle ===

		destroy() {
			// Unsubscribe all observers
			for (const unsub of unsubscribers) {
				unsub();
			}
			unsubscribers.length = 0;

			// Clear command buffer (undo/redo stacks and any open group)
			commandBuffer.clear();

			// Disable profiler and clear its ring buffer
			profiler.setEnabled(false);
			profiler.clear();

			// Clear spatial index
			spatialIndex.clear();
		},
	};

	return engine;
}
