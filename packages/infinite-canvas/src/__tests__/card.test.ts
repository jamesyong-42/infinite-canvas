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
import { createCardWidget } from '../react/widgets/card.js';

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

	it('archetype is selectable + draggable but not resizable, skips the selection frame, and is a snap target only', () => {
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
			snapSource: false,
			snapTarget: true,
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
		// createCardWidget now threads RFC-004 Phase 1 contract defaults into
		// every Card init; extra fields beyond `preset` are allowed.
		expect(cardInit?.[1]).toMatchObject({ preset: 'xl' });
		const cardData = cardInit?.[1] as
			| { accepts: readonly string[]; provides: readonly string[] }
			| undefined;
		expect(cardData?.accepts).toEqual([]);
		expect(cardData?.provides).toEqual([]);
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

describe('Card contract fields (RFC-004 Phase 1)', () => {
	it('defaults accepts / provides to empty arrays', () => {
		const engine = createLayoutEngine();
		engine.setViewport(1000, 800);
		const id = engine.createEntity([[Card, { preset: 'small' }]]);
		const card = engine.get(id, Card);
		expect(card?.accepts).toEqual([]);
		expect(card?.provides).toEqual([]);
	});

	it('preserves accepts / provides across cardSystem ticks', () => {
		// The cardSystem writes Transform2D.width/height every tick from
		// Card.preset. Because setComponent accepts Partial<T>, the contract
		// fields on the Card component itself must survive untouched.
		const engine = createLayoutEngine();
		engine.setViewport(1000, 800);
		const id = engine.createEntity([
			[
				Card,
				{
					preset: 'small',
					accepts: ['widget'],
					provides: ['widget'],
				},
			],
			[Transform2D, { x: 0, y: 0, width: 0, height: 0, rotation: 0 }],
		]);
		engine.tick();
		engine.tick();
		const card = engine.get(id, Card);
		expect(card?.accepts).toEqual(['widget']);
		expect(card?.provides).toEqual(['widget']);
	});

	it('preserves accepts / provides across a partial setComponent on Card', () => {
		// Regression guard: reactive-ecs `setComponent` takes `Partial<T>`.
		// If any future caller writes `setComponent(entity, Card, { preset: ... })`
		// without spreading the existing card, the new contract fields must
		// still survive the merge.
		const engine = createLayoutEngine();
		engine.setViewport(1000, 800);
		const id = engine.createEntity([
			[
				Card,
				{
					preset: 'small',
					accepts: ['widget'],
					provides: ['payload'],
				},
			],
		]);
		engine.set(id, Card, { preset: 'large' });
		const card = engine.get(id, Card);
		expect(card?.preset).toBe('large');
		expect(card?.accepts).toEqual(['widget']);
		expect(card?.provides).toEqual(['payload']);
	});

	it('accepts a widget binding with an `interaction` handler block', () => {
		// Verifies that registering a widget with the new interaction hooks
		// is accepted by the engine without error. The engine doesn't invoke
		// these handlers yet (that lands in Phase 4), but the shape must plumb.
		const engine = createLayoutEngine({
			widgets: [
				{
					type: 'contract-card',
					schema: stubSchema,
					defaultData: {},
					defaultSize: { width: 100, height: 100 },
					interaction: {
						onReceiveChild: ({ parent, child }) => ({
							consume: true,
							mutation: { parent, child },
						}),
						canAccept: () => true,
						applyMutation: () => {},
						revertMutation: () => {},
					},
				},
			],
		});
		engine.setViewport(1000, 800);
		expect(engine.getWidget('contract-card')?.interaction?.onReceiveChild).toBeTypeOf('function');
	});
});
