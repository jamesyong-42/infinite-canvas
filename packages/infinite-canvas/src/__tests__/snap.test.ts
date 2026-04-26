import { describe, expect, it } from 'vitest';
import { Container, ParentFrame } from '../ecs/components.js';
import { DEAD_ZONE_MOUSE_PX } from '../ecs/interaction-constants.js';
import {
	Active,
	createLayoutEngine,
	Draggable,
	type EntityId,
	Selectable,
	Selected,
	SnapSource,
	SnapTarget,
	Transform2D,
	Widget,
	WidgetData,
	type WidgetDef,
	ZIndex,
} from '../index.js';

const NO_MODS = { shift: false, ctrl: false, alt: false, meta: false };

// Drag commits only after the pointer moves past `DEAD_ZONE_MOUSE_PX`
// screen pixels from pointer-down. The dragging state then captures the
// dead-zone-exit position as its origin, NOT the original pointer-down
// position. Helpers below account for that so test authors can think in
// entity-delta terms. `+1` keeps us strictly past the threshold (the
// engine uses `>` not `>=`).
const DEAD_ZONE_EXIT = DEAD_ZONE_MOUSE_PX + 1;

function createEngine() {
	const engine = createLayoutEngine<WidgetDef>();
	engine.setViewport(1000, 800);
	return engine;
}

type Engine = ReturnType<typeof createEngine>;

interface SpawnOpts {
	snapSource?: boolean;
	snapTarget?: boolean;
}

function spawnEntity(
	engine: Engine,
	x: number,
	y: number,
	width = 100,
	height = 100,
	{ snapSource = true, snapTarget = true }: SpawnOpts = {},
): EntityId {
	const entity = engine.createEntity([
		[Transform2D, { x, y, width, height, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'debug' }],
		[WidgetData, { data: {} }],
		[ZIndex, { value: 0 }],
		[Selectable],
		[Draggable],
	]);
	if (snapSource) engine.world.addTag(entity, SnapSource);
	if (snapTarget) engine.world.addTag(entity, SnapTarget);
	return entity;
}

/**
 * Drag the given entity by `(dx, dy)` world units (assumes camera zoom 1).
 * Pointer starts at `(sx, sy)`, crosses the dead zone, and then moves
 * exactly `(dx, dy)` from the dead-zone exit point.
 */
function dragBy(engine: Engine, entity: EntityId, sx: number, sy: number, dx: number, dy: number) {
	engine.world.addTag(entity, Selected);
	engine.tick();
	engine.handlePointerDown(sx, sy, 0, NO_MODS);
	engine.handlePointerMove(sx + DEAD_ZONE_EXIT, sy + DEAD_ZONE_EXIT, NO_MODS);
	engine.handlePointerMove(sx + DEAD_ZONE_EXIT + dx, sy + DEAD_ZONE_EXIT + dy, NO_MODS);
	// Don't tick / pointerUp — guides are populated mid-move.
}

describe('snap (SnapSource / SnapTarget gating)', () => {
	it('produces guides and snaps when dragging a SnapSource near a SnapTarget', () => {
		const engine = createEngine();
		spawnEntity(engine, 0, 0); // ref: x=0..100, y=0..100
		const dragged = spawnEntity(engine, 200, 200);

		// Drag by -98 → raw x = 102 → within 5px of ref right edge (100) → snap to 100.
		dragBy(engine, dragged, 250, 250, -98, 0);

		// Exactly one alignment: dragged left edge (100) ↔ ref right edge (100).
		expect(engine.getSnapGuides()).toHaveLength(1);
		expect(engine.getSnapGuides()[0]).toMatchObject({ axis: 'x', position: 100 });
		expect(engine.get(dragged, Transform2D)?.x).toBe(100);
	});

	it('produces NO guides when dragging an entity without SnapSource', () => {
		const engine = createEngine();
		spawnEntity(engine, 0, 0);
		const dragged = spawnEntity(engine, 200, 200, 100, 100, {
			snapSource: false,
			snapTarget: true,
		});

		dragBy(engine, dragged, 250, 250, -98, 0);

		expect(engine.getSnapGuides()).toHaveLength(0);
		// No snap correction — moved exactly by the drag delta.
		expect(engine.get(dragged, Transform2D)?.x).toBe(102);
	});

	it('ignores entities without SnapTarget when collecting references', () => {
		const engine = createEngine();
		// Sits at the snap-perfect position but lacks SnapTarget — must not pull.
		spawnEntity(engine, 0, 0, 100, 100, { snapSource: false, snapTarget: false });
		const dragged = spawnEntity(engine, 200, 200);

		dragBy(engine, dragged, 250, 250, -98, 0);

		expect(engine.getSnapGuides()).toHaveLength(0);
		expect(engine.get(dragged, Transform2D)?.x).toBe(102);
	});

	it('SnapTarget-only entity (e.g. a Card) is a valid reference for a SnapSource drag', () => {
		const engine = createEngine();
		// "Card-like": target only.
		spawnEntity(engine, 0, 0, 100, 100, { snapSource: false, snapTarget: true });
		// "Resizable-like": both.
		const dragged = spawnEntity(engine, 200, 200);

		dragBy(engine, dragged, 250, 250, -98, 0);

		expect(engine.getSnapGuides()).toHaveLength(1);
		expect(engine.get(dragged, Transform2D)?.x).toBe(100);
	});

	it('ignores SnapTarget entities that are not Active (in a different navigation frame)', () => {
		const engine = createEngine();
		// Build a container with a SnapTarget child inside it. The container is
		// at root and stays Active; the child only becomes Active when the user
		// enters the container. While at root, the child must not be a snap
		// reference even though it carries the SnapTarget tag.
		const container = engine.createEntity([
			[Transform2D, { x: 500, y: 500, width: 400, height: 300, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'container' }],
			[WidgetData, { data: {} }],
			[Container, { enterable: true }],
			[ZIndex, { value: 0 }],
		]);
		const inside = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'debug' }],
			[WidgetData, { data: {} }],
			[ZIndex, { value: 0 }],
			[SnapTarget],
		]);
		// Wire the child as a container child via ParentFrame so the
		// navigation filter treats it as inside-the-container, not at root.
		// We use the public components API rather than spawn() so the test
		// doesn't depend on archetype registration.
		engine.world.addComponent(inside, ParentFrame, { id: container });
		engine.tick();
		expect(engine.world.hasTag(container, Active)).toBe(true);
		expect(engine.world.hasTag(inside, Active)).toBe(false);

		// At root, drag a sibling that would otherwise snap to the inside-child.
		// The inside-child's left edge is at x=0 in container-local coords; its
		// world-space alignment doesn't matter because navigation scoping must
		// have already excluded it. We verify guides are empty.
		const dragged = spawnEntity(engine, 200, 200);
		dragBy(engine, dragged, 250, 250, -98, 0);

		// `inside` is the only candidate within snap distance of the dragged
		// entity's left edge — but it's not Active, so no snap fires.
		// (The container itself is at x=500, far from the dragged entity.)
		expect(engine.getSnapGuides()).toHaveLength(0);
		expect(engine.get(dragged, Transform2D)?.x).toBe(102);
	});

	it('respects setSnapEnabled(false) — no guides even when both tags are present', () => {
		const engine = createEngine();
		spawnEntity(engine, 0, 0);
		const dragged = spawnEntity(engine, 200, 200);

		engine.setSnapEnabled(false);
		dragBy(engine, dragged, 250, 250, -98, 0);

		expect(engine.getSnapGuides()).toHaveLength(0);
		expect(engine.get(dragged, Transform2D)?.x).toBe(102);
	});
});

describe('snap guides visibility', () => {
	it('defaults to true and is independently togglable', () => {
		const engine = createEngine();
		expect(engine.getSnapGuidesVisible()).toBe(true);
		engine.setSnapGuidesVisible(false);
		expect(engine.getSnapGuidesVisible()).toBe(false);
		engine.setSnapGuidesVisible(true);
		expect(engine.getSnapGuidesVisible()).toBe(true);
	});

	it('does NOT affect the math — guides still computed and snap still applies when off', () => {
		const engine = createEngine();
		spawnEntity(engine, 0, 0);
		const dragged = spawnEntity(engine, 200, 200);

		engine.setSnapGuidesVisible(false);
		dragBy(engine, dragged, 250, 250, -98, 0);

		expect(engine.getSnapGuides().length).toBeGreaterThan(0);
		expect(engine.get(dragged, Transform2D)?.x).toBe(100);
	});
});

describe('default interactive bundle', () => {
	// biome-ignore lint/suspicious/noExplicitAny: stub schema, validates nothing
	const stubSchema: any = {
		'~standard': {
			version: 1 as const,
			vendor: 'test',
			validate: (v: unknown) => ({ value: v as Record<string, unknown> }),
		},
	};

	it('interactive: true grants both SnapSource and SnapTarget', () => {
		const engine = createEngine();
		engine.registerWidget({
			type: 'bare',
			surface: 'dom',
			schema: stubSchema,
			defaultData: {},
			defaultSize: { width: 100, height: 100 },
			component: () => null,
		});
		const e = engine.spawn('bare');
		expect(engine.has(e, SnapSource)).toBe(true);
		expect(engine.has(e, SnapTarget)).toBe(true);
	});

	it('interactive object form omits both snap tags by default', () => {
		const engine = createEngine();
		engine.registerWidget({
			type: 'partial',
			surface: 'dom',
			schema: stubSchema,
			defaultData: {},
			defaultSize: { width: 100, height: 100 },
			component: () => null,
		});
		engine.registerArchetype({
			id: 'partial',
			widget: 'partial',
			interactive: { selectable: true, draggable: true },
		});
		const e = engine.spawn('partial');
		expect(engine.has(e, SnapSource)).toBe(false);
		expect(engine.has(e, SnapTarget)).toBe(false);
	});

	it('interactive object form opts into snap tags individually', () => {
		const engine = createEngine();
		engine.registerWidget({
			type: 'card-like',
			surface: 'dom',
			schema: stubSchema,
			defaultData: {},
			defaultSize: { width: 100, height: 100 },
			component: () => null,
		});
		engine.registerArchetype({
			id: 'card-like',
			widget: 'card-like',
			interactive: {
				selectable: true,
				draggable: true,
				snapSource: false,
				snapTarget: true,
			},
		});
		const e = engine.spawn('card-like');
		expect(engine.has(e, SnapSource)).toBe(false);
		expect(engine.has(e, SnapTarget)).toBe(true);
	});
});
