import { describe, expect, it } from 'vitest';
import { Container, ContainerCamera, createLayoutEngine, Transform2D, Widget } from '../index.js';

// Post RFC-010 Phase 3 the auto-attach lives in `containerCameraSystem`
// (`react` phase) instead of an `onComponentChanged` observer, so callers
// must `engine.tick()` for the attach to be visible.

describe('containerCameraSystem', () => {
	it('auto-attaches a default ContainerCamera when Container is added', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 200, height: 200, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'container' }],
			[Container, { enterable: true }],
		]);
		engine.tick();

		expect(engine.has(e, ContainerCamera)).toBe(true);
		expect(engine.get(e, ContainerCamera)).toEqual({ x: 0, y: 0, zoom: 1 });
	});

	it('does not overwrite a pre-existing ContainerCamera', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 200, height: 200, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'container' }],
			[Container, { enterable: true }],
			[ContainerCamera, { x: 100, y: 200, zoom: 2 }],
		]);
		engine.tick();

		expect(engine.get(e, ContainerCamera)).toEqual({ x: 100, y: 200, zoom: 2 });
	});

	it('does not attach to entities without Container', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 200, height: 200, rotation: 0 }],
			[Widget, { surface: 'dom', type: 'widget' }],
		]);
		engine.tick();

		expect(engine.has(e, ContainerCamera)).toBe(false);
	});
});
