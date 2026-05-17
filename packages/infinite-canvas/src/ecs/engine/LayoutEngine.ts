import type {
	ComponentInit,
	ComponentType,
	EntityId,
	SystemDef,
	TagType,
	Unsubscribe,
	World,
} from '@jamesyong42/reactive-ecs';
import { createWorld, PhasedScheduler } from '@jamesyong42/reactive-ecs';
import { Profiler } from '../../profiler/Profiler.js';
import type { Archetype, ArchetypeRegistry, SpawnOptions } from '../archetype.js';
import { createArchetypeRegistry } from '../archetype.js';
import type { Command } from '../commands.js';
import { CommandBuffer } from '../commands.js';
import {
	Active,
	Container,
	ContainerCamera,
	ContainerChildren,
	Draggable,
	ParentFrame,
	Resizable,
	Selectable,
	Selected,
	SelectionFrame,
	SnapSource,
	SnapTarget,
	Transform2D,
	Widget as WidgetComp,
	WidgetData,
	ZIndex,
} from '../components.js';
import { clamp, rectToAABB, screenToWorld } from '../math.js';
import {
	BreakpointConfigResource,
	CameraResource,
	CardPresetsResource,
	EngineDirtyResource,
	FrameChangesResource,
	NavigationStackResource,
	RootCameraResource,
	SpatialIndexResource,
	TickFlagsResource,
	ViewportResource,
	VisibleEntitiesResource,
	ZoomConfigResource,
} from '../resources.js';
import type { StandardSchemaV1 } from '../schema.js';
import { SpatialIndex } from '../spatial/SpatialIndex.js';
import {
	breakpointSystem,
	cardSystem,
	clearDirtySystem,
	containerCameraSystem,
	cullSystem,
	dragPromoteSystem,
	emitFrameSystem,
	frameChangesSystem,
	incrementTickSystem,
	navigationFilterSystem,
	navStackCaptureSystem,
	parentFrameActiveSystem,
	roleRefreshSystem,
	sortSystem,
	transformTweenSystem,
	tweenKeepaliveSystem,
	visibilitySystem,
} from '../systems/index.js';
import { createInteractionRuntime } from './interaction.js';
import { ENGINE_PHASES } from './phases.js';
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
	const rawWorld = createWorld();

	// RFC-010 Phase 5 — mutation-observing proxy. Any entity / component /
	// tag mutation auto-sets `EngineDirtyResource`, so the engine's CRUD
	// methods, command undo/redo, interaction.ts, and devtools no longer
	// need explicit `markDirty()` calls. Resource-level changes (camera
	// in-place mutation, `setResource` for viewport / navigation, snap
	// closure flags) are NOT caught here — those keep their explicit
	// `markDirtyInternal()` (see the camera / viewport / nav methods).
	// `setResource` is deliberately not proxied: it would recurse on the
	// `EngineDirtyResource` write below and fire on every system's
	// per-tick resource writes.
	const DIRTYING_METHODS = new Set([
		'createEntity',
		'destroyEntity',
		'addComponent',
		'removeComponent',
		'setComponent',
		'addTag',
		'removeTag',
	]);
	const world = new Proxy(rawWorld, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && DIRTYING_METHODS.has(prop)) {
				const fn = Reflect.get(target, prop, target) as (...a: unknown[]) => unknown;
				return (...args: unknown[]) => {
					const result = fn.apply(target, args);
					rawWorld.setResource(EngineDirtyResource, { dirty: true });
					return result;
				};
			}
			return Reflect.get(target, prop, receiver);
		},
	}) as World;

	const scheduler = new PhasedScheduler({
		phases: ENGINE_PHASES,
		defaultPhase: 'derive',
	});
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

	// Register built-in systems. `flyBackSystem` / `cursorSystem` are
	// registered after the interaction runtime is created (they capture
	// its closure state).
	scheduler.register(navStackCaptureSystem); // input
	scheduler.register(dragPromoteSystem); // react
	scheduler.register(containerCameraSystem); // react
	scheduler.register(parentFrameActiveSystem); // react
	scheduler.register(roleRefreshSystem); // react
	scheduler.register(navigationFilterSystem); // control
	scheduler.register(transformTweenSystem); // simulate
	scheduler.register(cardSystem); // derive
	scheduler.register(cullSystem); // derive
	scheduler.register(breakpointSystem); // derive
	scheduler.register(sortSystem); // derive
	scheduler.register(visibilitySystem); // present
	scheduler.register(frameChangesSystem); // present
	scheduler.register(clearDirtySystem); // cleanup
	scheduler.register(incrementTickSystem); // cleanup
	scheduler.register(emitFrameSystem); // cleanup
	scheduler.register(tweenKeepaliveSystem); // cleanup

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

	// RFC-010 Phase 3 — the former imperative observers
	//   - `Container` add → `ContainerCamera` auto-attach
	//   - `ParentFrame` change → `reconcileEntityActive`
	//   - `Draggable`/`Selectable` add/remove → `refreshInteractionRole`
	// now live as `react`-phase systems (`containerCameraSystem`,
	// `parentFrameActiveSystem`, `roleRefreshSystem`), registered above.
	// Drag-promote (RFC-010 Phase 1) is also a `react`-phase system.
	// All five remaining observers in this file went away with that
	// migration; what stays is the two-handler sync-reactive bus for the
	// spatial index (Transform2D upsert + onEntityDestroyed) above.

	// Pre-register widgets and archetypes from config
	if (config?.widgets) {
		for (const w of config.widgets) widgetRegistry.register(w);
	}
	if (config?.archetypes) {
		for (const a of config.archetypes) archetypeRegistry.register(a);
	}

	// Initialize navigation — mark root entities as Active on first tick
	world.setResource(NavigationStackResource, { changed: true });

	// RFC-010 Phase 4 — per-frame state lives in resources, not closure
	// vars, so the `present` / `cleanup` phase systems can read & write it:
	//   EngineDirtyResource    — the rAF-gate dirty flag
	//   TickFlagsResource      — camera/selection/navigation per-tick flags
	//   VisibleEntitiesResource — visibilitySystem output (+ prev set)
	//   FrameChangesResource   — frameChangesSystem output
	// All four have defaults, so no explicit initialization is needed.

	function markDirtyInternal() {
		world.setResource(EngineDirtyResource, { dirty: true });
	}

	function markCameraChanged() {
		world.setResource(TickFlagsResource, { cameraChanged: true });
	}

	// Compose the pointer / selection state machine.
	const interaction = createInteractionRuntime({
		world,
		spatialIndex,
		commandBuffer,
		markDirty: markDirtyInternal,
		notifySelectionChanged: () => {
			world.setResource(TickFlagsResource, { selectionChanged: true });
		},
		getSnapEnabled: () => snapEnabled,
		getSnapThreshold: () => snapThreshold,
		// RFC-004 § Phase 3 — the overlap pass consults the parent widget
		// type's `canAccept` gate (when present) before flagging
		// `OverlapTarget`. Non-card / unregistered widgets fall through
		// to "no gate, static contract check only."
		getWidgetInteraction: (type: string) => widgetRegistry.get(type)?.interaction,
	});

	// `control`-phase systems that capture the interaction runtime closure
	// (RFC-010 Phase 4 — formerly `interaction.runFlyBackSystem()` /
	// `runCursorSystem()` called inline after `scheduler.execute`).
	scheduler.register(interaction.flyBackSystem);
	scheduler.register(interaction.cursorSystem);

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
			// Mutation proxy auto-dirties (RFC-010 Phase 5).
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
			world.destroyEntity(id); // mutation proxy auto-dirties
		},

		get<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
			return world.getComponent(entity, type);
		},

		set<T>(entity: EntityId, type: ComponentType<T>, data: Partial<T>) {
			world.setComponent(entity, type, data); // mutation proxy auto-dirties
		},

		has(entity: EntityId, type: ComponentType | TagType): boolean {
			if (type.__kind === 'tag') return world.hasTag(entity, type as TagType);
			return world.hasComponent(entity, type as ComponentType);
		},

		addComponent<T>(entity: EntityId, type: ComponentType<T>, data?: T) {
			world.addComponent(entity, type, data ?? type.defaults); // proxy auto-dirties
		},

		removeComponent(entity: EntityId, type: ComponentType) {
			world.removeComponent(entity, type); // mutation proxy auto-dirties
		},

		addTag(entity: EntityId, type: TagType) {
			world.addTag(entity, type); // mutation proxy auto-dirties
		},

		removeTag(entity: EntityId, type: TagType) {
			world.removeTag(entity, type); // mutation proxy auto-dirties
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
			markCameraChanged();
			markDirtyInternal();
		},

		panTo(worldX: number, worldY: number) {
			const camera = world.getResource(CameraResource);
			const viewport = world.getResource(ViewportResource);
			camera.x = worldX - viewport.width / (2 * camera.zoom);
			camera.y = worldY - viewport.height / (2 * camera.zoom);
			markCameraChanged();
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
			markCameraChanged();
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
			markCameraChanged();
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
			markCameraChanged();
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
			markCameraChanged();
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
			// Commands mutate via the proxied world, which auto-dirties when
			// `did` (RFC-010 Phase 5).
			return commandBuffer.undo(world);
		},

		redo(): boolean {
			return commandBuffer.redo(world);
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

		hitTest(screenX, screenY) {
			return interaction.hitTest(screenX, screenY);
		},

		// === RFC-008 Phase 3b — engine input API ===

		beginDrag(entity, worldX, worldY) {
			interaction.beginDrag(entity, worldX, worldY);
		},
		updateDrag(entity, worldX, worldY) {
			interaction.updateDrag(entity, worldX, worldY);
		},
		endDrag(entity, opts) {
			interaction.endDrag(entity, opts);
		},
		getDraggingEntity() {
			return interaction.getDraggingEntity();
		},

		cancelInteraction() {
			interaction.cancelInteraction();
		},

		beginResize(entity, handle, worldX, worldY) {
			return interaction.beginResize(entity, handle, worldX, worldY);
		},
		updateResize(entity, worldX, worldY) {
			interaction.updateResize(entity, worldX, worldY);
		},
		endResize(entity, opts) {
			interaction.endResize(entity, opts);
		},
		isResizing() {
			return interaction.isResizing();
		},
		getResizingEntity() {
			return interaction.getResizingEntity();
		},

		beginMarquee(worldX, worldY) {
			interaction.beginMarquee(worldX, worldY);
		},
		updateMarquee(worldX, worldY) {
			interaction.updateMarquee(worldX, worldY);
		},
		endMarquee() {
			interaction.endMarquee();
		},
		isMarqueeActive() {
			return interaction.isMarqueeActive();
		},

		// === Selection ===

		getSelectedEntities(): EntityId[] {
			return world.queryTagged(Selected);
		},

		selectEntity(entity: EntityId, additive: boolean): void {
			interaction.selectEntity(entity, additive);
		},

		clearSelection(): void {
			interaction.clearSelection();
		},

		getHoveredEntity(): EntityId | null {
			return interaction.getHoveredEntity();
		},

		setHoveredEntity(entity: EntityId | null): void {
			interaction.setHoveredEntity(entity);
		},

		updateHover(screenX: number, screenY: number): void {
			interaction.updateHover(screenX, screenY);
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
			markCameraChanged();
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
			markCameraChanged();
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

		// RFC-010 Phase 5 — external callers use this to signal that
		// *non-ECS* state changed (CSS vars, WebGL/shader uniforms) and the
		// present pipeline should re-run. ECS mutations no longer need it —
		// the mutation proxy auto-dirties.
		invalidatePresent() {
			markDirtyInternal();
		},

		profiler,

		// RFC-010 Phase 4 — the entire former inline tail
		// (navStack capture, fly-back/cursor, visibility build,
		// FrameChanges assembly, clearDirty/incrementTick/emitFrame,
		// tween keepalive) is now phase-ordered systems run by the
		// PhasedScheduler. `tick()` is just the profiler frame bracket
		// around `scheduler.execute`.
		tick() {
			profiler.beginFrame(world.currentTick);
			scheduler.execute(world);
			profiler.endFrame(
				world.entityCount,
				world.getResource(VisibleEntitiesResource).current.length,
			);
		},

		flushIfDirty(): boolean {
			if (!world.getResource(EngineDirtyResource).dirty) return false;
			engine.tick();
			return true;
		},

		// === Output ===

		getVisibleEntities(): VisibleEntity[] {
			return world.getResource(VisibleEntitiesResource).current;
		},

		getFrameChanges(): FrameChanges {
			return world.getResource(FrameChangesResource).changes;
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
