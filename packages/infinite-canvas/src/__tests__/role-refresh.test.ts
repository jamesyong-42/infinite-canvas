import { describe, expect, it } from 'vitest';
import {
	CursorHint,
	createLayoutEngine,
	Draggable,
	InteractionRole,
	Selectable,
	Transform2D,
} from '../index.js';

// Post RFC-010 Phase 3 the auto-attach of `InteractionRole` / `CursorHint`
// based on Draggable/Selectable tag presence lives in `roleRefreshSystem`
// (`react` phase), not in four sync tag observers. Each tag mutation
// requires an `engine.tick()` for the refresh to be visible.

describe('roleRefreshSystem', () => {
	it('attaches InteractionRole + CursorHint when Draggable is present', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Draggable],
		]);
		engine.tick();

		expect(engine.get(e, InteractionRole)?.role).toEqual({ type: 'drag' });
		expect(engine.get(e, CursorHint)).toEqual({ hover: 'grab', active: 'grabbing' });
	});

	it('attaches select role (no CursorHint) when only Selectable is present', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Selectable],
		]);
		engine.tick();

		expect(engine.get(e, InteractionRole)?.role).toEqual({ type: 'select' });
		expect(engine.has(e, CursorHint)).toBe(false);
	});

	it('removes InteractionRole + CursorHint when both tags are removed', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Selectable],
			[Draggable],
		]);
		engine.tick();
		expect(engine.has(e, InteractionRole)).toBe(true);

		engine.world.removeTag(e, Draggable);
		engine.world.removeTag(e, Selectable);
		engine.tick();
		expect(engine.has(e, InteractionRole)).toBe(false);
		expect(engine.has(e, CursorHint)).toBe(false);
	});

	it('upgrades select → drag when Draggable is added later', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Selectable],
		]);
		engine.tick();
		expect(engine.get(e, InteractionRole)?.role.type).toBe('select');

		engine.world.addTag(e, Draggable);
		engine.tick();
		expect(engine.get(e, InteractionRole)?.role.type).toBe('drag');
		expect(engine.get(e, CursorHint)).toEqual({ hover: 'grab', active: 'grabbing' });
	});

	it('leaves entities with a custom (non-drag/select/canvas) role alone', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
			[Draggable],
			[InteractionRole, { layer: 5, role: { type: 'resize-handle', resizeHandle: 'se' } }],
		]);
		engine.tick();

		// Custom role survives; the system bails before clobbering it.
		expect(engine.get(e, InteractionRole)?.role.type).toBe('resize-handle');
	});

	it('does not attach InteractionRole to entities with neither tag', () => {
		const engine = createLayoutEngine();
		const e = engine.createEntity([
			[Transform2D, { x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
		]);
		engine.tick();

		expect(engine.has(e, InteractionRole)).toBe(false);
		expect(engine.has(e, CursorHint)).toBe(false);
	});
});
