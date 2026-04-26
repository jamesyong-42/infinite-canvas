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
	Card,
	Container,
	ContainerCamera,
	ContainerChildren,
	CursorHint,
	Draggable,
	Dragging,
	InteractionRole,
	Layer,
	ParentFrame,
	PreDragLayer,
	Resizable,
	Selectable,
	Selected,
	SelectionFrame,
	SnapSource,
	SnapTarget,
	Transform2D,
	TransformTween,
	Visible,
	WidgetBreakpoint,
	Widget as WidgetComp,
	WidgetData,
	ZIndex,
} from '../components.js';
import { clamp, rectToAABB, screenToWorld } from '../math.js';
import {
	BreakpointConfigResource,
	CameraResource,
	CardPresetsResource,
	NavigationStackResource,
	RootCameraResource,
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
	navigationFilterSystem,
	reconcileEntityActive,
	sortSystem,
	transformTweenSystem,
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
	let snapGuidesVisible = config?.snap?.guidesVisible ?? true;

	// Register built-in systems.
	scheduler.register(cardSystem);
	scheduler.register(transformTweenSystem);
	scheduler.register(navigationFilterSystem);
	scheduler.register(cullSystem);
	scheduler.register(breakpointSystem);
	scheduler.register(sortSystem);

	const unsubscribers: Unsubscribe[] = [];

	// Wire spatial index reactively via observer instead of per-frame scan.
	// Post-RFC-004 Phase 0b: Transform2D is the single source of truth for
	// entity bounds — no more WorldBounds shadow.
	unsubscribers.push(
		world.onComponentChanged(Transform2D, (entityId, _prev, t) => {
			if (t) {
				spatialIndex.upsert(entityId, rectToAABB(t));
			}
		}),
	);

	unsubscribers.push(
		world.onEntityDestroyed((entity) => {
			spatialIndex.remove(entity);
		}),
	);

	// Auto-attach ContainerCamera on Container-tag add, so every container
	// entity has a usable camera component from birth (serialization round-
	// trips cleanly; enterContainer can read without falling back). The
	// prev === undefined guard scopes this to component *adds* only —
	// updates of an existing Container value do not re-stamp a fresh camera.
	unsubscribers.push(
		world.onComponentChanged(Container, (entityId, prev, next) => {
			if (prev === undefined && next !== undefined) {
				if (!world.hasComponent(entityId, ContainerCamera)) {
					world.addComponent(entityId, ContainerCamera, { x: 0, y: 0, zoom: 1 });
				}
			}
		}),
	);

	// RFC-004 § Phase 5 — keep `Active` in sync with mid-session
	// ParentFrame mutations. Covers the consume path (child gets
	// `ParentFrame`, should leave the current frame), re-parent (id
	// changes), and undo (ParentFrame removed, child returns to root).
	// Without this, a consumed card retains `Active` at root until the
	// next nav-stack change and renders visibly on top of its own
	// container. The nav-stack-change branch of `navigationFilterSystem`
	// still handles the full refilter when the user navigates.
	unsubscribers.push(
		world.onComponentChanged(ParentFrame, (entityId) => {
			reconcileEntityActive(world, entityId);
			markDirtyInternal();
		}),
	);

	// Auto-attach InteractionRole and CursorHint based on Draggable/Selectable
	// tag presence. Entities with an explicit non-drag/non-select role
	// (rotate/connect/etc.) are left alone.
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

	// Drag-promote (RFC-003): while a DOM card is dragged, hoist it to
	// the 'overlay' layer so it visually pops above the R3F canvas.
	//
	// Gated on the `Card` component. R3F cards skip promotion — they
	// handle their own stacking via the compositor (uDraggedRect clip +
	// renderOrder bump). DOM widgets without Card are bare debug-style
	// surfaces that shouldn't acquire card-shaped affordances.
	unsubscribers.push(
		world.onTagAdded(Dragging, (entity) => {
			if (world.hasComponent(entity, PreDragLayer)) return;
			if (!world.hasComponent(entity, Card)) return;
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
		zIndicesChanged: [],
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
		// RFC-004 § Phase 3 — the overlap pass consults the parent widget
		// type's `canAccept` gate (when present) before flagging
		// `OverlapTarget`. Non-card / unregistered widgets fall through
		// to "no gate, static contract check only."
		getWidgetInteraction: (type: string) => widgetRegistry.get(type)?.interaction,
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
				inits.push([ParentFrame, { id: opts.parent }]);
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
							snapSource: false,
							snapTarget: false,
						}
					: interactiveConfig === undefined || interactiveConfig === true
						? {
								selectable: true,
								draggable: true,
								resizable: true,
								selectionFrame: true,
								snapSource: true,
								snapTarget: true,
							}
						: (() => {
								const selectable = interactiveConfig.selectable ?? false;
								return {
									selectable,
									draggable: interactiveConfig.draggable ?? false,
									resizable: interactiveConfig.resizable ?? false,
									selectionFrame: interactiveConfig.selectionFrame ?? selectable,
									snapSource: interactiveConfig.snapSource ?? false,
									snapTarget: interactiveConfig.snapTarget ?? false,
								};
							})();
			if (caps.selectable) inits.push([Selectable]);
			if (caps.draggable) inits.push([Draggable]);
			if (caps.resizable) inits.push([Resizable]);
			if (caps.selectionFrame) inits.push([SelectionFrame]);
			if (caps.snapSource) inits.push([SnapSource]);
			if (caps.snapTarget) inits.push([SnapTarget]);

			if (archetype?.tags) {
				for (const tag of archetype.tags) inits.push([tag]);
			}

			const entity = engine.createEntity(inits);

			// RFC-004 § Phase 5 open question 7 — a runtime spawn inside a
			// container must push onto the parent's `ContainerChildren.ids`
			// so the two-way ParentFrame ↔ ContainerChildren invariant is
			// upheld on the spawn path (consume already does this via
			// `applyMutation`). Only touches a container that actually has
			// the component attached — widgets outside the Phase 5 pattern
			// use `ParentFrame` without `ContainerChildren` and are left
			// alone.
			if (opts.parent !== undefined && world.hasComponent(opts.parent, ContainerChildren)) {
				const current = world.getComponent(opts.parent, ContainerChildren);
				if (current && !current.ids.includes(entity)) {
					world.setComponent(opts.parent, ContainerChildren, {
						ids: [...current.ids, entity],
					});
				}
			}

			return entity;
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
				const t = world.getComponent(e, Transform2D);
				if (!t) continue;
				minX = Math.min(minX, t.x);
				minY = Math.min(minY, t.y);
				maxX = Math.max(maxX, t.x + t.width);
				maxY = Math.max(maxY, t.y + t.height);
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

		pickAt(screenX: number, screenY: number): EntityId | null {
			return interaction.pickAt(screenX, screenY);
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
			markDirtyInternal();
		},

		setSnapThreshold(worldPx: number) {
			snapThreshold = worldPx;
			markDirtyInternal();
		},

		getSnapGuidesVisible() {
			return snapGuidesVisible;
		},

		setSnapGuidesVisible(on: boolean) {
			snapGuidesVisible = on;
			markDirtyInternal();
		},

		// === Navigation ===

		enterContainer(entity: EntityId) {
			// Only Container-tagged entities are enterable. An empty container
			// (no Children component yet) is still allowed — you enter it and
			// see an empty sub-canvas, which is consistent with a just-created
			// container that will be populated later.
			if (!world.hasComponent(entity, Container)) return;

			const navStack = world.getResource(NavigationStackResource);
			const camera = world.getResource(CameraResource);

			// Snapshot the outgoing frame's camera to its home so navigating
			// back restores the same view.
			const outgoing = navStack.frames[navStack.frames.length - 1].containerId;
			if (outgoing === null) {
				world.setResource(RootCameraResource, {
					x: camera.x,
					y: camera.y,
					zoom: camera.zoom,
				});
			} else {
				world.setComponent(outgoing, ContainerCamera, {
					x: camera.x,
					y: camera.y,
					zoom: camera.zoom,
				});
			}

			navStack.frames.push({ containerId: entity });
			navStack.changed = true;

			// Restore the incoming container's camera (default to origin +
			// 1× if the container has never been entered before).
			const incoming = world.getComponent(entity, ContainerCamera) ?? {
				x: 0,
				y: 0,
				zoom: 1,
			};
			camera.x = incoming.x;
			camera.y = incoming.y;
			camera.zoom = incoming.zoom;

			interaction.clearSelection();
			cameraChangedThisTick = true;
			markDirtyInternal();
		},

		exitContainer() {
			const navStack = world.getResource(NavigationStackResource);
			if (navStack.frames.length <= 1) return;

			const camera = world.getResource(CameraResource);

			// Snapshot the outgoing container's camera so re-entering later
			// restores the view.
			const outgoing = navStack.frames[navStack.frames.length - 1].containerId;
			if (outgoing !== null) {
				world.setComponent(outgoing, ContainerCamera, {
					x: camera.x,
					y: camera.y,
					zoom: camera.zoom,
				});
			}

			navStack.frames.pop();
			navStack.changed = true;

			// Load the newly-current frame's camera (parent container or root).
			const parent = navStack.frames[navStack.frames.length - 1].containerId;
			const incoming =
				parent === null
					? world.getResource(RootCameraResource)
					: (world.getComponent(parent, ContainerCamera) ?? { x: 0, y: 0, zoom: 1 });
			camera.x = incoming.x;
			camera.y = incoming.y;
			camera.zoom = incoming.zoom;

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

			// INVARIANT (RFC-004 Phase 0c): capture `navStack.changed` into a
			// local `const` BEFORE `scheduler.execute` runs. `navigationFilter`
			// mutates `navStack.changed = false` mid-tick as its reset signal;
			// reading the flag after systems execute would always see false
			// and this-tick navigation pushes/pops would silently miss their
			// FrameChanges.navigationChanged notification. Do not reorder.
			const navStackPreTick = world.getResource(NavigationStackResource);
			const navigationChangedThisTick = navStackPreTick?.changed ?? false;

			// Run all systems
			scheduler.execute(world);

			// RFC-004 § Phase 4 — fly-back completion poll. Runs after the
			// tween system so an in-flight tween has had a chance to
			// remove itself this tick; if it's gone and we're still in
			// `flyingBack` mode, finalize (remove Dragging, restore ZIndex).
			interaction.runFlyBackSystem();

			// Derive cursor from interaction state + hover.
			interaction.runCursorSystem();

			// Compute visible entities for renderers
			profiler.beginVisibility();
			const newVisible: VisibleEntity[] = [];
			const newVisibleSet = new Set<EntityId>();

			for (const entity of world.query(WidgetComp, Visible)) {
				const t = world.getComponent(entity, Transform2D);
				const widget = world.getComponent(entity, WidgetComp);
				const bp = world.getComponent(entity, WidgetBreakpoint);
				const zIdx = world.getComponent(entity, ZIndex);
				if (!t || !widget) continue;

				newVisibleSet.add(entity);
				newVisible.push({
					entityId: entity,
					x: t.x,
					y: t.y,
					width: t.width,
					height: t.height,
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
				positionsChanged: world.queryChanged(Transform2D),
				breakpointsChanged: world.queryChanged(WidgetBreakpoint),
				zIndicesChanged: world.queryChanged(ZIndex),
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

			// RFC-004 § Phase 2/4 — keep the rAF loop alive while any
			// `TransformTween` is still running. The `Transform2D` reactive
			// observer deliberately skips `markDirty` (it only refreshes the
			// spatial index), so a tween's own Transform2D writes don't
			// re-dirty the engine. Without this post-reset re-dirty, the
			// engine would tick once into the animation and then freeze the
			// card mid-fly-back. Cheap: bails after one iteration.
			for (const _ of world.query(TransformTween)) {
				dirty = true;
				break;
			}
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
