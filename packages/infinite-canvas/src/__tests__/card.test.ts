import { describe, expect, it } from 'vitest';
import {
	Card,
	createLayoutEngine,
	Draggable,
	Resizable,
	Selectable,
	SelectionFrame,
	Transform2D,
} from '../index.js';
import { createCardWidget } from '../react/card.js';

// Minimal Standard Schema v1 stub — we only need the `~standard` marker
// present; createCardWidget does not validate data itself.
// biome-ignore lint/suspicious/noExplicitAny: test stub
const stubSchema: any = {
	'~standard': {
		version: 1,
		vendor: 'test',
		// biome-ignore lint/suspicious/noExplicitAny: stub
		validate: (value: any) => ({ value }),
	},
};

function NullRender() {
	return null;
}

describe('createCardWidget', () => {
	it('returns paired widget + archetype with matching ids', () => {
		const card = createCardWidget({
			type: 'test-card',
			size: 'small',
			schema: stubSchema,
			defaultData: { title: 'hi' },
			render: NullRender,
		});

		expect(card.widget.type).toBe('test-card');
		expect(card.archetype.id).toBe('test-card');
		expect(card.archetype.widget).toBe('test-card');
	});

	it('sets defaultSize to the preset dimensions', () => {
		const small = createCardWidget({
			type: 'c-small',
			size: 'small',
			schema: stubSchema,
			defaultData: {},
			render: NullRender,
		});
		const large = createCardWidget({
			type: 'c-large',
			size: 'large',
			schema: stubSchema,
			defaultData: {},
			render: NullRender,
		});

		expect(small.widget.defaultSize).toEqual({ width: 155, height: 155 });
		expect(large.widget.defaultSize).toEqual({ width: 329, height: 345 });
		expect(small.archetype.defaultSize).toEqual({ width: 155, height: 155 });
	});

	it('archetype is selectable + draggable but not resizable, and skips the selection frame', () => {
		const card = createCardWidget({
			type: 'c-cap',
			size: 'medium',
			schema: stubSchema,
			defaultData: {},
			render: NullRender,
		});
		expect(card.archetype.interactive).toEqual({
			selectable: true,
			draggable: true,
			resizable: false,
			selectionFrame: false,
		});
	});

	it('archetype bundles the Card component with the chosen preset', () => {
		const card = createCardWidget({
			type: 'c-bundle',
			size: 'xl',
			schema: stubSchema,
			defaultData: {},
			render: NullRender,
		});
		const components = card.archetype.components ?? [];
		const cardInit = components.find((init) => init[0] === Card);
		expect(cardInit).toBeDefined();
		expect(cardInit?.[1]).toEqual({ preset: 'xl' });
	});

	it('spawn end-to-end: preset enforced, not resizable, is draggable, no selection frame', () => {
		const card = createCardWidget({
			type: 'c-e2e',
			size: 'medium',
			schema: stubSchema,
			defaultData: { label: 'x' },
			render: NullRender,
		});
		const engine = createLayoutEngine({
			widgets: [card.widget],
			archetypes: [card.archetype],
		});
		engine.setViewport(1000, 800);

		const id = engine.spawn('c-e2e', { at: { x: 0, y: 0 } });
		engine.tick();

		expect(engine.has(id, Draggable)).toBe(true);
		expect(engine.has(id, Selectable)).toBe(true);
		expect(engine.has(id, Resizable)).toBe(false);
		expect(engine.has(id, SelectionFrame)).toBe(false);

		const t = engine.get(id, Transform2D);
		expect(t?.width).toBe(329);
		expect(t?.height).toBe(155);
	});
});
