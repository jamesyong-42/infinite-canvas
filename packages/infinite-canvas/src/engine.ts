import { CommandBuffer, MoveCommand, ResizeCommand } from './commands.js';
import type { Command } from './commands.js';
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
	CSSCursor,
	InteractionRoleData,
	InteractionRoleType,
	ResizeHandlePos,
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
import { SystemScheduler, createWorld, defineResource } from './ecs/index.js';
import { DEAD_ZONE_MOUSE_PX, MIN_WIDGET_SIZE } from './interaction-constants.js';
import { clamp, screenToWorld, worldBoundsToAABB } from './math.js';
import { Profiler } from './profiler.js';
import {
	BreakpointConfigResource,
	CameraResource,
	CursorResource,
	NavigationStackResource,
	ViewportResource,
	ZoomConfigResource,
} from './resources.js';
import type { Breakpoint } from './resources.js';
import { computeSnapGuides } from './snap.js';
import type { EqualSpacingIndicator, SnapGuide, SnapResult } from './snap.js';
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

// === Fix #11: SpatialIndex as a proper resource ===
export const SpatialIndexResource = defineResource('SpatialIndex', {
	instance: null as SpatialIndex | null,
});

// === Pointer Directives ===

export type PointerDirective =
	| { action: 'passthrough' }
	| { action: 'passthrough-track-drag' }
	| { action: 'capture-drag' }
	| { action: 'capture-resize'; handle: ResizeHandlePos }
	| { action: 'capture-marquee' };

export type { ResizeHandlePos } from './components.js';

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

export interface FrameChanges {
	positionsChanged: EntityId[];
	breakpointsChanged: EntityId[];
	entered: EntityId[];
	exited: EntityId[];
	cameraChanged: boolean;
	navigationChanged: boolean;
	selectionChanged: boolean;
}

// === Engine Config ===

export interface AddWidgetOptions {
	type: string;
	position: { x: number; y: number };
	size: { width: number; height: number };
	rotation?: number;
	data?: Record<string, unknown>;
	surface?: 'dom' | 'webgl';
	zIndex?: number;
	selectable?: boolean;
	draggable?: boolean;
	resizable?: boolean;
	parent?: EntityId;
}

export interface LayoutEngineConfig {
	maxEntities?: number;
	zoom?: { min: number; max: number };
	breakpoints?: { micro: number; compact: number; normal: number; expanded: number };
}

// === Engine ===

export interface LayoutEngine {
	readonly world: World;

	// Entity CRUD
	createEntity(inits?: ComponentInit[]): EntityId;
	addWidget(opts: AddWidgetOptions): EntityId;
	destroyEntity(id: EntityId): void;

	// Shorthand
	get<T>(entity: EntityId, type: ComponentType<T>): T | undefined;
	set<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>): void;
	has(entity: EntityId, type: ComponentType | TagType): boolean;

	// Extensions
	registerSystem(system: SystemDef): void;
	removeSystem(name: string): void;

	// Camera
	getCamera(): { x: number; y: number; zoom: number };
	panBy(dx: number, dy: number): void;
	panTo(worldX: number, worldY: number): void;
	zoomAtPoint(screenX: number, screenY: number, delta: number): void;
	zoomTo(zoom: number): void;
	zoomToFit(entityIds?: EntityId[], padding?: number): void;

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

	// Spatial index (exposed for systems)
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

	// Register built-in systems
	scheduler.register(transformPropagateSystem);
	scheduler.register(handleSyncSystem);
	scheduler.register(hitboxWorldBoundsSystem);
	scheduler.register(navigationFilterSystem);
	scheduler.register(cullSystem);
	scheduler.register(breakpointSystem);
	scheduler.register(sortSystem);

	// P3: Wire spatial index reactively via observer instead of per-frame system scan
	world.onComponentChanged(WorldBounds, (entityId, _prev, wb) => {
		if (wb) {
			spatialIndex.upsert(entityId, worldBoundsToAABB(wb));
		}
	});

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
	world.onTagAdded(Draggable, refreshInteractionRole);
	world.onTagRemoved(Draggable, refreshInteractionRole);
	world.onTagAdded(Selectable, refreshInteractionRole);
	world.onTagRemoved(Selectable, refreshInteractionRole);

	// Initialize navigation — mark root entities as Active on first tick
	world.setResource(NavigationStackResource, { changed: true });

	// State
	let inputState: InputState = { mode: 'idle' };
	let hoveredEntity: EntityId | null = null;
	let snapEnabled = true;
	let snapThreshold = 5; // world units
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

			let minX = Number.POSITIVE_INFINITY,
				minY = Number.POSITIVE_INFINITY,
				maxX = Number.NEGATIVE_INFINITY,
				maxY = Number.NEGATIVE_INFINITY;
			for (const e of entities) {
				const wb = world.getComponent(e, WorldBounds);
				if (!wb) continue;
				minX = Math.min(minX, wb.worldX);
				minY = Math.min(minY, wb.worldY);
				maxX = Math.max(maxX, wb.worldX + wb.worldWidth);
				maxY = Math.max(maxY, wb.worldY + wb.worldHeight);
			}
			if (!isFinite(minX)) return;

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
					const firstId = inputState.startPositions.keys().next().value!;
					const firstStart = inputState.startPositions.get(firstId)!;
					const firstT = world.getComponent(firstId, Transform2D);
					if (firstT) {
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

				let newX = x,
					newY = y,
					newW = w,
					newH = h;

				if (handle.includes('e')) {
					newW = Math.max(MIN_WIDGET_SIZE, w + dx);
				}
				if (handle.includes('w')) {
					newX = x + dx;
					newW = Math.max(MIN_WIDGET_SIZE, w - dx);
				}
				if (handle.includes('s')) {
					newH = Math.max(MIN_WIDGET_SIZE, h + dy);
				}
				if (handle.includes('n')) {
					newY = y + dy;
					newH = Math.max(MIN_WIDGET_SIZE, h - dy);
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
					const start = prevState.startPositions.get(firstId)!;
					const current = world.getComponent(firstId, Transform2D);
					if (current) {
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
				navigationChanged: false,
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
			spatialIndex.clear();
		},
	};

	return engine;
}

/** @deprecated Use LayoutEngine instead */
export type CanvasEngine = LayoutEngine;
/** @deprecated Use LayoutEngineConfig instead */
export type CanvasEngineConfig = LayoutEngineConfig;
/** @deprecated Use createLayoutEngine instead */
export const createCanvasEngine = createLayoutEngine;
