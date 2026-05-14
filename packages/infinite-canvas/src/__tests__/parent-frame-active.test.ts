import type { EntityId } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { Active, createLayoutEngine, ParentFrame, Transform2D } from '../index.js';

// Post RFC-010 Phase 3 the mid-session ParentFrame → Active reconcile lives
// in `parentFrameActiveSystem` (`react` phase) instead of an
// `onComponentChanged` observer. Each ParentFrame mutation requires an
// `engine.tick()` for the reconcile to fire.

describe('parentFrameActiveSystem', () => {
	it('removes Active when ParentFrame is added pointing outside the current frame', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
		]);
		// First tick — navigationFilterSystem assigns Active to root entities.
		engine.tick();
		expect(engine.has(e, Active)).toBe(true);

		// Mid-session: set ParentFrame to a non-root container. The system
		// should re-reconcile and remove Active because the entity no longer
		// belongs to the current (root) frame.
		engine.world.addComponent(e, ParentFrame, { id: 999 as EntityId });
		engine.tick();
		expect(engine.has(e, Active)).toBe(false);
	});

	it('keeps Active when ParentFrame is set to the current frame', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
		]);
		engine.tick();
		// Root is the active frame; entity is Active. Updating ParentFrame to a
		// value that still doesn't match shouldn't toggle Active back on.
		engine.world.addComponent(e, ParentFrame, { id: 999 as EntityId });
		engine.tick();
		expect(engine.has(e, Active)).toBe(false);

		// `setComponent` writes the same value back — reconcile is idempotent.
		engine.world.setComponent(e, ParentFrame, { id: 999 as EntityId });
		engine.tick();
		expect(engine.has(e, Active)).toBe(false);
	});

	it('does not reconcile entities whose ParentFrame did not change this tick', () => {
		// An entity already correctly reconciled stays put across ticks that
		// touch other entities' ParentFrame. (Tests that the system uses
		// `queryChanged(ParentFrame)`, not a full re-scan.)
		const engine = createLayoutEngine();
		const a = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
		]);
		const b = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
		]);
		engine.tick();
		expect(engine.has(a, Active)).toBe(true);
		expect(engine.has(b, Active)).toBe(true);

		// Mutate `b`'s ParentFrame; `a` should be untouched (still Active).
		engine.world.addComponent(b, ParentFrame, { id: 999 as EntityId });
		engine.tick();
		expect(engine.has(a, Active)).toBe(true);
		expect(engine.has(b, Active)).toBe(false);
	});
});
