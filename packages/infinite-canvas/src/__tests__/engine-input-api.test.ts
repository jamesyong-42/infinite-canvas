import { describe, expect, it } from 'vitest';
import {
	Card,
	createLayoutEngine,
	Draggable,
	Dragging,
	OverlapCandidate,
	OverlapTarget,
	Resizable,
	Selectable,
	Selected,
	Transform2D,
	TransformTween,
	Widget,
	ZIndex,
} from '../index.js';

/**
 * RFC-008 Phase 3b — coverage for the new world-coord engine input API
 * (`beginDrag`, `updateDrag`, `endDrag`, `beginResize`, …, `beginMarquee`,
 * …). The legacy `handlePointer*` path is covered by the existing
 * drop-outcome / snap / card-overlap suites; this file exercises the new
 * entry points directly so Phase 3d's swap can swing without relying on
 * the legacy adapters.
 */

function makeEngine() {
	const engine = createLayoutEngine({
		widgets: [],
		archetypes: [],
		snap: { enabled: false },
	});
	engine.setViewport(1000, 800);
	return engine;
}

function spawnDraggable(
	engine: ReturnType<typeof createLayoutEngine>,
	x: number,
	y: number,
	width = 100,
	height = 100,
): number {
	return engine.createEntity([
		[Transform2D, { x, y, width, height, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'debug' }],
		[ZIndex, { value: 0 }],
		[Selectable],
		[Draggable],
		[Resizable],
	]);
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

describe('engine input API — drag', () => {
	it('beginDrag → updateDrag → endDrag(commit) moves the entity by the world delta', () => {
		const engine = makeEngine();
		const e = spawnDraggable(engine, 100, 100);
		engine.world.addTag(e, Selected);
		engine.tick();

		engine.beginDrag(e, 150, 150);
		expect(engine.getDraggingEntity()).toBe(e);
		expect(engine.world.hasTag(e, Dragging)).toBe(true);

		engine.updateDrag(e, 200, 175);
		expect(engine.get(e, Transform2D)?.x).toBe(150);
		expect(engine.get(e, Transform2D)?.y).toBe(125);

		engine.endDrag(e, { cancelled: false });
		expect(engine.getDraggingEntity()).toBeNull();
		expect(engine.world.hasTag(e, Dragging)).toBe(false);
		expect(engine.get(e, Transform2D)?.x).toBe(150);
		expect(engine.get(e, Transform2D)?.y).toBe(125);
	});

	it('beginDrag → endDrag(cancelled) leaves the entity at its starting position', () => {
		const engine = makeEngine();
		const e = spawnDraggable(engine, 100, 100);
		engine.world.addTag(e, Selected);
		engine.tick();

		engine.beginDrag(e, 150, 150);
		engine.updateDrag(e, 300, 300);
		expect(engine.get(e, Transform2D)?.x).toBe(250);

		engine.endDrag(e, { cancelled: true });
		expect(engine.getDraggingEntity()).toBeNull();
		expect(engine.world.hasTag(e, Dragging)).toBe(false);
		const t = engine.get(e, Transform2D);
		expect(t?.x).toBe(100);
		expect(t?.y).toBe(100);
	});

	it('drags every Selected entity, not just the named one (multi-select drag)', () => {
		const engine = makeEngine();
		const a = spawnDraggable(engine, 0, 0);
		const b = spawnDraggable(engine, 200, 0);
		engine.world.addTag(a, Selected);
		engine.world.addTag(b, Selected);
		engine.tick();

		engine.beginDrag(a, 50, 50);
		engine.updateDrag(a, 100, 50);
		expect(engine.get(a, Transform2D)?.x).toBe(50);
		expect(engine.get(b, Transform2D)?.x).toBe(250);

		engine.endDrag(a, { cancelled: false });
		expect(engine.get(a, Transform2D)?.x).toBe(50);
		expect(engine.get(b, Transform2D)?.x).toBe(250);
	});

	it('elevates dragged ZIndex during the drag and restores it on commit', () => {
		const engine = makeEngine();
		const a = spawnDraggable(engine, 0, 0);
		const b = spawnDraggable(engine, 200, 0);
		engine.world.addTag(a, Selected);
		engine.tick();
		// Bump b above a so a's elevation is observable.
		engine.set(b, ZIndex, { value: 5 });

		engine.beginDrag(a, 50, 50);
		expect(engine.get(a, ZIndex)?.value).toBe(6);

		engine.updateDrag(a, 60, 50);
		engine.endDrag(a, { cancelled: false });
		expect(engine.get(a, ZIndex)?.value).toBe(0);
	});

	it('Card drop on matching OverlapTarget enters the consume branch', () => {
		const engine = makeEngine();
		const child = spawnCard(engine, 0, 0, 100, 100, {
			provides: ['fruit'],
		});
		const parent = spawnCard(engine, 200, 0, 200, 200, {
			accepts: ['fruit'],
		});
		engine.world.addTag(child, Selected);
		engine.tick();

		engine.beginDrag(child, 50, 50);
		// Slide the child into the parent so AABBs overlap.
		engine.updateDrag(child, 270, 100);
		engine.tick();

		expect(engine.world.hasTag(parent, OverlapCandidate)).toBe(true);
		expect(engine.world.hasTag(parent, OverlapTarget)).toBe(true);

		engine.endDrag(child, { cancelled: false });
		engine.tick();

		// ConsumeCommand removes the child from the active frame.
		expect(engine.world.hasTag(parent, OverlapTarget)).toBe(false);
		expect(engine.world.hasTag(parent, OverlapCandidate)).toBe(false);
	});

	it('handlePointerCancel during fly-back snaps Transform2D to fly-back destination', () => {
		// Regression for the v1 bug where a cancel during fly-back left the
		// entity orphaned at its mid-flight position. Fly-back never produces
		// a command-buffer entry, so without the snap there was no recovery
		// path.
		const engine = makeEngine();
		const child = spawnCard(engine, 0, 0, 100, 100, { provides: ['fruit'] });
		spawnCard(engine, 200, 0, 200, 200, { accepts: ['vegetable'] });
		engine.world.addTag(child, Selected);
		engine.tick();

		engine.beginDrag(child, 50, 50);
		engine.updateDrag(child, 270, 100);
		engine.tick();
		engine.endDrag(child, { cancelled: false });
		// At this point: flyingBack mode, child is mid-flight at ~(220, 50).
		expect(engine.get(child, Transform2D)?.x).not.toBe(0);

		engine.handlePointerCancel();
		// Cancel during fly-back: tween killed, Dragging removed, ZIndex
		// restored, Transform2D snapped back to start (0, 0).
		expect(engine.get(child, Transform2D)?.x).toBe(0);
		expect(engine.get(child, Transform2D)?.y).toBe(0);
		expect(engine.world.hasTag(child, Dragging)).toBe(false);
		expect(engine.world.hasComponent(child, TransformTween)).toBe(false);
	});

	it('Card drop on overlap-without-match enters the fly-back branch', () => {
		const engine = makeEngine();
		const child = spawnCard(engine, 0, 0, 100, 100, {
			provides: ['fruit'],
		});
		const sibling = spawnCard(engine, 200, 0, 200, 200, {
			// Different contract — overlap but no match.
			accepts: ['vegetable'],
		});
		engine.world.addTag(child, Selected);
		engine.tick();

		engine.beginDrag(child, 50, 50);
		engine.updateDrag(child, 270, 100);
		engine.tick();

		expect(engine.world.hasTag(sibling, OverlapCandidate)).toBe(true);
		expect(engine.world.hasTag(sibling, OverlapTarget)).toBe(false);

		engine.endDrag(child, { cancelled: false });
		// Fly-back leaves Dragging + TransformTween in place until the tween
		// completes — runFlyBackSystem will clean up on later ticks.
		expect(engine.world.hasTag(child, Dragging)).toBe(true);
		expect(engine.world.hasComponent(child, TransformTween)).toBe(true);
	});
});

describe('engine input API — resize', () => {
	it('beginResize → updateResize → endResize(commit) writes new bounds', () => {
		const engine = makeEngine();
		const e = spawnDraggable(engine, 100, 100, 200, 200);
		engine.world.addTag(e, Selected);
		engine.tick();

		const ok = engine.beginResize(e, 'se', 300, 300);
		expect(ok).toBe(true);

		engine.updateResize(e, 350, 350);
		const t = engine.get(e, Transform2D);
		expect(t?.width).toBe(250);
		expect(t?.height).toBe(250);

		engine.endResize(e, { cancelled: false });
		const after = engine.get(e, Transform2D);
		expect(after?.width).toBe(250);
		expect(after?.height).toBe(250);
		expect(engine.canUndo()).toBe(true);
	});

	it('endResize(cancelled) reverts to starting bounds', () => {
		const engine = makeEngine();
		const e = spawnDraggable(engine, 100, 100, 200, 200);
		engine.world.addTag(e, Selected);
		engine.tick();

		engine.beginResize(e, 'se', 300, 300);
		engine.updateResize(e, 500, 500);
		engine.endResize(e, { cancelled: true });

		const t = engine.get(e, Transform2D);
		expect(t?.x).toBe(100);
		expect(t?.y).toBe(100);
		expect(t?.width).toBe(200);
		expect(t?.height).toBe(200);
	});

	it('beginResize on a non-Transform entity returns false and does not change state', () => {
		const engine = makeEngine();
		const e = engine.createEntity([[Widget, { surface: 'dom', type: 'no-transform' }]]);
		const ok = engine.beginResize(e, 'se', 0, 0);
		expect(ok).toBe(false);
	});
});

describe('engine input API — marquee', () => {
	it('beginMarquee toggles isMarqueeActive; endMarquee returns to idle', () => {
		const engine = makeEngine();
		expect(engine.isMarqueeActive()).toBe(false);

		engine.beginMarquee(0, 0);
		expect(engine.isMarqueeActive()).toBe(true);

		engine.updateMarquee(50, 50);
		expect(engine.isMarqueeActive()).toBe(true);

		engine.endMarquee();
		expect(engine.isMarqueeActive()).toBe(false);
	});
});

describe('engine input API — cancelInteraction', () => {
	it('clears flyingBack mode (covers the case getDraggingEntity misses)', () => {
		// Regression for the v1 swap bug where the cancel engine handler
		// gated cleanup on `getDraggingEntity()` — null in flyingBack mode
		// — so a native pointercancel during fly-back left Dragging tags
		// and elevated ZIndex stranded.
		const engine = makeEngine();
		const child = spawnCard(engine, 0, 0, 100, 100, { provides: ['fruit'] });
		spawnCard(engine, 200, 0, 200, 200, { accepts: ['vegetable'] });
		engine.world.addTag(child, Selected);
		engine.tick();

		engine.beginDrag(child, 50, 50);
		engine.updateDrag(child, 270, 100);
		engine.tick();
		engine.endDrag(child, { cancelled: false });
		// In flyingBack now.
		expect(engine.world.hasTag(child, Dragging)).toBe(true);
		expect(engine.getDraggingEntity()).toBeNull();

		engine.cancelInteraction();

		expect(engine.world.hasTag(child, Dragging)).toBe(false);
		expect(engine.world.hasComponent(child, TransformTween)).toBe(false);
		expect(engine.get(child, Transform2D)?.x).toBe(0);
	});

	it('clears active drag', () => {
		const engine = makeEngine();
		const e = spawnDraggable(engine, 100, 100);
		engine.world.addTag(e, Selected);
		engine.tick();

		engine.beginDrag(e, 150, 150);
		engine.updateDrag(e, 250, 250);
		expect(engine.getDraggingEntity()).toBe(e);

		engine.cancelInteraction();
		expect(engine.getDraggingEntity()).toBeNull();
		expect(engine.get(e, Transform2D)?.x).toBe(100);
	});

	it('clears active marquee', () => {
		const engine = makeEngine();
		engine.beginMarquee(0, 0);
		expect(engine.isMarqueeActive()).toBe(true);

		engine.cancelInteraction();
		expect(engine.isMarqueeActive()).toBe(false);
	});

	it('is a no-op when idle', () => {
		const engine = makeEngine();
		expect(() => engine.cancelInteraction()).not.toThrow();
	});
});

describe('engine input API — hover', () => {
	it('setHoveredEntity / getHoveredEntity round-trip', () => {
		const engine = makeEngine();
		const e = spawnDraggable(engine, 0, 0);

		expect(engine.getHoveredEntity()).toBeNull();
		engine.setHoveredEntity(e);
		expect(engine.getHoveredEntity()).toBe(e);
		engine.setHoveredEntity(null);
		expect(engine.getHoveredEntity()).toBeNull();
	});
});
