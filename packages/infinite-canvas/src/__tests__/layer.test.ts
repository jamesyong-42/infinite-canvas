import { describe, expect, it } from 'vitest';
import { createLayoutEngine, Layer, LayerOrderResource, Transform2D } from '../index.js';

describe('Layer system (RFC-003 Phase 1)', () => {
	it('LayerOrderResource defaults to background → base → overlay', () => {
		const engine = createLayoutEngine();
		const order = engine.world.getResource(LayerOrderResource);
		expect(order.layers).toEqual(['background', 'base', 'overlay']);
	});

	it('Layer component stores name on an entity', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Layer, { name: 'overlay' }],
		]);
		expect(engine.get(e, Layer)).toEqual({ name: 'overlay' });
	});

	it('Layer.name can be updated reactively via setComponent', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Layer, { name: 'base' }],
		]);
		engine.set(e, Layer, { name: 'overlay' });
		expect(engine.get(e, Layer)).toEqual({ name: 'overlay' });
	});
});
