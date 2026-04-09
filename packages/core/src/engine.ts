import type {
	ComponentInit,
	ComponentType,
	EntityId,
	SystemDef,
	TagType,
	Unsubscribe,
	World,
} from './ecs/index.js';
import { createWorld, SystemScheduler, defineResource } from './ecs/index.js';
import {
	Transform2D,
	WorldBounds,
	Widget,
	WidgetBreakpoint,
	ZIndex,
	Children,
	Selectable,
	Selected,
	Draggable,
	Resizable,
	Active,
	Visible,
	Container,
} from './components.js';
import {
	CameraResource,
	ViewportResource,
	ZoomConfigResource,
	NavigationStackResource,
	BreakpointConfigResource,
} from './resources.js';
import type { Breakpoint } from './resources.js';
import { SpatialIndex } from './spatial.js';
import { clamp, pointInAABB, screenToWorld } from './math.js';
import {
	transformPropagateSystem,
	spatialIndexSystem,
	navigationFilterSystem,
	cullSystem,
	breakpointSystem,
	sortSystem,
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

export type ResizeHandlePos = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

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
	| { mode: 'dragging'; entityId: EntityId; lastX: number; lastY: number; originalZIndices: Map<EntityId, number> }
	| { mode: 'resizing'; entityId: EntityId; handle: ResizeHandlePos; startX: number; startY: number; startBounds: { x: number; y: number; w: number; h: number } }
	| { mode: 'marquee'; startX: number; startY: number };

const DEAD_ZONE_PX = 4;

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

export interface CanvasEngineConfig {
	maxEntities?: number;
	zoom?: { min: number; max: number };
	breakpoints?: { micro: number; compact: number; normal: number; expanded: number };
}

// === Engine ===

export interface CanvasEngine {
	readonly world: World;

	// Entity CRUD
	createEntity(inits?: ComponentInit[]): EntityId;
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
	handlePointerDown(screenX: number, screenY: number, button: number, modifiers: Modifiers): PointerDirective;
	handlePointerMove(screenX: number, screenY: number, modifiers: Modifiers): PointerDirective;
	handlePointerUp(): PointerDirective;

	// Selection
	getSelectedEntities(): EntityId[];

	// Navigation
	enterContainer(entity: EntityId): void;
	exitContainer(): void;
	getActiveContainer(): EntityId | null;
	getNavigationDepth(): number;

	// Frame
	markDirty(): void;
	tick(): void;
	flushIfDirty(): boolean;

	// Output
	getVisibleEntities(): VisibleEntity[];
	getFrameChanges(): FrameChanges;

	// Spatial index (exposed for systems)
	getSpatialIndex(): SpatialIndex;

	// Events
	onFrame(handler: () => void): Unsubscribe;

	// Lifecycle
	destroy(): void;
}

export function createCanvasEngine(config?: CanvasEngineConfig): CanvasEngine {
	const world = createWorld();
	const scheduler = new SystemScheduler();
	const spatialIndex = new SpatialIndex();

	// Fix #11: Store spatial index as a proper resource
	world.setResource(SpatialIndexResource, { instance: spatialIndex });

	// Apply config
	if (config?.zoom) {
		world.setResource(ZoomConfigResource, config.zoom);
	}
	if (config?.breakpoints) {
		world.setResource(BreakpointConfigResource, config.breakpoints);
	}

	// Register built-in systems
	scheduler.register(transformPropagateSystem);
	scheduler.register(spatialIndexSystem);
	scheduler.register(navigationFilterSystem);
	scheduler.register(cullSystem);
	scheduler.register(breakpointSystem);
	scheduler.register(sortSystem);

	// Initialize navigation — mark root entities as Active on first tick
	world.setResource(NavigationStackResource, { changed: true });

	// State
	let inputState: InputState = { mode: 'idle' };
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

	function hitTest(screenX: number, screenY: number): EntityId | null {
		const camera = world.getResource(CameraResource);
		const worldPos = screenToWorld(screenX, screenY, camera);
		const tolerance = 2 / camera.zoom;
		const candidates = spatialIndex.searchPoint(worldPos.x, worldPos.y, tolerance);

		// Filter to Active entities, sort by z-index (highest first)
		const active = candidates
			.filter((c) => world.hasTag(c.entityId, Active))
			.sort((a, b) => {
				const zA = world.getComponent(a.entityId, ZIndex)?.value ?? 0;
				const zB = world.getComponent(b.entityId, ZIndex)?.value ?? 0;
				return zB - zA;
			});

		for (const candidate of active) {
			const wb = world.getComponent(candidate.entityId, WorldBounds);
			if (wb && pointInAABB(worldPos.x, worldPos.y, {
				minX: wb.worldX,
				minY: wb.worldY,
				maxX: wb.worldX + wb.worldWidth,
				maxY: wb.worldY + wb.worldHeight,
			})) {
				return candidate.entityId;
			}
		}
		return null;
	}

	function hitTestResizeHandle(
		screenX: number,
		screenY: number,
	): { entityId: EntityId; handle: ResizeHandlePos } | null {
		const selected = engine.getSelectedEntities();
		if (selected.length !== 1) return null;

		const entity = selected[0];
		const wb = world.getComponent(entity, WorldBounds);
		if (!wb || !world.hasTag(entity, Resizable)) return null;

		const camera = world.getResource(CameraResource);
		const worldPos = screenToWorld(screenX, screenY, camera);
		const handleSize = 8 / camera.zoom;

		const x = wb.worldX;
		const y = wb.worldY;
		const w = wb.worldWidth;
		const h = wb.worldHeight;

		const handles: { pos: ResizeHandlePos; cx: number; cy: number }[] = [
			{ pos: 'nw', cx: x, cy: y },
			{ pos: 'n', cx: x + w / 2, cy: y },
			{ pos: 'ne', cx: x + w, cy: y },
			{ pos: 'e', cx: x + w, cy: y + h / 2 },
			{ pos: 'se', cx: x + w, cy: y + h },
			{ pos: 's', cx: x + w / 2, cy: y + h },
			{ pos: 'sw', cx: x, cy: y + h },
			{ pos: 'w', cx: x, cy: y + h / 2 },
		];

		for (const handle of handles) {
			if (
				Math.abs(worldPos.x - handle.cx) <= handleSize &&
				Math.abs(worldPos.y - handle.cy) <= handleSize
			) {
				return { entityId: entity, handle: handle.pos };
			}
		}
		return null;
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

	const engine: CanvasEngine = {
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

		destroyEntity(id: EntityId) {
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

		zoomToFit(entityIds?: EntityId[], padding: number = 50) {
			const viewport = world.getResource(ViewportResource);
			if (viewport.width === 0) return;

			const entities = entityIds ?? world.queryTagged(Active);
			if (entities.length === 0) return;

			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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

		// === Pointer Input ===

		handlePointerDown(screenX, screenY, _button, modifiers): PointerDirective {
			// Check resize handles first
			const handleHit = hitTestResizeHandle(screenX, screenY);
			if (handleHit) {
				const t = world.getComponent(handleHit.entityId, Transform2D)!;
				inputState = {
					mode: 'resizing',
					entityId: handleHit.entityId,
					handle: handleHit.handle,
					startX: screenX,
					startY: screenY,
					startBounds: { x: t.x, y: t.y, w: t.width, h: t.height },
				};
				markDirtyInternal();
				return { action: 'capture-resize', handle: handleHit.handle };
			}

			// Hit test entities
			const hitEntity = hitTest(screenX, screenY);

			if (hitEntity !== null) {
				selectEntity(hitEntity, modifiers.shift);
				if (world.hasTag(hitEntity, Draggable)) {
					inputState = { mode: 'tracking', entityId: hitEntity, startX: screenX, startY: screenY };
				}
				markDirtyInternal();
				return { action: 'passthrough-track-drag' };
			}

			// Empty canvas
			clearSelection();
			inputState = { mode: 'marquee', startX: screenX, startY: screenY };
			markDirtyInternal();
			return { action: 'capture-marquee' };
		},

		handlePointerMove(screenX, screenY, _modifiers): PointerDirective {
			if (inputState.mode === 'tracking') {
				const dx = screenX - inputState.startX;
				const dy = screenY - inputState.startY;
				if (Math.abs(dx) > DEAD_ZONE_PX || Math.abs(dy) > DEAD_ZONE_PX) {
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

					inputState = {
						mode: 'dragging',
						entityId: inputState.entityId,
						lastX: screenX,
						lastY: screenY,
						originalZIndices,
					};
					markDirtyInternal();
					return { action: 'capture-drag' };
				}
				return { action: 'passthrough' };
			}

			if (inputState.mode === 'dragging') {
				const camera = world.getResource(CameraResource);
				const dx = (screenX - inputState.lastX) / camera.zoom;
				const dy = (screenY - inputState.lastY) / camera.zoom;
				inputState.lastX = screenX;
				inputState.lastY = screenY;

				// Move all selected entities
				for (const e of world.queryTagged(Selected)) {
					const t = world.getComponent(e, Transform2D);
					if (t) {
						world.setComponent(e, Transform2D, { x: t.x + dx, y: t.y + dy });
					}
				}
				markDirtyInternal();
				return { action: 'capture-drag' };
			}

			if (inputState.mode === 'resizing') {
				const camera = world.getResource(CameraResource);
				const dx = (screenX - inputState.startX) / camera.zoom;
				const dy = (screenY - inputState.startY) / camera.zoom;
				const { x, y, w, h } = inputState.startBounds;
				const handle = inputState.handle;

				let newX = x, newY = y, newW = w, newH = h;

				if (handle.includes('e')) { newW = Math.max(20, w + dx); }
				if (handle.includes('w')) { newX = x + dx; newW = Math.max(20, w - dx); }
				if (handle.includes('s')) { newH = Math.max(20, h + dy); }
				if (handle.includes('n')) { newY = y + dy; newH = Math.max(20, h - dy); }

				world.setComponent(inputState.entityId, Transform2D, {
					x: newX, y: newY, width: newW, height: newH,
				});
				markDirtyInternal();
				return { action: 'capture-resize', handle: inputState.handle };
			}

			if (inputState.mode === 'marquee') {
				// TODO: marquee selection in Phase 7
				return { action: 'capture-marquee' };
			}

			return { action: 'passthrough' };
		},

		handlePointerUp(): PointerDirective {
			const prevState = inputState;

			// Fix #5: Restore original z-indices on drag end
			if (prevState.mode === 'dragging') {
				for (const [entity, originalZ] of prevState.originalZIndices) {
					world.setComponent(entity, ZIndex, { value: originalZ });
				}
			}

			// Fix #12: TODO — emit a 'widget-clicked' event when prevState.mode === 'tracking'
			// (i.e., pointerdown + pointerup without exceeding the dead zone = a clean click)

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

		// === Navigation ===

		enterContainer(entity: EntityId) {
			if (!world.hasComponent(entity, Container)) return;
			if (!world.hasComponent(entity, Children)) return;

			const navStack = world.getResource(NavigationStackResource);
			const camera = world.getResource(CameraResource);

			const currentFrame = navStack.frames[navStack.frames.length - 1];
			currentFrame.camera = { x: camera.x, y: camera.y, zoom: camera.zoom };

			navStack.frames.push({ containerId: entity, camera: { x: camera.x, y: camera.y, zoom: camera.zoom } });
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

		tick() {
			// Run all systems
			scheduler.execute(world);

			// Compute visible entities for renderers
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

			// Clear dirty sets and increment tick
			(world as any).__clearDirty();
			(world as any).__incrementTick();
			(world as any).__emitFrame();

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
