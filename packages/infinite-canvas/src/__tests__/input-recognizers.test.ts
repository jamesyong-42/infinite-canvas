import type { EntityId } from '@jamesyong42/reactive-ecs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoubleTapRecognizer } from '../react/input/recognizers/DoubleTapRecognizer.js';
import { DragRecognizer } from '../react/input/recognizers/DragRecognizer.js';
import { HoverRecognizer } from '../react/input/recognizers/HoverRecognizer.js';
import { PanRecognizer } from '../react/input/recognizers/PanRecognizer.js';
import { PinchRecognizer } from '../react/input/recognizers/PinchRecognizer.js';
import { TapRecognizer } from '../react/input/recognizers/TapRecognizer.js';
import type {
	InputEvent,
	InputEventType,
	InputManager,
	InputSource,
} from '../react/input/types.js';

/** Test-only manager: collects dispatched events; supports pickAt override. */
function makeFakeManager(
	opts: { pickAt?: (screen: { x: number; y: number }) => EntityId | null } = {},
) {
	const dispatched: InputEvent[] = [];
	// Stub engine — only `getCamera` is exercised here (PinchRecognizer's
	// synthetic-cancel world coord). Identity camera (zoom=1, x=0, y=0)
	// makes `screenToWorld(s) === s`, keeping test setup terse.
	// biome-ignore lint/suspicious/noExplicitAny: test-only stub.
	const stubEngine: any = {
		getCamera: () => ({ x: 0, y: 0, zoom: 1, gesturing: false }),
	};
	const manager: InputManager = {
		engine: stubEngine,
		attach: () => () => {},
		on: () => () => {},
		addRecognizer: () => () => {},
		setRouter: () => () => {},
		dispatch: (e: InputEvent) => {
			dispatched.push(e);
		},
		pickAt: opts.pickAt ?? (() => null),
		notifyGesturing: () => {},
	};
	return { manager, dispatched };
}

let mockTime = 1000;
function makeEvent(type: InputEventType, overrides: Partial<InputEvent> = {}): InputEvent {
	return {
		type,
		source: 'mouse',
		pointerId: 1,
		primary: true,
		screen: { x: 100, y: 100 },
		world: { x: 100, y: 100 },
		modifiers: { shift: false, ctrl: false, alt: false, meta: false },
		timestamp: mockTime,
		button: type === 'down' || type === 'up' ? 0 : null,
		...overrides,
	};
}

beforeEach(() => {
	mockTime = 1000;
});
afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// TapRecognizer
// ---------------------------------------------------------------------------

describe('TapRecognizer', () => {
	it('emits tap on quick up within tap window and dead zone', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down'), manager);
		mockTime = 1100;
		r.observe(makeEvent('up'), manager);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0].type).toBe('tap');
		expect(dispatched[0].gesture).toEqual({ kind: 'tap', count: 1 });
	});

	it('does not emit tap when up is past tap window', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down'), manager);
		mockTime = 1500; // 500ms later, past 250ms TAP_WINDOW_MS
		r.observe(makeEvent('up'), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('does not emit tap when up is past dead zone (mouse 4px)', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 100, y: 100 } }), manager);
		mockTime = 1100;
		r.observe(makeEvent('up', { screen: { x: 110, y: 100 } }), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('uses touch dead zone (8px) for touch-source events', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('down', { source: 'touch' as InputSource, screen: { x: 100, y: 100 } }),
			manager,
		);
		mockTime = 1100;
		// 6px movement — past mouse dz but within touch dz
		r.observe(
			makeEvent('up', { source: 'touch' as InputSource, screen: { x: 106, y: 100 } }),
			manager,
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0].type).toBe('tap');
	});

	it('clears pending tap on observed drag-start for same pointer', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down'), manager);
		r.observe(makeEvent('drag-start', { source: 'synthetic' }), manager);
		mockTime = 1100;
		r.observe(makeEvent('up'), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('clears pending tap on observed pinch-start', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down'), manager);
		r.observe(makeEvent('pinch-start', { source: 'synthetic' }), manager);
		mockTime = 1100;
		r.observe(makeEvent('up'), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('clears pending tap on cancel', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down'), manager);
		r.observe(makeEvent('cancel'), manager);
		mockTime = 1100;
		r.observe(makeEvent('up'), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('ignores down with non-zero non-null button (right click etc.)', () => {
		const r = new TapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { button: 2 }), manager);
		mockTime = 1100;
		r.observe(makeEvent('up'), manager);
		expect(dispatched).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// DoubleTapRecognizer
// ---------------------------------------------------------------------------

describe('DoubleTapRecognizer', () => {
	it('emits double-tap on second tap within window and distance', () => {
		const r = new DoubleTapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		);
		mockTime = 1100; // 100ms later
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0].type).toBe('double-tap');
		expect(dispatched[0].gesture).toEqual({ kind: 'tap', count: 2 });
	});

	it('does not emit double-tap if second tap is past window', () => {
		const r = new DoubleTapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		);
		mockTime = 2000; // 1s later, past 300ms DOUBLE_TAP_WINDOW_MS
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		);
		expect(dispatched).toHaveLength(0);
	});

	it('does not emit double-tap if second tap is past distance threshold', () => {
		const r = new DoubleTapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('tap', {
				gesture: { kind: 'tap', count: 1 },
				source: 'synthetic',
				screen: { x: 100, y: 100 },
			}),
			manager,
		);
		mockTime = 1100;
		r.observe(
			makeEvent('tap', {
				gesture: { kind: 'tap', count: 1 },
				source: 'synthetic',
				screen: { x: 200, y: 100 },
			}),
			manager,
		);
		expect(dispatched).toHaveLength(0);
	});

	it('after emitting double-tap, requires a fresh first tap', () => {
		const r = new DoubleTapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		);
		mockTime = 1100;
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		); // double-tap fires
		expect(dispatched).toHaveLength(1);
		mockTime = 1200;
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 1 }, source: 'synthetic' }),
			manager,
		); // 3rd tap — does not double-tap since previous was reset
		expect(dispatched).toHaveLength(1);
	});

	it('ignores tap synthetic events with count !== 1', () => {
		const r = new DoubleTapRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('tap', { gesture: { kind: 'tap', count: 2 }, source: 'synthetic' }),
			manager,
		);
		expect(dispatched).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// DragRecognizer
// ---------------------------------------------------------------------------

describe('DragRecognizer', () => {
	it('emits drag-start on first move past dead zone', () => {
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 100, y: 100 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 101, y: 101 } }), manager);
		expect(dispatched).toHaveLength(0); // within dead zone
		r.observe(makeEvent('move', { screen: { x: 110, y: 100 } }), manager);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0].type).toBe('drag-start');
	});

	it('emits drag-update for subsequent moves after drag-start', () => {
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 10, y: 0 } }), manager); // drag-start
		r.observe(makeEvent('move', { screen: { x: 20, y: 0 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 30, y: 0 } }), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['drag-start', 'drag-update', 'drag-update']);
	});

	it('emits drag-end on up after dragging', () => {
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 10, y: 0 } }), manager);
		r.observe(makeEvent('up', { screen: { x: 10, y: 0 } }), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['drag-start', 'drag-end']);
	});

	it('does not emit drag-end if up before crossing dead zone', () => {
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 1, y: 1 } }), manager);
		r.observe(makeEvent('up', { screen: { x: 1, y: 1 } }), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('cancel clears tracking without emitting drag-end (engine cancel handler owns rollback)', () => {
		// RFC-008 v5: a `cancel` arriving during a drag should NOT produce
		// a synthetic `drag-end` (which the engine handler would treat as
		// `cancelled: false` and commit). The InputManager dispatches
		// engine handlers BEFORE recognizers observe, so the engine
		// `cancel` handler has already rolled back via `cancelInteraction`
		// by the time DragRecognizer sees the same event. Recognizer just
		// clears its own tracking state.
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 10, y: 0 } }), manager);
		r.observe(makeEvent('cancel', { screen: { x: 10, y: 0 } }), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['drag-start']);
	});

	it('uses touch dead zone for touch-source events', () => {
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('down', { source: 'touch' as InputSource, screen: { x: 0, y: 0 } }),
			manager,
		);
		r.observe(
			makeEvent('move', { source: 'touch' as InputSource, screen: { x: 6, y: 0 } }),
			manager,
		);
		expect(dispatched).toHaveLength(0); // within touch dead zone
		r.observe(
			makeEvent('move', { source: 'touch' as InputSource, screen: { x: 10, y: 0 } }),
			manager,
		);
		expect(dispatched).toHaveLength(1);
	});

	it('drag-start gesture carries total + delta', () => {
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { screen: { x: 100, y: 100 } }), manager);
		r.observe(makeEvent('move', { screen: { x: 110, y: 105 } }), manager);
		const evt = dispatched[0];
		expect(evt.gesture?.kind).toBe('drag');
		if (evt.gesture?.kind === 'drag') {
			expect(evt.gesture.phase).toBe('start');
			expect(evt.gesture.total).toEqual({ x: 10, y: 5 });
		}
	});

	it('single-finger only: 2nd concurrent down is ignored while a pointer is tracked', () => {
		// RFC-008 § Recognizers: DragRecognizer is single-finger. PinchRecognizer
		// dispatches a synthetic `cancel` to retire the tracked pointer when a
		// 2nd finger arrives, so the engine never sees concurrent drag states.
		// Verify the 2nd `down` is rejected at the recognizer level.
		const r = new DragRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(makeEvent('down', { pointerId: 1, screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('down', { pointerId: 2, screen: { x: 100, y: 100 } }), manager);
		// 1st pointer drags past dead zone — emits drag-start.
		r.observe(makeEvent('move', { pointerId: 1, screen: { x: 10, y: 0 } }), manager);
		// 2nd pointer move is silently ignored (was never tracked).
		r.observe(makeEvent('move', { pointerId: 2, screen: { x: 110, y: 100 } }), manager);
		expect(dispatched.filter((e) => e.pointerId === 1)).toHaveLength(1);
		expect(dispatched.filter((e) => e.pointerId === 2)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// PinchRecognizer
// ---------------------------------------------------------------------------

describe('PinchRecognizer', () => {
	function down(pointerId: number, x: number, y: number): InputEvent {
		return makeEvent('down', { pointerId, source: 'touch', screen: { x, y } });
	}
	function move(pointerId: number, x: number, y: number): InputEvent {
		return makeEvent('move', { pointerId, source: 'touch', screen: { x, y } });
	}
	function up(pointerId: number, x: number, y: number): InputEvent {
		return makeEvent('up', { pointerId, source: 'touch', screen: { x, y } });
	}

	it('emits pinch-start on second touch finger', () => {
		const r = new PinchRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(down(1, 0, 0), manager);
		expect(dispatched).toHaveLength(0);
		r.observe(down(2, 100, 0), manager);
		const types = dispatched.map((e) => e.type);
		// Cancel for finger 1, cancel for finger 2, then pinch-start
		expect(types.filter((t) => t === 'cancel')).toHaveLength(2);
		expect(types).toContain('pinch-start');
	});

	it('emits pinch-update on either finger move', () => {
		const r = new PinchRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(down(1, 0, 0), manager);
		r.observe(down(2, 100, 0), manager);
		dispatched.length = 0;
		r.observe(move(1, -10, 0), manager); // fingers spread further → scale > 1
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0].type).toBe('pinch-update');
		if (dispatched[0].gesture?.kind === 'pinch') {
			expect(dispatched[0].gesture.scale).toBeGreaterThan(1);
		}
	});

	it('emits pinch-end when one finger lifts', () => {
		const r = new PinchRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(down(1, 0, 0), manager);
		r.observe(down(2, 100, 0), manager);
		dispatched.length = 0;
		r.observe(up(2, 100, 0), manager);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0].type).toBe('pinch-end');
	});

	it('ignores non-touch sources', () => {
		const r = new PinchRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(
			makeEvent('down', { pointerId: 1, source: 'mouse', screen: { x: 0, y: 0 } }),
			manager,
		);
		r.observe(
			makeEvent('down', { pointerId: 2, source: 'mouse', screen: { x: 100, y: 0 } }),
			manager,
		);
		expect(dispatched).toHaveLength(0);
	});

	it('after pinch-end, second pinch starts cleanly on next two-finger down', () => {
		const r = new PinchRecognizer();
		const { manager, dispatched } = makeFakeManager();
		r.observe(down(1, 0, 0), manager);
		r.observe(down(2, 100, 0), manager);
		r.observe(up(1, 0, 0), manager);
		r.observe(up(2, 100, 0), manager);
		dispatched.length = 0;
		r.observe(down(3, 0, 0), manager);
		r.observe(down(4, 100, 0), manager);
		const types = dispatched.map((e) => e.type);
		expect(types).toContain('pinch-start');
	});
});

// ---------------------------------------------------------------------------
// PanRecognizer
// ---------------------------------------------------------------------------

describe('PanRecognizer', () => {
	it('emits pan-update when single touch on empty space crosses dead zone', () => {
		const r = new PanRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => null });
		r.observe(makeEvent('down', { source: 'touch', screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { source: 'touch', screen: { x: 10, y: 0 } }), manager);
		r.observe(makeEvent('move', { source: 'touch', screen: { x: 20, y: 0 } }), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['pan-update']);
		if (dispatched[0].gesture?.kind === 'pan') {
			expect(dispatched[0].gesture.delta).toEqual({ x: 10, y: 0 });
		}
	});

	it('does not pan when touch is on entity', () => {
		const r = new PanRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => 42 as EntityId });
		r.observe(makeEvent('down', { source: 'touch', screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { source: 'touch', screen: { x: 50, y: 0 } }), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('does not pan for non-touch sources', () => {
		const r = new PanRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => null });
		r.observe(makeEvent('down', { source: 'mouse', screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { source: 'mouse', screen: { x: 50, y: 0 } }), manager);
		expect(dispatched).toHaveLength(0);
	});

	it('cancel clears pan tracking', () => {
		const r = new PanRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => null });
		r.observe(makeEvent('down', { source: 'touch', screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('cancel', { source: 'touch', screen: { x: 0, y: 0 } }), manager);
		r.observe(makeEvent('move', { source: 'touch', screen: { x: 50, y: 0 } }), manager);
		expect(dispatched).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// HoverRecognizer
// ---------------------------------------------------------------------------

describe('HoverRecognizer', () => {
	it('emits hover-enter on first move over an entity', () => {
		const r = new HoverRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => 42 as EntityId });
		r.observe(makeEvent('move'), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['hover-enter']);
		if (dispatched[0].gesture?.kind === 'hover') {
			expect(dispatched[0].gesture.entityId).toBe(42);
		}
	});

	it('emits hover-leave then hover-enter on entity transition', () => {
		let pickResult: EntityId | null = 1 as EntityId;
		const r = new HoverRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => pickResult });
		r.observe(makeEvent('move'), manager);
		dispatched.length = 0;
		pickResult = 2 as EntityId;
		r.observe(makeEvent('move'), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['hover-leave', 'hover-enter']);
	});

	it('emits hover-leave on transition to empty', () => {
		let pickResult: EntityId | null = 42 as EntityId;
		const r = new HoverRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => pickResult });
		r.observe(makeEvent('move'), manager);
		dispatched.length = 0;
		pickResult = null;
		r.observe(makeEvent('move'), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['hover-leave']);
	});

	it('does not re-emit on same entity', () => {
		const r = new HoverRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => 42 as EntityId });
		r.observe(makeEvent('move'), manager);
		r.observe(makeEvent('move'), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['hover-enter']);
	});

	it('emits final hover-leave on up', () => {
		const r = new HoverRecognizer();
		const { manager, dispatched } = makeFakeManager({ pickAt: () => 42 as EntityId });
		r.observe(makeEvent('move'), manager);
		dispatched.length = 0;
		r.observe(makeEvent('up'), manager);
		expect(dispatched.map((e) => e.type)).toEqual(['hover-leave']);
	});
});
