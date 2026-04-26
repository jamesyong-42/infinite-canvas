import { createWorld, SystemScheduler } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld } from '../ecs/serialization.js';
import { applyEasing, transformTweenSystem } from '../ecs/systems/transform-tween.js';
import { createLayoutEngine, Transform2D, TransformTween } from '../index.js';

/**
 * Minimal scheduler harness — `transformTweenSystem` has no ordering
 * constraint, so a bare scheduler is enough to drive it.
 */
function tick(world: ReturnType<typeof createWorld>): void {
	const scheduler = new SystemScheduler();
	scheduler.register(transformTweenSystem);
	scheduler.execute(world);
}

describe('applyEasing', () => {
	it('linear returns the input unchanged', () => {
		expect(applyEasing(0, 'linear')).toBe(0);
		expect(applyEasing(0.3, 'linear')).toBe(0.3);
		expect(applyEasing(1, 'linear')).toBe(1);
	});

	it('ease-out at p=0 → 0, p=1 → 1, p=0.5 → 0.875', () => {
		// Cubic ease-out: 1 - (1-p)^3. At p=0.5: 1 - 0.125 = 0.875.
		expect(applyEasing(0, 'ease-out')).toBe(0);
		expect(applyEasing(1, 'ease-out')).toBe(1);
		expect(applyEasing(0.5, 'ease-out')).toBeCloseTo(0.875, 6);
		// Sanity on another sample point — at p=0.25: 1 - 0.75^3 ≈ 0.578125.
		expect(applyEasing(0.25, 'ease-out')).toBeCloseTo(0.578125, 6);
	});

	it('spring easing falls back to ease-out without throwing / NaN', () => {
		// RFC-004 § Phase 2 stub — spring tuning is deferred.
		expect(applyEasing(0.5, 'spring')).toBeCloseTo(0.875, 6);
		expect(Number.isFinite(applyEasing(0.3, 'spring'))).toBe(true);
	});

	it('ease-in-out at p=0 → 0, p=1 → 1, p=0.5 = 0.5', () => {
		expect(applyEasing(0, 'ease-in-out')).toBe(0);
		expect(applyEasing(1, 'ease-in-out')).toBe(1);
		expect(applyEasing(0.5, 'ease-in-out')).toBeCloseTo(0.5, 6);
	});

	it('clamps out-of-range input to [0, 1]', () => {
		expect(applyEasing(-0.5, 'linear')).toBe(0);
		expect(applyEasing(1.5, 'linear')).toBe(1);
		expect(applyEasing(-1, 'ease-out')).toBe(0);
		expect(applyEasing(2, 'ease-out')).toBe(1);
	});
});

describe('transformTweenSystem', () => {
	it('interpolates at the half-duration mark', () => {
		const world = createWorld();
		const e = world.createEntity();
		world.addComponent(e, Transform2D, {
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			rotation: 0,
		});
		world.addComponent(e, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 100,
			toY: 200,
			// Start 500 ms in the past with a 1000 ms duration → halfway.
			startMs: performance.now() - 500,
			durationMs: 1000,
			easing: 'linear',
			kind: 'test',
		});

		tick(world);

		const t = world.getComponent(e, Transform2D);
		// Linear at p=0.5 → halfway from (0,0) to (100,200) = (50,100).
		// Allow small slack for the few ms between startMs capture and tick.
		expect(t?.x).toBeGreaterThan(40);
		expect(t?.x).toBeLessThan(60);
		expect(t?.y).toBeGreaterThan(80);
		expect(t?.y).toBeLessThan(120);
		// Tween still active — not yet removed.
		expect(world.getComponent(e, TransformTween)).toBeDefined();
	});

	it('snaps to destination and auto-removes on completion', () => {
		const world = createWorld();
		const e = world.createEntity();
		world.addComponent(e, Transform2D, {
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			rotation: 0,
		});
		world.addComponent(e, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 300,
			toY: 400,
			// Already past duration.
			startMs: performance.now() - 5000,
			durationMs: 250,
			easing: 'ease-out',
			kind: 'test',
		});

		tick(world);

		const t = world.getComponent(e, Transform2D);
		// Exact destination, preserving width/height/rotation.
		expect(t).toEqual({ x: 300, y: 400, width: 100, height: 100, rotation: 0 });
		// Tween component gone.
		expect(world.getComponent(e, TransformTween)).toBeUndefined();
	});

	it('cleans up an orphan tween (no Transform2D on the entity)', () => {
		const world = createWorld();
		const e = world.createEntity();
		world.addComponent(e, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 10,
			toY: 10,
			startMs: performance.now(),
			durationMs: 100,
			easing: 'linear',
			kind: 'orphan',
		});
		tick(world);
		expect(world.getComponent(e, TransformTween)).toBeUndefined();
	});

	it('starting a new tween overwrites the existing one', () => {
		const world = createWorld();
		const e = world.createEntity();
		world.addComponent(e, Transform2D, {
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			rotation: 0,
		});

		world.addComponent(e, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 999,
			toY: 999,
			startMs: performance.now(),
			durationMs: 10000,
			easing: 'linear',
			kind: 'first',
		});

		// Overwrite with a new tween heading to (50, 50) via addComponent —
		// reactive-ecs `addComponent` on an existing component replaces it.
		world.addComponent(e, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 50,
			toY: 50,
			startMs: performance.now() - 5000,
			durationMs: 100,
			easing: 'linear',
			kind: 'second',
		});

		tick(world);
		const t = world.getComponent(e, Transform2D);
		// The SECOND tween snapped to completion (because startMs was 5s ago),
		// so x/y lock to the second target (50,50), not the first (999,999).
		expect(t?.x).toBe(50);
		expect(t?.y).toBe(50);
	});

	it('durationMs: 0 snaps to destination on the first tick (no NaN)', () => {
		const world = createWorld();
		const e = world.createEntity();
		world.addComponent(e, Transform2D, {
			x: 10,
			y: 20,
			width: 50,
			height: 50,
			rotation: 0,
		});
		world.addComponent(e, TransformTween, {
			fromX: 10,
			fromY: 20,
			toX: 200,
			toY: 300,
			startMs: performance.now(),
			durationMs: 0,
			easing: 'ease-out',
			kind: 'zero-dur',
		});
		tick(world);
		const t = world.getComponent(e, Transform2D);
		expect(t?.x).toBe(200);
		expect(t?.y).toBe(300);
		expect(world.getComponent(e, TransformTween)).toBeUndefined();
	});

	it('runs correctly inside a full engine.tick() (not just a bare scheduler)', () => {
		const engine = createLayoutEngine();
		engine.setViewport(1000, 800);
		const id = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
		]);
		engine.tick();
		// Schedule a tween that should have already completed by tick time.
		engine.world.addComponent(id, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 500,
			toY: 250,
			startMs: performance.now() - 5000,
			durationMs: 100,
			easing: 'ease-out',
			kind: 'flyback',
		});
		engine.tick();
		const t = engine.get(id, Transform2D);
		expect(t?.x).toBe(500);
		expect(t?.y).toBe(250);
		expect(engine.has(id, TransformTween)).toBe(false);
	});

	it('TransformTween is not serialized (runtime-only)', () => {
		const world = createWorld();
		const e = world.createEntity();
		world.addComponent(e, Transform2D, {
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			rotation: 0,
		});
		world.addComponent(e, TransformTween, {
			fromX: 0,
			fromY: 0,
			toX: 100,
			toY: 100,
			startMs: performance.now(),
			durationMs: 1000,
			easing: 'linear',
			kind: 'flyback',
		});

		const doc = serializeWorld(
			world,
			[Transform2D, TransformTween],
			[],
			{ x: 0, y: 0, zoom: 1 },
			{ x: 0, y: 0, zoom: 1 },
		);

		// Confirm no serialized entity carries a TransformTween.
		for (const entry of doc.entities) {
			expect(entry.components.TransformTween).toBeUndefined();
		}

		// Round-trip into a fresh world — the tween component should not
		// reappear; only Transform2D persists.
		const fresh = createWorld();
		deserializeWorld(fresh, doc, [Transform2D, TransformTween], []);
		const transform2dIds = fresh.query(Transform2D);
		expect(transform2dIds.length).toBe(1);
		expect(fresh.getComponent(transform2dIds[0], TransformTween)).toBeUndefined();
	});
});
