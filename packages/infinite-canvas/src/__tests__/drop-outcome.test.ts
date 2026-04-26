import { describe, expect, it } from 'vitest';
import {
	Card,
	createLayoutEngine,
	Draggable,
	Dragging,
	OverlapCandidate,
	OverlapTarget,
	Selectable,
	Selected,
	Transform2D,
	TransformTween,
	Widget,
	ZIndex,
} from '../index.js';

const mods = { shift: false, ctrl: false, alt: false, meta: false };

function makeEngine() {
	const engine = createLayoutEngine({
		widgets: [],
		archetypes: [],
		snap: { enabled: false },
	});
	engine.setViewport(1000, 800);
	return engine;
}

function spawnCard(
	engine: ReturnType<typeof createLayoutEngine>,
	x: number,
	y: number,
	width = 150,
	height = 150,
	cardOverride: { accepts?: readonly string[]; provides?: readonly string[] } = {},
): number {
	return engine.createEntity([
		[Transform2D, { x, y, width, height, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'test-card' }],
		[Card, { preset: 'small', accepts: [], provides: [], ...cardOverride }],
		[ZIndex, { value: 0 }],
		[Selectable],
		[Draggable],
	]);
}

/** Start a drag from `(startX, startY)` and move to `(endX, endY)`. */
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

describe('drop outcome — Phase 4', () => {
	it('normal move: dragged non-card entity commits a MoveCommand and ends cleanly', () => {
		const engine = makeEngine();
		const dragged = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 150, height: 150, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'bare' }],
			[Selectable],
			[Draggable],
		]);
		spawnCard(engine, 200, 0);

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		engine.tick();

		// Dragging tag should be removed, Transform2D moved.
		expect(engine.world.hasTag(dragged, Dragging)).toBe(false);
		const t = engine.get(dragged, Transform2D);
		// Moved by ~(200, 0) minus the dead-zone anchor adjustment.
		expect(t?.x).toBeGreaterThan(100);
	});

	it('normal move: card drag with no overlap targets commits MoveCommand', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0);
		// No target to overlap with.

		dragTo(engine, dragged, 75, 75, 600, 75);
		engine.handlePointerUp();
		engine.tick();

		expect(engine.world.hasTag(dragged, Dragging)).toBe(false);
		// Should have moved significantly.
		const t = engine.get(dragged, Transform2D);
		expect(t?.x).toBeGreaterThan(400);
	});

	it('fly-back: card drag that overlaps but doesn’t match enters flyingBack', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['foo'] });
		// Target has accepts that don't intersect.
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['bar'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		// After pointerup, state should be flyingBack. Dragging is RETAINED
		// so the widget stays visually on top during the animation.
		expect(engine.world.hasTag(dragged, Dragging)).toBe(true);
		expect(engine.has(dragged, TransformTween)).toBe(true);
		const tween = engine.get(dragged, TransformTween);
		expect(tween?.kind).toBe('flyback');
		// Tween ends at the pre-drag position.
		expect(tween?.toX).toBe(0);
		expect(tween?.toY).toBe(0);
	});

	it('fly-back keeps the engine dirty so rAF continues to tick until the tween completes', () => {
		// Regression: the Transform2D reactive observer deliberately
		// doesn't markDirty, so a tween system tick that writes only
		// Transform2D leaves dirty=false. Without the tick-loop's
		// "any-tween-present → markDirty" guard, flushIfDirty returns
		// false next frame and the animation freezes mid-fly-back.
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['foo'] });
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['bar'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		// Initial tick — consume pointerUp's markDirty.
		expect(engine.flushIfDirty()).toBe(true);

		// The tween is now live. Each subsequent flushIfDirty must still
		// return true (no pointer input; only the tween is driving the
		// engine) until the tween finishes. Backdate its start so it
		// completes in the next tick.
		expect(engine.has(dragged, TransformTween)).toBe(true);
		// One more tick with the live tween should succeed.
		expect(engine.flushIfDirty()).toBe(true);
	});

	it('fly-back completion: after tween finishes, Dragging is removed', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['foo'] });
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['bar'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();

		// Force tween completion by backdating its startMs.
		const tween = engine.get(dragged, TransformTween);
		if (tween) {
			engine.set(dragged, TransformTween, {
				startMs: performance.now() - 5000,
			});
		}
		engine.tick();

		// Tween gone, Dragging cleared, widget back at (0, 0).
		expect(engine.has(dragged, TransformTween)).toBe(false);
		expect(engine.world.hasTag(dragged, Dragging)).toBe(false);
		const t = engine.get(dragged, Transform2D);
		expect(t?.x).toBe(0);
		expect(t?.y).toBe(0);
	});

	it('consume: card drag onto a matching target emits ConsumeCommand', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['widget'] });
		const target = spawnCard(engine, 200, 0, 150, 150, { accepts: ['widget'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		expect(engine.has(target, OverlapTarget)).toBe(true);

		engine.handlePointerUp();
		engine.tick();

		// Default consume with no applyMutation → dragged entity is destroyed.
		expect(engine.world.entityExists(dragged)).toBe(false);
		// Target is unchanged.
		expect(engine.world.entityExists(target)).toBe(true);
		// Overlap state cleared.
		expect(engine.has(target, OverlapCandidate)).toBe(false);
		expect(engine.has(target, OverlapTarget)).toBe(false);
	});

	it('consume with custom applyMutation re-parents rather than destroys', () => {
		const appliedMutations: unknown[] = [];
		const engine = createLayoutEngine({
			widgets: [
				{
					type: 'container-card',
					schema: {
						'~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) },
					} as never,
					defaultData: {},
					defaultSize: { width: 150, height: 150 },
					interaction: {
						onReceiveChild: ({ child, parent }) => ({
							consume: true,
							mutation: { child, parent, kind: 're-parent' },
						}),
						applyMutation: (_world, m) => {
							appliedMutations.push(m);
						},
						revertMutation: () => {},
					},
				},
			],
			archetypes: [],
			snap: { enabled: false },
		});
		engine.setViewport(1000, 800);

		const dragged = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 150, height: 150, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'test-card' }],
			[Card, { preset: 'small', provides: ['widget'] }],
			[Selectable],
			[Draggable],
		]);
		const container = engine.createEntity([
			[Transform2D, { x: 200, y: 0, width: 150, height: 150, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'container-card' }],
			[Card, { preset: 'small', accepts: ['widget'] }],
		]);

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		engine.tick();

		// Custom applyMutation fired; dragged entity preserved (no destroy).
		expect(appliedMutations).toHaveLength(1);
		expect(engine.world.entityExists(dragged)).toBe(true);
		expect(engine.world.entityExists(container)).toBe(true);
	});

	it('consume: undo reverses ConsumeCommand (rehydrates destroyed child)', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['widget'] });
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['widget'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		engine.tick();

		expect(engine.world.entityExists(dragged)).toBe(false);

		// Undo consume — since the pointerup ended the commandBuffer's
		// grouped MoveCommand + ConsumeCommand, one undo reverses the
		// whole group and re-creates the child.
		engine.undo();
		engine.tick();

		// A rehydrated entity exists with the original Card component.
		// It may have a new id (createEntity post-undo). Find it by
		// querying Card.provides.
		const cards = engine.world.query(Card);
		const rehydrated = cards.find((id) => {
			const card = engine.get(id, Card);
			return card?.provides.includes('widget');
		});
		expect(rehydrated).toBeDefined();
	});

	it('consume undo restores the dragged card to its pre-drag position', () => {
		// RFC-004 § Phase 4 acceptance: "undo restores the full pre-drag
		// state atomically." Verifies the position is pre-drag, not the
		// drop-site post-move position.
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['widget'] });
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['widget'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		engine.tick();

		engine.undo();
		engine.tick();

		const cards = engine.world.query(Card);
		const rehydrated = cards.find((id) => engine.get(id, Card)?.provides.includes('widget'));
		expect(rehydrated).toBeDefined();
		if (rehydrated === undefined) return;
		const t = engine.get(rehydrated, Transform2D);
		expect(t?.x).toBe(0);
		expect(t?.y).toBe(0);
	});

	it('fly-back interruption: new pointerdown cancels tween and resumes dragging', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['widget'] });
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['bar'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		// Now in flyingBack. Verify the tween is present before interrupt.
		expect(engine.has(dragged, TransformTween)).toBe(true);
		expect(engine.world.hasTag(dragged, Dragging)).toBe(true);

		// Read current animated position (it'll be somewhere between
		// drop and start since minimal time has passed).
		const midPos = engine.get(dragged, Transform2D);
		expect(midPos).toBeDefined();
		if (!midPos) return;

		// Interrupt by grabbing the card mid-flight — pointer down at
		// its current location.
		engine.handlePointerDown(midPos.x + 75, midPos.y + 75, 0, mods);

		// Tween gone, Dragging still on, ready for a fresh drag.
		expect(engine.has(dragged, TransformTween)).toBe(false);
		expect(engine.world.hasTag(dragged, Dragging)).toBe(true);
	});

	it('handlePointerCancel during flyingBack cleans up Dragging + TransformTween', () => {
		const engine = makeEngine();
		const dragged = spawnCard(engine, 0, 0, 150, 150, { provides: ['widget'] });
		spawnCard(engine, 200, 0, 150, 150, { accepts: ['bar'] });

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		expect(engine.world.hasTag(dragged, Dragging)).toBe(true);
		expect(engine.has(dragged, TransformTween)).toBe(true);

		engine.handlePointerCancel();
		engine.tick();

		expect(engine.world.hasTag(dragged, Dragging)).toBe(false);
		expect(engine.has(dragged, TransformTween)).toBe(false);
	});

	it('onReceiveChild returning { consume: false } leaves the card at drop position', () => {
		const engine = createLayoutEngine({
			widgets: [
				{
					type: 'reject-target',
					schema: {
						'~standard': { version: 1, vendor: 't', validate: (v: unknown) => ({ value: v }) },
					} as never,
					defaultData: {},
					defaultSize: { width: 150, height: 150 },
					interaction: {
						onReceiveChild: () => ({ consume: false }),
					},
				},
			],
			archetypes: [],
			snap: { enabled: false },
		});
		engine.setViewport(1000, 800);

		const dragged = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 150, height: 150, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'test-card' }],
			[Card, { preset: 'small', provides: ['widget'] }],
			[Selectable],
			[Draggable],
		]);
		engine.createEntity([
			[Transform2D, { x: 200, y: 0, width: 150, height: 150, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'reject-target' }],
			[Card, { preset: 'small', accepts: ['widget'] }],
		]);

		dragTo(engine, dragged, 75, 75, 275, 75);
		engine.handlePointerUp();
		engine.tick();

		// Handler vetoed consume — dragged entity still exists, at drop
		// position (MoveCommand committed).
		expect(engine.world.entityExists(dragged)).toBe(true);
		const t = engine.get(dragged, Transform2D);
		expect(t?.x).toBeGreaterThan(100);
	});
});
