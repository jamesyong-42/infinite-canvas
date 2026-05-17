import { describe, expect, it } from 'vitest';
import {
	CameraResource,
	createLayoutEngine,
	MoveCommand,
	Selectable,
	Transform2D,
} from '../index.js';

// RFC-010 Phase 5 — a mutation-observing proxy wraps the World so every
// entity/component/tag mutation auto-sets EngineDirtyResource. These tests
// pin that contract via the public `flushIfDirty()` gate (no reaching into
// the resource directly).

describe('mutation proxy (RFC-010 Phase 5)', () => {
	it('auto-dirties on raw world.createEntity (no explicit markDirty)', () => {
		const engine = createLayoutEngine();
		engine.tick(); // settle initial nav-stack dirty
		expect(engine.flushIfDirty()).toBe(false);

		engine.world.createEntity();
		expect(engine.flushIfDirty()).toBe(true);
		expect(engine.flushIfDirty()).toBe(false); // cleanup cleared it
	});

	it('auto-dirties on raw world.addComponent / setComponent / removeComponent', () => {
		const engine = createLayoutEngine();
		const e = engine.world.createEntity();
		engine.tick();
		expect(engine.flushIfDirty()).toBe(false);

		engine.world.addComponent(e, Transform2D, {
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			rotation: 0,
		});
		expect(engine.flushIfDirty()).toBe(true);

		engine.world.setComponent(e, Transform2D, { x: 5 });
		expect(engine.flushIfDirty()).toBe(true);

		engine.world.removeComponent(e, Transform2D);
		expect(engine.flushIfDirty()).toBe(true);
	});

	it('auto-dirties on raw world.addTag / removeTag', () => {
		const engine = createLayoutEngine();
		const e = engine.world.createEntity();
		engine.tick();
		expect(engine.flushIfDirty()).toBe(false);

		engine.world.addTag(e, Selectable);
		expect(engine.flushIfDirty()).toBe(true);

		engine.world.removeTag(e, Selectable);
		expect(engine.flushIfDirty()).toBe(true);
	});

	it('auto-dirties on raw world.destroyEntity', () => {
		const engine = createLayoutEngine();
		const e = engine.world.createEntity();
		engine.tick();
		expect(engine.flushIfDirty()).toBe(false);

		engine.world.destroyEntity(e);
		expect(engine.flushIfDirty()).toBe(true);
	});

	it('does NOT dirty on read-only access (query / getComponent / getResource)', () => {
		const engine = createLayoutEngine();
		const e = engine.world.createEntity();
		engine.world.addComponent(e, Transform2D, {
			x: 1,
			y: 2,
			width: 3,
			height: 4,
			rotation: 0,
		});
		engine.tick();
		expect(engine.flushIfDirty()).toBe(false);

		// Pure reads through the proxy must not flip the dirty flag.
		engine.world.query(Transform2D);
		engine.world.getComponent(e, Transform2D);
		engine.world.hasComponent(e, Transform2D);
		void engine.world.currentTick;
		void engine.world.entityCount;

		expect(engine.flushIfDirty()).toBe(false);
	});

	it('proxy preserves the currentTick getter (not snapshotted)', () => {
		const engine = createLayoutEngine();
		const t0 = engine.world.currentTick;
		engine.tick();
		engine.tick();
		expect(engine.world.currentTick).toBe(t0 + 2);
	});

	it('invalidatePresent() dirties for non-ECS external state changes', () => {
		const engine = createLayoutEngine();
		engine.tick();
		expect(engine.flushIfDirty()).toBe(false);

		// Simulates the InfiniteCanvas CSS-vars / shader-uniform path: no ECS
		// mutation, but the present pipeline must still re-run.
		engine.invalidatePresent();
		expect(engine.flushIfDirty()).toBe(true);
		expect(engine.flushIfDirty()).toBe(false);
	});

	it('undo()/redo() auto-dirty via the proxied world (no explicit markDirty on those methods)', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 10, height: 10, rotation: 0 }],
		]);
		engine.execute(new MoveCommand([e], 25, 25, Transform2D));
		// Drain everything the execute() produced.
		while (engine.flushIfDirty()) {}
		expect(engine.flushIfDirty()).toBe(false);

		// `undo()` has NO explicit markDirty — it relies entirely on the
		// command mutating through the proxied `world` passed to
		// `commandBuffer.undo(world)`.
		engine.undo();
		expect(engine.get(e, Transform2D)?.x).toBe(0);
		expect(engine.flushIfDirty()).toBe(true);
		expect(engine.flushIfDirty()).toBe(false);

		// Same for `redo()`.
		engine.redo();
		expect(engine.get(e, Transform2D)?.x).toBe(25);
		expect(engine.flushIfDirty()).toBe(true);
	});

	it('does NOT dirty on setResource (recursion-safety contract — setResource is not a dirtying method)', () => {
		const engine = createLayoutEngine();
		engine.tick();
		expect(engine.flushIfDirty()).toBe(false);

		// `setResource` is deliberately excluded from the proxy's dirtying
		// methods (it would recurse on the EngineDirtyResource write and fire
		// on every system's per-tick resource writes). A direct resource
		// write must NOT flip the engine-dirty flag — only the engine's own
		// camera/viewport/nav methods (which keep an explicit markDirty) do.
		engine.world.setResource(CameraResource, { x: 5, y: 5 });
		expect(engine.flushIfDirty()).toBe(false);
	});
});
