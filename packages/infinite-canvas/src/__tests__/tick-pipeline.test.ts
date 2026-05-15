import { describe, expect, it, vi } from 'vitest';
import { Container, createLayoutEngine, Transform2D, Widget } from '../index.js';

// RFC-010 Phase 4 — the inline tail of `engine.tick()` is now phase-
// ordered systems writing resources. These tests pin the engine's public
// contract (getVisibleEntities / getFrameChanges / flushIfDirty / the
// navigationChanged signal) so the extraction is behaviour-preserving.
// Assertions go through the public API only — the backing resources are
// an implementation detail.

describe('tick pipeline (RFC-010 Phase 4)', () => {
	it('visibilitySystem populates getVisibleEntities() after a tick', () => {
		const engine = createLayoutEngine();
		engine.setViewport(1000, 800); // cullSystem early-returns on a 0×0 viewport
		const e = engine.createEntity([
			[Transform2D, { x: 10, y: 20, width: 100, height: 100, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'w' }],
		]);
		engine.tick();

		const visible = engine.getVisibleEntities();
		expect(visible.map((v) => v.entityId)).toContain(e);
		expect(visible.find((v) => v.entityId === e)).toMatchObject({
			x: 10,
			y: 20,
			width: 100,
			height: 100,
		});
	});

	it('frameChangesSystem reports entered then exited across ticks', () => {
		const engine = createLayoutEngine();
		engine.setViewport(1000, 800);
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 50, height: 50, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'w' }],
		]);
		engine.tick();
		expect(engine.getFrameChanges().entered).toContain(e);
		expect(engine.getFrameChanges().exited).not.toContain(e);

		engine.destroyEntity(e);
		engine.tick();
		expect(engine.getFrameChanges().exited).toContain(e);
	});

	it('flushIfDirty() returns false when idle and true after a mutation, ticking once', () => {
		const engine = createLayoutEngine();
		engine.tick(); // settle the initial nav-stack dirty

		expect(engine.flushIfDirty()).toBe(false);

		engine.createEntity([[Transform2D, { x: 0, y: 0, width: 1, height: 1, rotation: 0 }]]);
		expect(engine.flushIfDirty()).toBe(true);
		// Cleanup phase cleared the flag; nothing left to flush.
		expect(engine.flushIfDirty()).toBe(false);
	});

	it('preserves the navigationChanged signal even though navigationFilter resets the flag mid-tick (RFC-004 Phase 0c)', () => {
		const engine = createLayoutEngine();
		const container = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 200, height: 200, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'container' }],
			[Container, { enterable: true }],
		]);
		engine.tick();

		engine.enterContainer(container);
		engine.tick();
		// `navStackCaptureSystem` (input phase) snapshots `navStack.changed`
		// before `navigationFilterSystem` (control) clears it;
		// `frameChangesSystem` (present) reads the snapshot.
		expect(engine.getFrameChanges().navigationChanged).toBe(true);
		expect(engine.getNavigationDepth()).toBe(1);

		// A plain mutation tick with no navigation must not report it.
		engine.createEntity([[Transform2D, { x: 0, y: 0, width: 1, height: 1, rotation: 0 }]]);
		engine.tick();
		expect(engine.getFrameChanges().navigationChanged).toBe(false);
	});

	it('emitFrameSystem still fires onFrame subscribers each tick', () => {
		const engine = createLayoutEngine();
		const spy = vi.fn();
		const unsub = engine.onFrame(spy);

		engine.tick();
		engine.tick();
		expect(spy).toHaveBeenCalledTimes(2);

		unsub();
		engine.tick();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('camera mutations surface as FrameChanges.cameraChanged for exactly one tick', () => {
		const engine = createLayoutEngine();
		engine.tick();

		engine.panBy(10, 10);
		engine.tick();
		expect(engine.getFrameChanges().cameraChanged).toBe(true);

		// Flag is per-tick: a subsequent tick with no camera change clears it.
		engine.createEntity([[Transform2D, { x: 0, y: 0, width: 1, height: 1, rotation: 0 }]]);
		engine.tick();
		expect(engine.getFrameChanges().cameraChanged).toBe(false);
	});
});
