import type { EntityId } from '@jamesyong42/reactive-ecs';
import { describe, expect, it, vi } from 'vitest';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { PointerAdapter } from '../react/input/adapters/PointerAdapter.js';
import type { InputEvent, InputManager } from '../react/input/types.js';

/**
 * RFC-008 — PointerAdapter unit tests. Verifies coordinate normalisation
 * (container-relative `screen` and per-pointer `delta`) under non-zero
 * container offsets, which is where the v1 delta math was wrong (delta
 * was computed against raw `clientX/Y` rather than container-relative
 * `screen`, leaking the container's left/top into every move's delta).
 */

function stubEngine(): LayoutEngine {
	// biome-ignore lint/suspicious/noExplicitAny: test-only stub.
	return {
		getCamera: () => ({ x: 0, y: 0, zoom: 1, gesturing: false }),
		pickAt: () => null,
	} as any;
}

interface FakeContainer {
	el: HTMLElement;
	fire: (type: string, e: PointerEvent) => void;
}

function makeContainer(rect: { left: number; top: number }): FakeContainer {
	const listeners = new Map<string, EventListener>();
	const el = {
		addEventListener: vi.fn((type: string, handler: EventListener) => {
			listeners.set(type, handler);
		}),
		removeEventListener: vi.fn((type: string) => {
			listeners.delete(type);
		}),
		getBoundingClientRect: () => ({
			x: rect.left,
			y: rect.top,
			top: rect.top,
			left: rect.left,
			right: rect.left + 1000,
			bottom: rect.top + 800,
			width: 1000,
			height: 800,
			toJSON: () => ({}),
		}),
	} as unknown as HTMLElement;
	return {
		el,
		fire: (type, e) => listeners.get(type)?.(e),
	};
}

function fakeManager(): { manager: InputManager; events: InputEvent[] } {
	const events: InputEvent[] = [];
	const manager = {
		engine: stubEngine(),
		dispatch: (e: InputEvent) => {
			events.push(e);
		},
		// Unused here.
		attach: () => () => {},
		on: () => () => {},
		addRecognizer: () => () => {},
		setRouter: () => () => {},
		pickAt: () => null as EntityId | null,
		notifyGesturing: () => {},
	} as unknown as InputManager;
	return { manager, events };
}

function pointer(type: string, opts: Partial<PointerEvent> & { clientX: number; clientY: number }) {
	return {
		type,
		pointerId: 1,
		isPrimary: true,
		button: 0,
		pointerType: 'mouse',
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		timeStamp: 0,
		...opts,
	} as unknown as PointerEvent;
}

describe('PointerAdapter', () => {
	it('produces container-relative screen coords on down/move', () => {
		const adapter = new PointerAdapter();
		const container = makeContainer({ left: 50, top: 30 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		container.fire('pointerdown', pointer('pointerdown', { clientX: 200, clientY: 100 }));
		container.fire('pointermove', pointer('pointermove', { clientX: 220, clientY: 110 }));

		expect(events[0].screen).toEqual({ x: 150, y: 70 });
		expect(events[1].screen).toEqual({ x: 170, y: 80 });
	});

	it('delta is computed against container-relative coords (not raw clientX/Y)', () => {
		// Regression for the v1 bug where lastByPointerId stored raw client
		// coords; on a container offset by (50, 30), every move's delta
		// arrived offset by that amount instead of zero between equal moves.
		const adapter = new PointerAdapter();
		const container = makeContainer({ left: 50, top: 30 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		container.fire('pointerdown', pointer('pointerdown', { clientX: 200, clientY: 100 }));
		container.fire('pointermove', pointer('pointermove', { clientX: 220, clientY: 110 }));
		container.fire('pointermove', pointer('pointermove', { clientX: 220, clientY: 110 }));

		// First move: delta from down position, container-relative.
		expect(events[1].delta).toEqual({ x: 20, y: 10 });
		// Second move: same client coords as previous → delta zero.
		expect(events[2].delta).toEqual({ x: 0, y: 0 });
	});

	it('down event has no delta (no prior position)', () => {
		const adapter = new PointerAdapter();
		const container = makeContainer({ left: 0, top: 0 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		container.fire('pointerdown', pointer('pointerdown', { clientX: 100, clientY: 100 }));

		expect(events[0].delta).toBeUndefined();
	});
});
