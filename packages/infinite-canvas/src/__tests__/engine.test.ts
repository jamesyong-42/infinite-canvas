import { describe, expect, it } from 'vitest';
import {
	Active,
	Children,
	Container,
	Draggable,
	Parent,
	Resizable,
	Selectable,
	Transform2D,
	Visible,
	Widget,
	WidgetBreakpoint,
	WidgetData,
	ZIndex,
	createLayoutEngine,
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
});
