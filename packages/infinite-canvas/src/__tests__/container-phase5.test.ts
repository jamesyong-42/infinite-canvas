import { createWorld } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld } from '../ecs/serialization.js';
import {
	Active,
	Card,
	Container,
	ContainerCamera,
	ContainerChildren,
	createLayoutEngine,
	Draggable,
	isFrameAncestorOf,
	ParentFrame,
	RootCameraResource,
	Selectable,
	Selected,
	Transform2D,
	Widget,
	ZIndex,
} from '../index.js';

const mods = { shift: false, ctrl: false, alt: false, meta: false };

interface AdoptMutation {
	kind: 'adopt';
	parentId: number;
	childId: number;
	before: number[];
	after: number[];
}

/**
 * A minimal `card-container` widget definition that mirrors the
 * playground implementation but without any React surface — the tests
 * only need the interaction triple.
 */
function containerWidget() {
	return {
		type: 'card-container',
		schema: {
			'~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) },
		} as never,
		defaultData: {},
		defaultSize: { width: 329, height: 345 },
		interaction: {
			canAccept: ({
				parent,
				child,
				world,
			}: {
				parent: number;
				child: number;
				world: ReturnType<typeof createWorld>;
			}) => !isFrameAncestorOf(world, child, parent),
			onReceiveChild: ({
				parent,
				child,
				world,
			}: {
				parent: number;
				child: number;
				world: ReturnType<typeof createWorld>;
			}) => {
				const current = world.getComponent(parent, ContainerChildren);
				const before = current ? [...current.ids] : [];
				return {
					consume: true,
					mutation: {
						kind: 'adopt',
						parentId: parent,
						childId: child,
						before,
						after: [...before, child],
					},
				};
			},
			applyMutation: (world: ReturnType<typeof createWorld>, mutation: unknown) => {
				const m = mutation as AdoptMutation;
				if (world.entityExists(m.childId)) {
					if (world.hasComponent(m.childId, ParentFrame)) {
						world.setComponent(m.childId, ParentFrame, { id: m.parentId });
					} else {
						world.addComponent(m.childId, ParentFrame, { id: m.parentId });
					}
				}
				if (world.entityExists(m.parentId)) {
					if (world.hasComponent(m.parentId, ContainerChildren)) {
						world.setComponent(m.parentId, ContainerChildren, { ids: [...m.after] });
					} else {
						world.addComponent(m.parentId, ContainerChildren, { ids: [...m.after] });
					}
				}
			},
			revertMutation: (world: ReturnType<typeof createWorld>, mutation: unknown) => {
				const m = mutation as AdoptMutation;
				if (world.entityExists(m.childId) && world.hasComponent(m.childId, ParentFrame)) {
					world.removeComponent(m.childId, ParentFrame);
				}
				if (world.entityExists(m.parentId)) {
					if (world.hasComponent(m.parentId, ContainerChildren)) {
						world.setComponent(m.parentId, ContainerChildren, { ids: [...m.before] });
					} else {
						world.addComponent(m.parentId, ContainerChildren, { ids: [...m.before] });
					}
				}
			},
		},
	};
}

function makeEngine() {
	const engine = createLayoutEngine({
		widgets: [containerWidget() as never],
		archetypes: [],
		snap: { enabled: false },
	});
	engine.setViewport(1000, 800);
	return engine;
}

function spawnChildCard(
	engine: ReturnType<typeof createLayoutEngine>,
	x: number,
	y: number,
): number {
	return engine.createEntity([
		[Transform2D, { x, y, width: 150, height: 150, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'child-card' }],
		[Card, { preset: 'small', provides: ['widget'], accepts: [] }],
		[ZIndex, { value: 0 }],
		[Selectable],
		[Draggable],
	]);
}

function spawnContainer(
	engine: ReturnType<typeof createLayoutEngine>,
	x: number,
	y: number,
): number {
	return engine.createEntity([
		[Transform2D, { x, y, width: 329, height: 345, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'card-container' }],
		[Card, { preset: 'large', accepts: ['widget'], provides: [] }],
		[Container, { enterable: true }],
		[ContainerChildren, { ids: [] as number[] }],
		[ZIndex, { value: 0 }],
		[Selectable],
		[Draggable],
	]);
}

function dragTo(
	engine: ReturnType<typeof createLayoutEngine>,
	entity: number,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): void {
	engine.world.addTag(entity, Selected);
	engine.tick();
	engine.handlePointerDown(startX, startY, 0, mods);
	engine.handlePointerMove(startX + 10, startY + 10, mods);
	engine.handlePointerMove(endX, endY, mods);
	engine.tick();
}

describe('CardContainer — RFC-004 Phase 5', () => {
	describe('consume mechanic', () => {
		it('appends child to ContainerChildren and sets ParentFrame on consume', () => {
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			// Drag card onto container.
			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			// Child is re-parented, not destroyed.
			expect(engine.world.entityExists(card)).toBe(true);
			expect(engine.get(card, ParentFrame)?.id).toBe(container);

			// Container's ContainerChildren lists the child.
			const children = engine.get(container, ContainerChildren);
			expect(children?.ids).toEqual([card]);
		});

		it('consumes a second card — appends without clobbering the first', () => {
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const cardA = spawnChildCard(engine, 0, 0);
			const cardB = spawnChildCard(engine, 0, 200);
			engine.tick();

			dragTo(engine, cardA, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			// Deselect first card before dragging second so the drag only
			// carries cardB's position.
			engine.world.removeTag(cardA, Selected);
			engine.tick();

			dragTo(engine, cardB, 75, 275, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			const children = engine.get(container, ContainerChildren);
			expect(children?.ids).toEqual([cardA, cardB]);
			expect(engine.get(cardA, ParentFrame)?.id).toBe(container);
			expect(engine.get(cardB, ParentFrame)?.id).toBe(container);
		});

		it('undo reverts consume atomically (removes ParentFrame and restores ContainerChildren)', () => {
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			// Pre-conditions after consume.
			expect(engine.get(card, ParentFrame)?.id).toBe(container);
			expect(engine.get(container, ContainerChildren)?.ids).toEqual([card]);

			// Undo.
			engine.undo();
			engine.tick();

			// Child no longer has ParentFrame; container's children list empty.
			expect(engine.has(card, ParentFrame)).toBe(false);
			const afterUndo = engine.get(container, ContainerChildren);
			expect(afterUndo?.ids ?? []).toEqual([]);

			// And the card is back at pre-drag position.
			const t = engine.get(card, Transform2D);
			expect(t?.x).toBe(0);
			expect(t?.y).toBe(0);
		});

		it('redo re-applies the consume', () => {
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			engine.undo();
			engine.tick();
			engine.redo();
			engine.tick();

			expect(engine.get(card, ParentFrame)?.id).toBe(container);
			expect(engine.get(container, ContainerChildren)?.ids).toEqual([card]);
		});
	});

	describe('cycle guard', () => {
		it('isFrameAncestorOf returns true for a direct parent', () => {
			const engine = makeEngine();
			const outer = spawnContainer(engine, 0, 0);
			const inner = spawnContainer(engine, 0, 400);
			engine.addComponent(inner, ParentFrame, { id: outer });

			expect(isFrameAncestorOf(engine.world, outer, inner)).toBe(true);
			expect(isFrameAncestorOf(engine.world, inner, outer)).toBe(false);
		});

		it('isFrameAncestorOf returns true for a transitive ancestor', () => {
			const engine = makeEngine();
			const a = spawnContainer(engine, 0, 0);
			const b = spawnContainer(engine, 0, 400);
			const c = spawnContainer(engine, 0, 800);
			engine.addComponent(b, ParentFrame, { id: a });
			engine.addComponent(c, ParentFrame, { id: b });

			expect(isFrameAncestorOf(engine.world, a, c)).toBe(true);
			expect(isFrameAncestorOf(engine.world, b, c)).toBe(true);
			expect(isFrameAncestorOf(engine.world, c, a)).toBe(false);
		});

		it('isFrameAncestorOf returns false for an entity that is its own ancestor', () => {
			const engine = makeEngine();
			const a = spawnContainer(engine, 0, 0);
			expect(isFrameAncestorOf(engine.world, a, a)).toBe(false);
		});

		it('dragging a container onto its own descendant is refused (no consume fires)', () => {
			// Set up: outer contains inner. User drags outer onto inner —
			// canAccept must reject so no mutation lands.
			const engine = makeEngine();
			const outer = spawnContainer(engine, 0, 0);
			const inner = spawnContainer(engine, 0, 0);
			// Make both drop-capable cards. Outer provides 'widget' so it
			// can be a drag subject; inner accepts 'widget' so it could in
			// principle consume. The cycle guard is the only thing that
			// should stop this drop.
			engine.set(outer, Card, { provides: ['widget'] });
			// Establish the ancestor relation in ECS.
			engine.addComponent(inner, ParentFrame, { id: outer });
			// Lay them out overlapping so the overlap pass sees them.
			engine.set(outer, Transform2D, { x: 0, y: 0, width: 150, height: 150 });
			engine.set(inner, Transform2D, { x: 200, y: 0, width: 150, height: 150 });
			engine.tick();

			dragTo(engine, outer, 75, 75, 275, 75);
			engine.handlePointerUp();
			engine.tick();

			// inner should have no children (cycle guard blocked it); outer's
			// ParentFrame should remain unchanged (inner is still its
			// descendant).
			const innerKids = engine.get(inner, ContainerChildren);
			expect(innerKids?.ids ?? []).toEqual([]);
			expect(engine.get(inner, ParentFrame)?.id).toBe(outer);
		});
	});

	describe('invariants after review fixes', () => {
		it('revertMutation keeps ContainerChildren present on the container when before is empty', () => {
			// RFC-004 § Phase 5 — the spec says ContainerChildren is
			// "kept consistent by applyMutation / revertMutation". An
			// earlier implementation removed the component outright when
			// reverting the first-ever consume, which breaks any query
			// over ContainerChildren. After the fix, the component must
			// remain present with `ids: []`.
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			engine.undo();
			engine.tick();

			// Component still attached, ids emptied.
			expect(engine.has(container, ContainerChildren)).toBe(true);
			expect(engine.get(container, ContainerChildren)?.ids ?? []).toEqual([]);
		});

		it('engine.spawn with parent option appends to the container’s ContainerChildren', () => {
			// RFC-004 § Phase 5 open question 7 — a runtime spawn inside
			// a container must sync ContainerChildren so the invariant
			// holds for programmatic inserts (not just drag-to-consume).
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			engine.tick();

			const child = engine.spawn('child-card', { at: { x: 0, y: 0 }, parent: container });
			engine.tick();

			const kids = engine.get(container, ContainerChildren);
			expect(kids?.ids).toEqual([child]);
			expect(engine.get(child, ParentFrame)?.id).toBe(container);
		});

		it('consume clears Selected on the consumed child', () => {
			// The child leaves the current nav frame after consume; its
			// Selected tag must clear so the selection overlay does not
			// render at root.
			const engine = makeEngine();
			spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			expect(engine.world.hasTag(card, Selected)).toBe(false);
		});

		it('revertMutation tolerates a destroyed parent', () => {
			// Defense in depth: user destroys the container after a
			// consume, then fires undo. The revert must no-op on the
			// dead parent rather than crashing.
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			engine.destroyEntity(container);
			engine.tick();

			// Undo should not throw. The child's ParentFrame (pointing at
			// the now-dead container) is the best we can do — the container
			// can't be brought back by this command (it was destroyed
			// out-of-band). The command buffer should degrade gracefully.
			expect(() => {
				engine.undo();
				engine.tick();
			}).not.toThrow();
		});
	});

	describe('navigation', () => {
		it('entering a container mounts its consumed children as Active', () => {
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			// At root the child should not be Active (it has ParentFrame
			// pointing at the container, not the active frame).
			expect(engine.world.hasTag(card, Active)).toBe(false);

			engine.enterContainer(container);
			engine.tick();

			// After navigating into the container, the child IS Active.
			expect(engine.world.hasTag(card, Active)).toBe(true);
			expect(engine.world.hasTag(container, Active)).toBe(false);

			engine.exitContainer();
			engine.tick();

			expect(engine.world.hasTag(container, Active)).toBe(true);
			expect(engine.world.hasTag(card, Active)).toBe(false);
		});

		it('nested containers preserve per-level camera state across enter/exit', () => {
			// Build A (root) → B (in A) → C (in B). Enter A, pan+zoom,
			// enter B, pan+zoom, enter C, pan+zoom, exit C, exit B, exit A.
			// Each ContainerCamera should remember its per-level view.
			const engine = makeEngine();
			const a = spawnContainer(engine, 0, 0);
			const b = spawnContainer(engine, 400, 0);
			const c = spawnContainer(engine, 800, 0);
			engine.addComponent(b, ParentFrame, { id: a });
			engine.addComponent(c, ParentFrame, { id: b });
			engine.tick();

			engine.enterContainer(a);
			engine.panTo(100, 100);
			engine.zoomTo(2);
			engine.tick();

			engine.enterContainer(b);
			engine.panTo(200, 200);
			engine.zoomTo(3);
			engine.tick();

			engine.enterContainer(c);
			engine.panTo(300, 300);
			engine.zoomTo(4);
			engine.tick();

			// Exit all the way to root.
			engine.exitContainer();
			engine.tick();
			// B's saved ContainerCamera should hold zoom = 3.
			expect(engine.get(b, ContainerCamera)?.zoom).toBe(3);

			engine.exitContainer();
			engine.tick();
			// A's saved ContainerCamera should hold zoom = 2.
			expect(engine.get(a, ContainerCamera)?.zoom).toBe(2);

			// C's saved ContainerCamera should hold zoom = 4 (captured on
			// initial exit from C).
			expect(engine.get(c, ContainerCamera)?.zoom).toBe(4);

			engine.exitContainer();
			engine.tick();
			// Back at root. Navigation depth 0.
			expect(engine.getNavigationDepth()).toBe(0);
		});
	});

	describe('serialization', () => {
		it('persists ContainerChildren and ParentFrame across save/load; nav resets to root', () => {
			// Build world with container holding one child, navigate into
			// container, serialize, deserialize into fresh world — every
			// hierarchy bit survives, and the nav stack resets.
			const world = createWorld();
			const container = world.createEntity();
			world.addComponent(container, Transform2D, {
				x: 100,
				y: 100,
				width: 400,
				height: 400,
				rotation: 0,
			});
			world.addComponent(container, Container, { enterable: true });
			world.addComponent(container, ContainerCamera, { x: 5, y: 5, zoom: 1.5 });
			world.addComponent(container, Card, {
				preset: 'large',
				background: '#2a2a2a',
				accepts: ['widget'],
				provides: [],
			});

			const child = world.createEntity();
			world.addComponent(child, Transform2D, {
				x: 0,
				y: 0,
				width: 150,
				height: 150,
				rotation: 0,
			});
			world.addComponent(child, ParentFrame, { id: container });
			world.addComponent(child, Card, {
				preset: 'small',
				background: '#1C1C1E',
				accepts: [],
				provides: ['widget'],
			});

			// Parent now lists the child.
			world.addComponent(container, ContainerChildren, { ids: [child] });

			const componentTypes = [
				Transform2D,
				Card,
				Container,
				ContainerCamera,
				ContainerChildren,
				ParentFrame,
			];
			const doc = serializeWorld(
				world,
				componentTypes,
				[],
				{ x: 42, y: 42, zoom: 1 },
				{ x: 0, y: 0, zoom: 1 },
			);

			const fresh = createWorld();
			deserializeWorld(fresh, doc, componentTypes, []);

			// Find the restored entities (ids may be remapped).
			const containers = fresh.query(Container);
			expect(containers).toHaveLength(1);
			const restoredContainer = containers[0];
			const restoredChildren = fresh.getComponent(restoredContainer, ContainerChildren);
			expect(restoredChildren).toBeDefined();
			expect(restoredChildren?.ids).toHaveLength(1);

			// The ids inside ContainerChildren must be the *remapped* child id.
			const restoredChildId = restoredChildren?.ids[0];
			expect(restoredChildId).toBeDefined();
			if (restoredChildId === undefined) return;

			// The child's ParentFrame must point at the remapped container id.
			const restoredParent = fresh.getComponent(restoredChildId, ParentFrame);
			expect(restoredParent?.id).toBe(restoredContainer);

			// Container camera was restored too.
			expect(fresh.getComponent(restoredContainer, ContainerCamera)).toEqual({
				x: 5,
				y: 5,
				zoom: 1.5,
			});
		});

		it('prunes stale ids from ContainerChildren on deserialize', () => {
			// If a child was destroyed before save but its id still lives in
			// `ContainerChildren.ids` (applyMutation/revertMutation keep them
			// in sync in normal flow, but an external destroyEntity call can
			// leave the list stale), deserialization must drop the unmapped id
			// rather than preserve it — the raw pre-save id may have been
			// recycled to an unrelated entity.
			const world = createWorld();
			const container = world.createEntity();
			world.addComponent(container, Transform2D, {
				x: 0,
				y: 0,
				width: 329,
				height: 345,
				rotation: 0,
			});
			world.addComponent(container, Container, { enterable: true });
			// The "child" id is never created — simulates a dead reference.
			const deadChildId = 9999;
			world.addComponent(container, ContainerChildren, { ids: [deadChildId] });

			const componentTypes = [Transform2D, Container, ContainerChildren, ParentFrame];
			const doc = serializeWorld(
				world,
				componentTypes,
				[],
				{ x: 0, y: 0, zoom: 1 },
				{ x: 0, y: 0, zoom: 1 },
			);

			const fresh = createWorld();
			deserializeWorld(fresh, doc, componentTypes, []);

			const containers = fresh.query(Container);
			expect(containers).toHaveLength(1);
			const restoredKids = fresh.getComponent(containers[0], ContainerChildren);
			// Dead id pruned, not preserved as raw.
			expect(restoredKids?.ids ?? []).toEqual([]);
		});

		it('via engine: consume → serialize → reload → user is back at root', () => {
			// NavigationStack is intentionally not serialized. Even after
			// consuming + entering a container, reload should place the user
			// at root with containers visible as top-level cards.
			const engine = makeEngine();
			const container = spawnContainer(engine, 400, 0);
			const card = spawnChildCard(engine, 0, 0);
			engine.tick();

			dragTo(engine, card, 75, 75, 475, 75);
			engine.handlePointerUp();
			engine.tick();

			engine.enterContainer(container);
			engine.tick();
			expect(engine.getNavigationDepth()).toBe(1);

			// Serialize + deserialize. The stack resets to root in the
			// fresh world; the container's contents survive.
			const componentTypes = [
				Transform2D,
				Card,
				Container,
				ContainerCamera,
				ContainerChildren,
				ParentFrame,
			];
			const camera = engine.getCamera();
			const rootCamera = engine.world.getResource(RootCameraResource);
			const doc = serializeWorld(engine.world, componentTypes, [], camera, rootCamera);

			const fresh = createWorld();
			deserializeWorld(fresh, doc, componentTypes, []);

			// Navigation stack is a runtime resource; the library initializes
			// it on engine start, but the raw world-restore doesn't populate
			// it. Confirm ContainerChildren + ParentFrame survived, and that
			// no navigation-stack entries were serialized.
			const containers = fresh.query(Container);
			expect(containers).toHaveLength(1);
			const restoredContainer = containers[0];
			const kids = fresh.getComponent(restoredContainer, ContainerChildren);
			expect(kids?.ids).toHaveLength(1);

			// No NavigationStack restoration — verify the doc does not carry
			// it. (Belt-and-braces: the serialize fn never writes it.)
			expect((doc.resources as Record<string, unknown>).navigationStack).toBeUndefined();
		});
	});
});
