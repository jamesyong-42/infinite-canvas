import type {
	ComponentInit,
	ComponentType,
	EntityId,
	SystemDef,
	TagType,
	Unsubscribe,
} from '@jamesyong42/reactive-ecs';
import { createWorld, SystemScheduler } from '@jamesyong42/reactive-ecs';
import { Profiler } from '../../profiler/Profiler.js';
import type { Archetype, ArchetypeRegistry, SpawnOptions } from '../archetype.js';
import { createArchetypeRegistry } from '../archetype.js';
import type { Command } from '../commands.js';
import { CommandBuffer } from '../commands.js';
import type { InteractionRoleType } from '../components.js';
import {
	Active,
	Children,
	Container,
	CursorHint,
	Draggable,
	Dragging,
	HandleSet,
	InteractionRole,
	Layer,
	Parent,
	PreDragLayer,
	Resizable,
	Selectable,
	Selected,
	SelectionFrame,
	Transform2D,
	Visible,
	WidgetBreakpoint,
	Widget as WidgetComp,
	WidgetData,
	WorldBounds,
	ZIndex,
} from '../components.js';
import { clamp, screenToWorld, worldBoundsToAABB } from '../math.js';
import {
	BreakpointConfigResource,
	CameraResource,
	CardPresetsResource,
	NavigationStackResource,
	SpatialIndexResource,
	ViewportResource,
	ZoomConfigResource,
} from '../resources.js';
import type { StandardSchemaV1 } from '../schema.js';
import { SpatialIndex } from '../spatial/SpatialIndex.js';
import {
	breakpointSystem,
	cardSystem,
	cullSystem,
	handleSyncSystem,
	hitboxWorldBoundsSystem,
	navigationFilterSystem,
	sortSystem,
	transformPropagateSystem,
} from '../systems/index.js';
import { createInteractionRuntime } from './interaction.js';
import type {
	FrameChanges,
	LayoutEngine,
	LayoutEngineConfig,
	Modifiers,
	PointerDirective,
	VisibleEntity,
} from './types.js';
import type { WidgetBinding, WidgetRegistry } from './widget-binding.js';
import { createWidgetRegistry } from './widget-binding.js';

/**
 * Creates a new LayoutEngine instance with the given configuration.
 * This is the main entry point for the infinite canvas library.
 */
export function createLayoutEngine<W extends WidgetBinding = WidgetBinding>(
	config?: LayoutEngineConfig<W>,
): LayoutEngine<W> {
	const world = createWorld();
	const scheduler = new SystemScheduler();
	const spatialIndex = new SpatialIndex();
	const profiler = new Profiler();
	scheduler.profiler = profiler;

	// Store spatial index as a proper resource
	world.setResource(SpatialIndexResource, { instance: spatialIndex });

	const commandBuffer = new CommandBuffer();

	const widgetRegistry: WidgetRegistry<W> = createWidgetRegistry<W>();
	const archetypeRegistry: ArchetypeRegistry = createArchetypeRegistry();

	// Apply config
	if (config?.zoom) {
		world.setResource(ZoomConfigResource, config.zoom);
	}
	if (config?.breakpoints) {
		world.setResource(BreakpointConfigResource, config.breakpoints);
	}
	if (config?.cardPresets) {
		const current = world.getResource(CardPresetsResource);
		world.setResource(CardPresetsResource, {
			presets: { ...current.presets, ...config.cardPresets.presets },
			gap: config.cardPresets.gap ?? current.gap,
		});
	}

	let snapEnabled = config?.snap?.enabled ?? true;
	let snapThreshold = config?.snap?.threshold ?? 5;

	// Register built-in systems.
	scheduler.register(cardSystem);
	scheduler.register(transformPropagateSystem);
	scheduler.register(handleSyncSystem);
	scheduler.register(hitboxWorldBoundsSystem);
	scheduler.register(navigationFilterSystem);
	scheduler.register(cullSystem);
	scheduler.register(breakpointSystem);
	scheduler.register(sortSystem);

	const unsubscribers: Unsubscribe[] = [];

	// Wire spatial index reactively via observer instead of per-frame scan.
	unsubscribers.push(
		world.onComponentChanged(WorldBounds, (entityId, _prev, wb) => {
			if (wb) {
				spatialIndex.upsert(entityId, worldBoundsToAABB(wb));
			}
		}),
	);

	unsubscribers.push(
		world.onEntityDestroyed((entity) => {
			spatialIndex.remove(entity);
		}),
	);

	// Auto-attach InteractionRole and CursorHint based on Draggable/Selectable
	// tag presence. Entities with an explicit resize/rotate/connect role (e.g.
	// spawned handles) are left alone so this never fights handleSyncSystem.
	function refreshInteractionRole(entity: EntityId): void {
		const current = world.getComponent(entity, InteractionRole);
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

	// Drag-promote (RFC-003): while a DOM widget carries Dragging, hoist
	// it to the 'overlay' layer so it visually pops above the R3F canvas.
	// R3F widgets are deliberately excluded — they handle their own
	// stacking via the compositor (uDraggedRect clip + renderOrder bump
	// per RFC-003 Phase 4). Promoting an R3F widget's chrome to the
	// overlay layer would put its opaque background fill above the R3F
	// canvas, occluding the dragged widget's own 3D content.
	unsubscribers.push(
		world.onTagAdded(Dragging, (entity) => {
			if (world.hasComponent(entity, PreDragLayer)) return;
			const widget = world.getComponent(entity, WidgetComp);
			if (widget?.surface === 'webgl') return;
			const prev = world.getComponent(entity, Layer)?.name ?? 'base';
			world.addComponent(entity, PreDragLayer, { name: prev });
			if (world.hasComponent(entity, Layer)) {
				world.setComponent(entity, Layer, { name: 'overlay' });
			} else {
				world.addComponent(entity, Layer, { name: 'overlay' });
			}
			markDirtyInternal();
		}),
	);
	unsubscribers.push(
		world.onTagRemoved(Dragging, (entity) => {
			const stash = world.getComponent(entity, PreDragLayer);
			if (!stash) return;
			world.setComponent(entity, Layer, { name: stash.name });
			world.removeComponent(entity, PreDragLayer);
			markDirtyInternal();
		}),
	);

	// Pre-register widgets and archetypes from config
	if (config?.widgets) {
		for (const w of config.widgets) widgetRegistry.register(w);
	}
	if (config?.archetypes) {
		for (const a of config.archetypes) archetypeRegistry.register(a);
	}

	// Initialize navigation — mark root entities as Active on first tick
	world.setResource(NavigationStackResource, { changed: true });

	// Frame-level state
	let dirty = false;
	let cameraChangedThisTick = false;
	let selectionChangedThisTick = false;
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
		layersChanged: false,
	};

	function markDirtyInternal() {
		dirty = true;
	}

	// Compose the pointer / selection state machine.
	const interaction = createInteractionRuntime({
		world,
		spatialIndex,
		commandBuffer,
		markDirty: markDirtyInternal,
		notifySelectionChanged: () => {
			selectionChangedThisTick = true;
		},
		getSnapEnabled: () => snapEnabled,
		getSnapThreshold: () => snapThreshold,
	});

	const engine: LayoutEngine<W> = {
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

		spawn(id: string, opts: SpawnOptions = {}): EntityId {
			// Resolve archetype: explicit → widget-derived default → bare default.
			const archetype = archetypeRegistry.get(id);
			const widgetTypeId = archetype?.widget ?? id;
			const widget = widgetRegistry.get(widgetTypeId);

			const surface = widget?.surface ?? 'dom';
			const defaultData = (widget?.defaultData as Record<string, unknown> | undefined) ?? {};
			const defaultSize = archetype?.defaultSize ??
				widget?.defaultSize ?? { width: 100, height: 100 };

			const position = opts.at ?? { x: 0, y: 0 };
			const size = opts.size ?? defaultSize;
			const data = { ...defaultData, ...opts.data };

			const inits: ComponentInit[] = [
				[
					Transform2D,
					{
						x: position.x,
						y: position.y,
						width: size.width,
						height: size.height,
						rotation: opts.rotation ?? 0,
					},
				],
				[WidgetComp, { surface, type: widgetTypeId }],
				[WidgetData, { data }],
				[ZIndex, { value: opts.zIndex ?? 0 }],
			];

			if (archetype?.components) {
				for (const init of archetype.components) inits.push(init);
			}

			if (opts.parent !== undefined) {
				inits.push([Parent, { id: opts.parent }]);
			}

			// Interactive defaults — boolean or per-cap object.
			const interactiveConfig = archetype?.interactive;
			const caps =
				interactiveConfig === false
					? {
							selectable: false,
							draggable: false,
							resizable: false,
							selectionFrame: false,
						}
					: interactiveConfig === undefined || interactiveConfig === true
						? {
								selectable: true,
								draggable: true,
								resizable: true,
								selectionFrame: true,
							}
						: (() => {
								const selectable = interactiveConfig.selectable ?? false;
								return {
									selectable,
									draggable: interactiveConfig.draggable ?? false,
									resizable: interactiveConfig.resizable ?? false,
									selectionFrame: interactiveConfig.selectionFrame ?? selectable,
								};
							})();
			if (caps.selectable) inits.push([Selectable]);
			if (caps.draggable) inits.push([Draggable]);
			if (caps.resizable) inits.push([Resizable]);
			if (caps.selectionFrame) inits.push([SelectionFrame]);

			if (archetype?.tags) {
				for (const tag of archetype.tags) inits.push([tag]);
			}

			return engine.createEntity(inits);
		},

		spawnAtCameraCenter(id: string, opts: Omit<SpawnOptions, 'at'> = {}): EntityId {
			const camera = world.getResource(CameraResource);
			const viewport = world.getResource(ViewportResource);
			const centerX = camera.x + viewport.width / (2 * camera.zoom);
			const centerY = camera.y + viewport.height / (2 * camera.zoom);
			const archetype = archetypeRegistry.get(id);
			const widget = widgetRegistry.get(archetype?.widget ?? id);
			const size = opts.size ??
				archetype?.defaultSize ??
				widget?.defaultSize ?? { width: 100, height: 100 };
			return engine.spawn(id, {
				...opts,
				at: { x: centerX - size.width / 2, y: centerY - size.height / 2 },
			});
		},

		registerWidget(widget: W) {
			widgetRegistry.register(widget);
		},

		getWidget(type: string) {
			return widgetRegistry.get(type);
		},

		getWidgets() {
			return widgetRegistry.getAll();
		},

		registerArchetype(archetype: Archetype) {
			archetypeRegistry.register(archetype);
		},

		getArchetype(id: string) {
			return archetypeRegistry.get(id);
		},

		destroyEntity(id: EntityId) {
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

		addComponent<T>(entity: EntityId, type: ComponentType<T>, data?: T) {
			world.addComponent(entity, type, data ?? type.defaults);
			markDirtyInternal();
		},

		removeComponent(entity: EntityId, type: ComponentType) {
			world.removeComponent(entity, type);
			markDirtyInternal();
		},

		addTag(entity: EntityId, type: TagType) {
			world.addTag(entity, type);
			markDirtyInternal();
		},

		removeTag(entity: EntityId, type: TagType) {
			world.removeTag(entity, type);
			markDirtyInternal();
		},

		getSchemaFor(entity: EntityId): StandardSchemaV1 | undefined {
			const w = world.getComponent(entity, WidgetComp);
			if (!w) return undefined;
			return widgetRegistry.get(w.type)?.schema;
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

		/**
		 * Toggle the camera's `gesturing` flag. Called by gesture handlers
		 * (wheel debounced, touch pinch / pan start+end) so render layers
		 * can defer expensive work — e.g. the R3F compositor skips zoom-band
		 * repaints while gesturing is true so a continuous pinch doesn't
		 * trigger a repaint storm across every visible widget.
		 */
		setGesturing(active: boolean) {
			const camera = world.getResource(CameraResource);
			if (camera.gesturing === active) return;
			camera.gesturing = active;
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

		// === Pointer input — delegated to interaction runtime ===

		handlePointerDown(
			screenX: number,
			screenY: number,
			button: number,
			modifiers: Modifiers,
		): PointerDirective {
			return interaction.handlePointerDown(screenX, screenY, button, modifiers);
		},

		handlePointerMove(screenX: number, screenY: number, modifiers: Modifiers): PointerDirective {
			return interaction.handlePointerMove(screenX, screenY, modifiers);
		},

		handlePointerUp(): PointerDirective {
			return interaction.handlePointerUp();
		},

		handlePointerCancel(): void {
			interaction.handlePointerCancel();
		},

		// === Selection ===

		getSelectedEntities(): EntityId[] {
			return world.queryTagged(Selected);
		},

		getHoveredEntity(): EntityId | null {
			return interaction.getHoveredEntity();
		},

		// === Snap Guides ===

		getSnapGuides() {
			return interaction.getSnapGuides();
		},

		getEqualSpacing() {
			return interaction.getEqualSpacing();
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

			interaction.clearSelection();
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

			interaction.clearSelection();
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

			// Derive cursor from interaction state + hover.
			interaction.runCursorSystem();

			// Compute visible entities for renderers
			profiler.beginVisibility();
			const newVisible: VisibleEntity[] = [];
			const newVisibleSet = new Set<EntityId>();

			for (const entity of world.query(WidgetComp, Visible)) {
				const wb = world.getComponent(entity, WorldBounds);
				const widget = world.getComponent(entity, WidgetComp);
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

			newVisible.sort((a, b) => a.zIndex - b.zIndex);
			profiler.endVisibility();

			const entered: EntityId[] = [];
			const exited: EntityId[] = [];
			for (const entity of newVisibleSet) {
				if (!prevVisible.has(entity)) entered.push(entity);
			}
			for (const entity of prevVisible) {
				if (!newVisibleSet.has(entity)) exited.push(entity);
			}

			frameChanges = {
				positionsChanged: world.queryChanged(WorldBounds),
				breakpointsChanged: world.queryChanged(WidgetBreakpoint),
				entered,
				exited,
				cameraChanged: cameraChangedThisTick,
				navigationChanged: navigationChangedThisTick,
				selectionChanged: selectionChangedThisTick,
				layersChanged: world.queryChanged(Layer).length > 0,
			};

			currentVisible = newVisible;
			prevVisible = newVisibleSet;
			cameraChangedThisTick = false;
			selectionChangedThisTick = false;

			profiler.endFrame(world.entityCount, newVisible.length);

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

		getSpatialIndex(): SpatialIndex {
			return spatialIndex;
		},

		// === Events ===

		onFrame(handler: () => void): Unsubscribe {
			return world.onFrame(handler);
		},

		// === Lifecycle ===

		destroy() {
			for (const unsub of unsubscribers) {
				unsub();
			}
			unsubscribers.length = 0;

			commandBuffer.clear();

			profiler.setEnabled(false);
			profiler.clear();

			spatialIndex.clear();
		},
	};

	return engine;
}
