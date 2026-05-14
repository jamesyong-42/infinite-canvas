import { describe, expect, it } from 'vitest';
import { Card, createLayoutEngine, Dragging, Layer, Transform2D, Widget } from '../index.js';

// Post RFC-010 Phase 1 the promote/restore logic lives in
// `dragPromoteSystem` (registered with `before: 'cull'`) instead of two
// sync observers, so each Dragging-tag mutation must be followed by
// `engine.tick()` for the system to run before the assertion.

describe('dragPromoteSystem', () => {
	it('promotes a dragged Card widget to overlay and restores on drop', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Card, { preset: 'small', background: '#1C1C1E' }],
			[Layer, { name: 'base' }],
		]);

		engine.world.addTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'overlay' });

		engine.world.removeTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'base' });
	});

	it('restores the original layer (not always "base") on drop', () => {
		// A widget that lives in 'background' should return there after drag.
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Card, { preset: 'small', background: '#1C1C1E' }],
			[Layer, { name: 'background' }],
		]);

		engine.world.addTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'overlay' });

		engine.world.removeTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'background' });
	});

	it('defaults pre-drag layer to "base" when widget has no Layer component', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Card, { preset: 'small', background: '#1C1C1E' }],
		]);

		engine.world.addTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'overlay' });

		engine.world.removeTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'base' });
	});

	it('skips widgets without the Card component', () => {
		// Card-less widgets are bare debug surfaces; they don't get
		// card-shaped affordances (chrome, lift, drag-promote).
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Layer, { name: 'base' }],
		]);

		engine.world.addTag(e, Dragging);
		engine.tick();
		expect(engine.get(e, Layer)).toEqual({ name: 'base' });
	});

	it('skips R3F widgets — their stacking is handled by the compositor', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Widget, { surface: 'webgl', type: 'r3f-test' }],
			[Card, { preset: 'small', background: '#1C1C1E' }],
			[Layer, { name: 'base' }],
		]);

		engine.world.addTag(e, Dragging);
		engine.tick();
		// R3F widget chrome would occlude its own 3D content if promoted —
		// promotion is intentionally a DOM-only mechanism.
		expect(engine.get(e, Layer)).toEqual({ name: 'base' });
	});

	it('is idempotent: re-adding Dragging while promoted preserves the original', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Card, { preset: 'small', background: '#1C1C1E' }],
			[Layer, { name: 'background' }],
		]);

		engine.world.addTag(e, Dragging);
		engine.tick();
		// PreDragLayer is now stashed with 'background'. A spurious re-add
		// must not overwrite it with the now-current 'overlay'.
		engine.world.addTag(e, Dragging); // no-op in reactive-ecs (already set)
		engine.tick();
		engine.world.removeTag(e, Dragging);
		engine.tick();
		engine.world.addTag(e, Dragging);
		engine.tick();
		engine.world.removeTag(e, Dragging);
		engine.tick();

		expect(engine.get(e, Layer)).toEqual({ name: 'background' });
	});
});
