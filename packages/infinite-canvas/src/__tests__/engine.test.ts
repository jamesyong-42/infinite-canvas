import { describe, expect, it } from 'vitest';
import {
	Active,
	Children,
	Container,
	CursorHint,
	CursorResource,
	createLayoutEngine,
	Draggable,
	Dragging,
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
} from '../index.js';

function createTestEngine() {
	const engine = createLayoutEngine();
	engine.setViewport(1000, 800);
	return engine;
}

function createWidget(
	engine: ReturnType<typeof createLayoutEngine>,
	x: number,
	y: number,
	width = 200,
	height = 150,
) {
	// Draggable / Selectable trigger the reactive auto-attach in the engine,
	// so no explicit InteractionRole or CursorHint push is needed — exactly
	// like user code that bypasses addWidget().
	return engine.createEntity([
		[Transform2D, { x, y, width, height, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'debug' }],
		[WidgetData, { data: { title: 'Test' } }],
		[ZIndex, { value: 0 }],
		[Selectable],
		[Draggable],
		[Resizable],
	]);
}

describe('CanvasEngine', () => {
	describe('entity creation', () => {
		it('creates entities with component inits', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 200);

			expect(engine.get(e, Transform2D)).toEqual({
				x: 100,
				y: 200,
				width: 200,
				height: 150,
				rotation: 0,
			});
			expect(engine.get(e, Widget)).toEqual({ surface: 'dom', type: 'debug' });
			expect(engine.has(e, Selectable)).toBe(true);
			expect(engine.has(e, Draggable)).toBe(true);
		});
	});

	describe('tick and visibility', () => {
		it('marks root entities as Active on first tick', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100);
			engine.tick();

			expect(engine.world.hasTag(e, Active)).toBe(true);
		});

		it('marks in-viewport entities as Visible', () => {
			const engine = createTestEngine();
			const inView = createWidget(engine, 100, 100);
			const outOfView = createWidget(engine, 5000, 5000);
			engine.tick();

			expect(engine.world.hasTag(inView, Visible)).toBe(true);
			expect(engine.world.hasTag(outOfView, Visible)).toBe(false);
		});

		it('returns visible entities sorted by z-index', () => {
			const engine = createTestEngine();
			const e1 = createWidget(engine, 100, 100);
			engine.set(e1, ZIndex, { value: 2 });
			const e2 = createWidget(engine, 200, 100);
			engine.set(e2, ZIndex, { value: 1 });
			engine.tick();

			const visible = engine.getVisibleEntities();
			expect(visible.length).toBe(2);
			expect(visible[0].entityId).toBe(e2); // z=1 first
			expect(visible[1].entityId).toBe(e1); // z=2 second
		});
	});

	describe('camera', () => {
		it('pans the camera', () => {
			const engine = createTestEngine();
			engine.panBy(100, 50); // screen pixels
			const cam = engine.getCamera();
			expect(cam.x).toBe(-100); // moved left in world space
			expect(cam.y).toBe(-50);
		});

		it('zooms at cursor point', () => {
			const engine = createTestEngine();
			const camBefore = { ...engine.getCamera() };
			engine.zoomAtPoint(500, 400, 0.5); // zoom in 50% at center
			const camAfter = engine.getCamera();

			expect(camAfter.zoom).toBeGreaterThan(camBefore.zoom);
			// The world point under (500,400) should stay approximately the same
		});

		it('clamps zoom to configured range', () => {
			const engine = createLayoutEngine({ zoom: { min: 0.5, max: 2.0 } });
			engine.setViewport(1000, 800);
			engine.zoomTo(0.1); // below min
			expect(engine.getCamera().zoom).toBe(0.5);
			engine.zoomTo(10); // above max
			expect(engine.getCamera().zoom).toBe(2.0);
		});
	});

	describe('breakpoints', () => {
		it('computes breakpoints based on screen size', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 300, 200);
			engine.tick();

			// At zoom=1, width=300 → 300 screen pixels → 'normal' (120 < 300 < 500)
			const bp = engine.get(e, WidgetBreakpoint);
			expect(bp?.current).toBe('normal');
		});

		it('changes breakpoint when zooming', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 300, 200);
			engine.tick();
			expect(engine.get(e, WidgetBreakpoint)?.current).toBe('normal');

			// Zoom out far — 300 * 0.1 = 30px → micro
			engine.zoomTo(0.1);
			engine.tick();
			expect(engine.get(e, WidgetBreakpoint)?.current).toBe('micro');

			// Zoom in — 300 * 3 = 900px → expanded
			engine.zoomTo(3);
			engine.tick();
			expect(engine.get(e, WidgetBreakpoint)?.current).toBe('expanded');
		});
	});

	describe('pointer input', () => {
		it('selects entity on click', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			// Click inside the widget (world coords = screen coords at zoom=1)
			engine.handlePointerDown(150, 150, 0, { shift: false, ctrl: false, alt: false, meta: false });
			expect(engine.getSelectedEntities()).toContain(e);
		});

		it('clears selection on empty canvas click', () => {
			const engine = createTestEngine();
			createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			// Select it
			engine.handlePointerDown(150, 150, 0, { shift: false, ctrl: false, alt: false, meta: false });
			expect(engine.getSelectedEntities()).toHaveLength(1);

			engine.tick();

			// Click empty space
			engine.handlePointerDown(800, 700, 0, { shift: false, ctrl: false, alt: false, meta: false });
			expect(engine.getSelectedEntities()).toHaveLength(0);
		});

		it('drags entity after dead zone', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			const mods = { shift: false, ctrl: false, alt: false, meta: false };

			// Pointer down on widget
			engine.handlePointerDown(150, 150, 0, mods);

			// Move within dead zone — no drag
			const d1 = engine.handlePointerMove(152, 151, mods);
			expect(d1.action).toBe('passthrough');

			// Move past dead zone — drag starts
			const d2 = engine.handlePointerMove(160, 160, mods);
			expect(d2.action).toBe('capture-drag');

			// Continue dragging
			engine.handlePointerMove(200, 200, mods);
			engine.tick();

			const t = engine.get(e, Transform2D);
			expect(t).toBeDefined();
			if (!t) throw new Error('Transform2D component missing');
			expect(t.x).toBeGreaterThan(100); // moved
			expect(t.y).toBeGreaterThan(100);
		});

		describe('Dragging state tag', () => {
			const mods = { shift: false, ctrl: false, alt: false, meta: false };

			it('is absent before drag start', () => {
				const engine = createTestEngine();
				const e = createWidget(engine, 100, 100, 200, 150);
				engine.tick();
				expect(engine.has(e, Dragging)).toBe(false);

				// Pointer down + dead-zone-only move should NOT set the tag.
				engine.handlePointerDown(150, 150, 0, mods);
				engine.handlePointerMove(152, 151, mods);
				expect(engine.has(e, Dragging)).toBe(false);
			});

			it('is added once the drag dead zone is crossed', () => {
				const engine = createTestEngine();
				const e = createWidget(engine, 100, 100, 200, 150);
				engine.tick();

				engine.handlePointerDown(150, 150, 0, mods);
				engine.handlePointerMove(160, 160, mods); // past dead zone
				expect(engine.has(e, Dragging)).toBe(true);
			});

			it('is removed on pointer up', () => {
				const engine = createTestEngine();
				const e = createWidget(engine, 100, 100, 200, 150);
				engine.tick();

				engine.handlePointerDown(150, 150, 0, mods);
				engine.handlePointerMove(160, 160, mods);
				expect(engine.has(e, Dragging)).toBe(true);

				engine.handlePointerUp();
				expect(engine.has(e, Dragging)).toBe(false);
			});

			it('is removed on pointer cancel', () => {
				const engine = createTestEngine();
				const e = createWidget(engine, 100, 100, 200, 150);
				engine.tick();

				engine.handlePointerDown(150, 150, 0, mods);
				engine.handlePointerMove(160, 160, mods);
				expect(engine.has(e, Dragging)).toBe(true);

				engine.handlePointerCancel();
				expect(engine.has(e, Dragging)).toBe(false);
			});

			it('covers every selected entity in a multi-drag', () => {
				const engine = createTestEngine();
				const a = createWidget(engine, 100, 100, 200, 150);
				const b = createWidget(engine, 400, 100, 200, 150);
				engine.tick();

				// Select both (shift-click second).
				engine.handlePointerDown(150, 150, 0, mods);
				engine.handlePointerUp();
				engine.handlePointerDown(450, 150, 0, { ...mods, shift: true });
				engine.handlePointerMove(460, 160, { ...mods, shift: true }); // drag starts

				expect(engine.has(a, Dragging)).toBe(true);
				expect(engine.has(b, Dragging)).toBe(true);

				engine.handlePointerUp();
				expect(engine.has(a, Dragging)).toBe(false);
				expect(engine.has(b, Dragging)).toBe(false);
			});
		});
	});

	describe('navigation', () => {
		it('enters and exits containers', () => {
			const engine = createTestEngine();

			// Create a container with children
			const container = engine.createEntity([
				[Transform2D, { x: 100, y: 100, width: 600, height: 400, rotation: 0 }],
				[Widget, { surface: 'dom', type: 'container' }],
				[Container, { enterable: true }],
				[Children, { ids: [] as number[] }],
				[Selectable],
			]);

			const child = engine.createEntity([
				[Transform2D, { x: 50, y: 50, width: 200, height: 100, rotation: 0 }],
				[Widget, { surface: 'dom', type: 'debug' }],
				[Parent, { id: container }],
				[ZIndex, { value: 0 }],
			]);

			// Update children list
			engine.set(container, Children, { ids: [child] });

			engine.tick();

			// At root, container is Active, child is not
			expect(engine.world.hasTag(container, Active)).toBe(true);
			expect(engine.world.hasTag(child, Active)).toBe(false);

			// Enter container
			engine.enterContainer(container);
			engine.tick();

			expect(engine.getNavigationDepth()).toBe(1);
			expect(engine.getActiveContainer()).toBe(container);
			// Now child is Active, container is not
			expect(engine.world.hasTag(child, Active)).toBe(true);
			expect(engine.world.hasTag(container, Active)).toBe(false);

			// Exit
			engine.exitContainer();
			engine.tick();

			expect(engine.getNavigationDepth()).toBe(0);
			expect(engine.getActiveContainer()).toBeNull();
			expect(engine.world.hasTag(container, Active)).toBe(true);
			expect(engine.world.hasTag(child, Active)).toBe(false);
		});
	});

	describe('frame changes', () => {
		it('tracks entered/exited entities', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100);

			engine.tick();
			const changes = engine.getFrameChanges();
			expect(changes.entered).toContain(e);

			engine.tick();
			const changes2 = engine.getFrameChanges();
			expect(changes2.entered).toHaveLength(0); // no new entities
		});

		it('tracks camera changes', () => {
			const engine = createTestEngine();
			engine.tick();

			engine.panBy(10, 10);
			engine.tick();
			expect(engine.getFrameChanges().cameraChanged).toBe(true);

			engine.tick();
			expect(engine.getFrameChanges().cameraChanged).toBe(false);
		});
	});

	describe('handle sync (RFC-001 Phase 4)', () => {
		it('spawns 8 resize handles when a single resizable is selected', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			// Select directly via tag — avoids going through pointer events.
			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			expect(handleSet).toBeDefined();
			expect(handleSet?.ids.length).toBe(8);

			for (const id of handleSet?.ids ?? []) {
				expect(engine.world.entityExists(id)).toBe(true);
				expect(engine.has(id, Hitbox)).toBe(true);
				expect(engine.has(id, InteractionRole)).toBe(true);
				expect(engine.has(id, CursorHint)).toBe(true);
				expect(engine.has(id, Parent)).toBe(true);

				const role = engine.get(id, InteractionRole);
				expect(role?.role.type).toBe('resize');

				const parent = engine.get(id, Parent);
				expect(parent?.id).toBe(e);
			}
		});

		it('despawns handles when selection is cleared', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			expect(handleSet?.ids.length).toBe(8);
			const handleIds = [...(handleSet?.ids ?? [])];

			// Deselect
			engine.world.removeTag(e, Selected);
			engine.tick();

			expect(engine.has(e, HandleSet)).toBe(false);
			for (const id of handleIds) {
				expect(engine.world.entityExists(id)).toBe(false);
			}
		});

		it('does not spawn handles when multiple resizables are selected', () => {
			const engine = createTestEngine();
			const e1 = createWidget(engine, 100, 100, 200, 150);
			const e2 = createWidget(engine, 400, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e1, Selected);
			engine.world.addTag(e2, Selected);
			engine.tick();

			expect(engine.has(e1, HandleSet)).toBe(false);
			expect(engine.has(e2, HandleSet)).toBe(false);
		});

		it('handles track parent bounds when resized', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			expect(handleSet).toBeDefined();

			// Find the SE handle (anchorX=1, anchorY=1)
			let seId: number | null = null;
			for (const id of handleSet?.ids ?? []) {
				const role = engine.get(id, InteractionRole);
				if (role?.role.type === 'resize' && role.role.handle === 'se') {
					seId = id;
					break;
				}
			}
			expect(seId).not.toBeNull();
			if (seId === null) return;

			// Clone because getComponent returns the live reference — setComponent
			// mutates in place, so holding a raw reference across a tick is unsafe.
			const beforeWBRaw = engine.get(seId, WorldBounds);
			expect(beforeWBRaw).toBeDefined();
			if (!beforeWBRaw) return;
			const beforeWB = { ...beforeWBRaw };

			// Resize the parent: width 200 -> 300 (+100 in X)
			engine.set(e, Transform2D, { width: 300 });
			engine.tick();

			const afterWBRaw = engine.get(seId, WorldBounds);
			expect(afterWBRaw).toBeDefined();
			if (!afterWBRaw) return;
			const afterWB = { ...afterWBRaw };

			expect(afterWB.worldX - beforeWB.worldX).toBeCloseTo(100, 5);
			expect(afterWB.worldY).toBeCloseTo(beforeWB.worldY, 5);
		});

		it('cascades destroy through HandleSet', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			expect(handleSet?.ids.length).toBe(8);
			const handleIds = [...(handleSet?.ids ?? [])];

			engine.destroyEntity(e);

			for (const id of handleIds) {
				expect(engine.world.entityExists(id)).toBe(false);
			}
			expect(engine.world.entityExists(e)).toBe(false);
		});

		it('grows the spatial index by 8 on selection', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			const sizeBefore = engine.getSpatialIndex().size;

			engine.world.addTag(e, Selected);
			engine.tick();

			const sizeAfter = engine.getSpatialIndex().size;
			expect(sizeAfter - sizeBefore).toBe(8);
		});

		it('spawns handles after dropping from double to single selection', () => {
			const engine = createTestEngine();
			const e1 = createWidget(engine, 100, 100, 200, 150);
			const e2 = createWidget(engine, 400, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e1, Selected);
			engine.world.addTag(e2, Selected);
			engine.tick();

			// Neither has handles yet.
			expect(engine.has(e1, HandleSet)).toBe(false);
			expect(engine.has(e2, HandleSet)).toBe(false);

			// Drop to single selection.
			engine.world.removeTag(e2, Selected);
			engine.tick();

			expect(engine.has(e1, HandleSet)).toBe(true);
			expect(engine.get(e1, HandleSet)?.ids.length).toBe(8);
		});
	});

	describe('unified hit test (RFC-001 Phase 5)', () => {
		const mods = { shift: false, ctrl: false, alt: false, meta: false };

		it('click on widget body hits drag role', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			// Click at widget center (world == screen at zoom 1).
			const directive = engine.handlePointerDown(200, 175, 0, mods);
			expect(directive.action).toBe('passthrough-track-drag');
			expect(engine.getSelectedEntities()).toContain(e);
		});

		it('click on resize handle hits resize role', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			// Select first so handles spawn.
			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			expect(handleSet?.ids.length).toBe(8);

			// Find the SE handle and click at its world-space center.
			let seId: number | null = null;
			for (const id of handleSet?.ids ?? []) {
				const role = engine.get(id, InteractionRole);
				if (role?.role.type === 'resize' && role.role.handle === 'se') {
					seId = id;
					break;
				}
			}
			expect(seId).not.toBeNull();
			if (seId === null) return;

			const wb = engine.get(seId, WorldBounds);
			expect(wb).toBeDefined();
			if (!wb) return;
			const cx = wb.worldX + wb.worldWidth / 2;
			const cy = wb.worldY + wb.worldHeight / 2;

			const directive = engine.handlePointerDown(cx, cy, 0, mods);
			expect(directive.action).toBe('capture-resize');
			if (directive.action === 'capture-resize') {
				expect(directive.handle).toBe('se');
			}

			engine.handlePointerUp();
		});

		it('click on empty space returns capture-marquee and clears selection', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			// Pre-select via tag to confirm it gets cleared.
			engine.world.addTag(e, Selected);
			engine.tick();
			expect(engine.getSelectedEntities()).toContain(e);

			const directive = engine.handlePointerDown(800, 700, 0, mods);
			expect(directive.action).toBe('capture-marquee');
			expect(engine.getSelectedEntities()).toHaveLength(0);
		});

		it('layer priority: corner handle wins over widget body at overlap', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e, Selected);
			engine.tick();

			// The NW corner handle is centered exactly on (100, 100), which is
			// also the top-left of the widget body — both AABBs contain the point.
			// Layer 15 (corner) > layer 5 (body) must win.
			const directive = engine.handlePointerDown(100, 100, 0, mods);
			expect(directive.action).toBe('capture-resize');
			if (directive.action === 'capture-resize') {
				expect(directive.handle).toBe('nw');
			}

			engine.handlePointerUp();
		});

		it('Active filter: child of unentered container is not hit', () => {
			const engine = createTestEngine();

			// Container at (100, 100) with enterable=true, size 600x400.
			const container = engine.createEntity([
				[Transform2D, { x: 100, y: 100, width: 600, height: 400, rotation: 0 }],
				[Widget, { surface: 'dom', type: 'container' }],
				[Container, { enterable: true }],
				[Children, { ids: [] as number[] }],
				[ZIndex, { value: 0 }],
				[Selectable],
				[InteractionRole, { layer: 5, role: { type: 'select' } }],
			]);

			// Child widget at world (150, 150) — inside the container.
			const child = engine.createEntity([
				[Transform2D, { x: 150, y: 150, width: 100, height: 50, rotation: 0 }],
				[Widget, { surface: 'dom', type: 'debug' }],
				[Parent, { id: container }],
				[ZIndex, { value: 0 }],
				[Selectable],
				[Draggable],
				[InteractionRole, { layer: 5, role: { type: 'drag' } }],
			]);
			engine.set(container, Children, { ids: [child] });

			engine.tick();
			// At root frame: container is Active, child is not.
			expect(engine.world.hasTag(container, Active)).toBe(true);
			expect(engine.world.hasTag(child, Active)).toBe(false);

			// Click at (180, 170) — inside both container AABB and child AABB in
			// world space. The unified hit test must skip the child because it is
			// not Active, and select the container instead.
			const directive = engine.handlePointerDown(180, 170, 0, mods);
			expect(directive.action).toBe('passthrough');
			expect(engine.getSelectedEntities()).toContain(container);
			expect(engine.getSelectedEntities()).not.toContain(child);
		});

		it('full resize round-trip via unified hit test', () => {
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.tick();

			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			let seId: number | null = null;
			for (const id of handleSet?.ids ?? []) {
				const role = engine.get(id, InteractionRole);
				if (role?.role.type === 'resize' && role.role.handle === 'se') {
					seId = id;
					break;
				}
			}
			if (seId === null) throw new Error('SE handle not found');
			const wb = engine.get(seId, WorldBounds);
			if (!wb) throw new Error('SE handle WorldBounds missing');
			const cx = wb.worldX + wb.worldWidth / 2;
			const cy = wb.worldY + wb.worldHeight / 2;

			const downDirective = engine.handlePointerDown(cx, cy, 0, mods);
			expect(downDirective.action).toBe('capture-resize');

			// Drag +50 screen px east (zoom == 1 → +50 world px).
			engine.handlePointerMove(cx + 50, cy, mods);
			engine.handlePointerUp();
			engine.tick();

			const t = engine.get(e, Transform2D);
			expect(t).toBeDefined();
			if (!t) return;
			expect(t.width).toBeCloseTo(250, 5);
			expect(t.x).toBeCloseTo(100, 5);
			expect(t.y).toBeCloseTo(100, 5);
			expect(t.height).toBeCloseTo(150, 5);
		});
	});

	describe('cursor system (RFC-001 Phases 6-7)', () => {
		const mods = { shift: false, ctrl: false, alt: false, meta: false };

		it('idle hover over widget body resolves to grab', () => {
			const engine = createTestEngine();
			engine.spawn('debug', {
				at: { x: 100, y: 100 },
				size: { width: 200, height: 150 },
			});
			engine.tick();

			// Pointer over widget center.
			engine.handlePointerMove(200, 175, mods);
			engine.tick();

			expect(engine.world.getResource(CursorResource).cursor).toBe('grab');
		});

		it('idle hover off any widget resolves to default', () => {
			const engine = createTestEngine();
			engine.spawn('debug', {
				at: { x: 100, y: 100 },
				size: { width: 200, height: 150 },
			});
			engine.tick();

			engine.handlePointerMove(0, 0, mods);
			engine.tick();

			expect(engine.world.getResource(CursorResource).cursor).toBe('default');
		});

		it('tracking state before dead zone shows grab, not grabbing', () => {
			const engine = createTestEngine();
			engine.spawn('debug', {
				at: { x: 100, y: 100 },
				size: { width: 200, height: 150 },
			});
			engine.tick();

			engine.handlePointerDown(200, 175, 0, mods);
			// Do NOT move past dead zone. Input state should be 'tracking'.
			engine.tick();

			expect(engine.world.getResource(CursorResource).cursor).toBe('grab');

			engine.handlePointerUp();
		});

		it('dragging state shows grabbing', () => {
			const engine = createTestEngine();
			engine.spawn('debug', {
				at: { x: 100, y: 100 },
				size: { width: 200, height: 150 },
			});
			engine.tick();

			engine.handlePointerDown(200, 175, 0, mods);
			// DEAD_ZONE_MOUSE_PX = 4; move +10 screen px to cross.
			engine.handlePointerMove(210, 175, mods);
			engine.tick();

			expect(engine.world.getResource(CursorResource).cursor).toBe('grabbing');

			engine.handlePointerUp();
		});

		it('resizing state shows the directional cursor from the handle', () => {
			const engine = createTestEngine();
			const e = engine.spawn('debug', {
				at: { x: 100, y: 100 },
				size: { width: 200, height: 150 },
			});
			engine.tick();

			// Select so handles spawn.
			engine.world.addTag(e, Selected);
			engine.tick();

			// Find the SE handle.
			const handleSet = engine.get(e, HandleSet);
			let seId: number | null = null;
			for (const id of handleSet?.ids ?? []) {
				const role = engine.get(id, InteractionRole);
				if (role?.role.type === 'resize' && role.role.handle === 'se') {
					seId = id;
					break;
				}
			}
			if (seId === null) throw new Error('SE handle not found');
			const wb = engine.get(seId, WorldBounds);
			if (!wb) throw new Error('SE handle WorldBounds missing');
			const cx = wb.worldX + wb.worldWidth / 2;
			const cy = wb.worldY + wb.worldHeight / 2;

			engine.handlePointerDown(cx, cy, 0, mods);
			engine.tick();

			expect(engine.world.getResource(CursorResource).cursor).toBe('se-resize');

			engine.handlePointerUp();
		});

		it('idle hover over SE handle resolves to se-resize', () => {
			const engine = createTestEngine();
			const e = engine.spawn('debug', {
				at: { x: 100, y: 100 },
				size: { width: 200, height: 150 },
			});
			engine.tick();

			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			let seId: number | null = null;
			for (const id of handleSet?.ids ?? []) {
				const role = engine.get(id, InteractionRole);
				if (role?.role.type === 'resize' && role.role.handle === 'se') {
					seId = id;
					break;
				}
			}
			if (seId === null) throw new Error('SE handle not found');
			const wb = engine.get(seId, WorldBounds);
			if (!wb) throw new Error('SE handle WorldBounds missing');
			const cx = wb.worldX + wb.worldWidth / 2;
			const cy = wb.worldY + wb.worldHeight / 2;

			// Sanity: the handle has the se-resize hint set by spawnResizeHandles.
			expect(engine.get(seId, CursorHint)?.hover).toBe('se-resize');

			// Hover (no press). Hover-to-parent was reverted in Phase 7, so the
			// raw handle id becomes hoveredEntity and cursorSystem reads its hint.
			engine.handlePointerMove(cx, cy, mods);
			engine.tick();

			expect(engine.getHoveredEntity()).toBe(seId);
			expect(engine.world.getResource(CursorResource).cursor).toBe('se-resize');
		});
	});

	describe('reactive InteractionRole auto-attach (RFC-001 bugfix)', () => {
		const mods = { shift: false, ctrl: false, alt: false, meta: false };

		it('entity created via createEntity with Draggable tag becomes hit-testable', () => {
			// Regression test for the playground's container pattern: users
			// bypass addWidget() and call createEntity() with explicit tags.
			// Prior to the reactive observer, such entities had no InteractionRole
			// and were invisible to the unified hit test.
			const engine = createTestEngine();
			const container = engine.createEntity([
				[Transform2D, { x: 100, y: 100, width: 300, height: 200, rotation: 0 }],
				[Widget, { surface: 'dom', type: 'container' }],
				[ZIndex, { value: 0 }],
				[Selectable],
				[Draggable],
				[Resizable],
			]);
			engine.tick();

			// InteractionRole auto-attached by the Draggable observer.
			const role = engine.get(container, InteractionRole);
			expect(role?.role.type).toBe('drag');
			expect(role?.layer).toBe(5);

			// CursorHint auto-attached for drag.
			expect(engine.get(container, CursorHint)).toEqual({ hover: 'grab', active: 'grabbing' });

			// Hit test finds it — this was the user-visible bug.
			const directive = engine.handlePointerDown(250, 200, 0, mods);
			expect(directive.action).toBe('passthrough-track-drag');
			expect(engine.getSelectedEntities()).toContain(container);
		});

		it('Selectable-only entity gets select role, no CursorHint', () => {
			const engine = createTestEngine();
			const e = engine.createEntity([
				[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
				[Selectable],
			]);

			expect(engine.get(e, InteractionRole)?.role.type).toBe('select');
			expect(engine.has(e, CursorHint)).toBe(false);
		});

		it('role upgrades from select to drag when Draggable is added later', () => {
			const engine = createTestEngine();
			const e = engine.createEntity([
				[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
				[Selectable],
			]);
			expect(engine.get(e, InteractionRole)?.role.type).toBe('select');

			engine.world.addTag(e, Draggable);
			expect(engine.get(e, InteractionRole)?.role.type).toBe('drag');
			expect(engine.get(e, CursorHint)).toEqual({ hover: 'grab', active: 'grabbing' });
		});

		it('role downgrades and CursorHint clears when Draggable is removed', () => {
			const engine = createTestEngine();
			const e = engine.createEntity([
				[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
				[Selectable],
				[Draggable],
			]);
			expect(engine.get(e, InteractionRole)?.role.type).toBe('drag');

			engine.world.removeTag(e, Draggable);
			expect(engine.get(e, InteractionRole)?.role.type).toBe('select');
			// CursorHint is not auto-cleared on downgrade — harmless because
			// select-only entities are never hovered into the dragging state.
		});

		it('entity with neither tag has no InteractionRole', () => {
			const engine = createTestEngine();
			const e = engine.createEntity([
				[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			]);
			expect(engine.has(e, InteractionRole)).toBe(false);
		});

		it('removing both tags removes the auto-attached InteractionRole', () => {
			const engine = createTestEngine();
			const e = engine.createEntity([
				[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
				[Selectable],
				[Draggable],
			]);
			expect(engine.has(e, InteractionRole)).toBe(true);

			engine.world.removeTag(e, Draggable);
			engine.world.removeTag(e, Selectable);
			expect(engine.has(e, InteractionRole)).toBe(false);
			expect(engine.has(e, CursorHint)).toBe(false);
		});

		it('handle entities with resize role are not touched by the observer', () => {
			// Regression guard: handleSyncSystem spawns handles with InteractionRole
			// { role: resize }. If the observer clobbered those, resize would break
			// whenever Draggable/Selectable tags are toggled on the parent.
			const engine = createTestEngine();
			const e = createWidget(engine, 100, 100, 200, 150);
			engine.world.addTag(e, Selected);
			engine.tick();

			const handleSet = engine.get(e, HandleSet);
			const seHandle = handleSet?.ids.find(
				(id) => engine.get(id, InteractionRole)?.role.type === 'resize',
			);
			expect(seHandle).toBeDefined();
			if (seHandle === undefined) return;

			const beforeRole = engine.get(seHandle, InteractionRole);
			// Toggle parent tags — should not touch handle roles.
			engine.world.removeTag(e, Draggable);
			engine.world.addTag(e, Draggable);
			const afterRole = engine.get(seHandle, InteractionRole);
			expect(afterRole?.role.type).toBe('resize');
			expect(afterRole?.layer).toBe(beforeRole?.layer);
		});
	});
});
