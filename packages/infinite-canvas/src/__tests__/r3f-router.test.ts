import { describe, expect, it, vi } from 'vitest';
import { R3FRouter } from '../react/input/routers/R3FRouter.js';
import type { InputEvent, InputEventType } from '../react/input/types.js';

// Constructor expects an R3FEventManagerLike getter; vitest's `Mock` typing
// with optional ctor signatures doesn't unify with our plain handler shape,
// so cast the mock managers at construction sites. This is test-only and
// the shape is exercised by every assertion below.
// biome-ignore lint/suspicious/noExplicitAny: test-only type bridging.
type AnyManager = any;

/**
 * RFC-008 v5 — `R3FRouter` is a pure dispatcher. Tests mock the R3F
 * event manager and verify the InputEventType → R3F handler mapping
 * plus the synthetic / missing-native short-circuits.
 */

interface MockManager {
	handlers: {
		onPointerDown: ReturnType<typeof vi.fn>;
		onPointerMove: ReturnType<typeof vi.fn>;
		onPointerUp: ReturnType<typeof vi.fn>;
		onPointerCancel: ReturnType<typeof vi.fn>;
	};
}

function createMockManager(): MockManager {
	return {
		handlers: {
			onPointerDown: vi.fn(),
			onPointerMove: vi.fn(),
			onPointerUp: vi.fn(),
			onPointerCancel: vi.fn(),
		},
	};
}

function createEvent(type: InputEventType, native?: Event): InputEvent {
	return {
		type,
		source: 'mouse',
		pointerId: 1,
		primary: true,
		screen: { x: 0, y: 0 },
		world: { x: 0, y: 0 },
		modifiers: { shift: false, ctrl: false, alt: false, meta: false },
		timestamp: 0,
		native,
	};
}

describe('R3FRouter', () => {
	it('declares the webgl surface', () => {
		const router = new R3FRouter(() => null);
		expect(router.surface).toBe('webgl');
	});

	it.each([
		['down', 'onPointerDown'],
		['move', 'onPointerMove'],
		['up', 'onPointerUp'],
		['cancel', 'onPointerCancel'],
	] as const)('routes %s → %s with the native event', (eventType, handlerName) => {
		const manager = createMockManager();
		const router = new R3FRouter(() => manager as AnyManager);
		const native = new Event('pointerdown');

		router.route(createEvent(eventType, native), 42);

		expect(manager.handlers[handlerName]).toHaveBeenCalledTimes(1);
		expect(manager.handlers[handlerName]).toHaveBeenCalledWith(native);

		// Sibling handlers must not fire.
		for (const name of Object.keys(manager.handlers) as (keyof typeof manager.handlers)[]) {
			if (name !== handlerName) expect(manager.handlers[name]).not.toHaveBeenCalled();
		}
	});

	it('does nothing when the event has no native (synthetic recognizer events)', () => {
		const manager = createMockManager();
		const router = new R3FRouter(() => manager as AnyManager);

		router.route(createEvent('down', undefined), 42);

		for (const fn of Object.values(manager.handlers)) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it('does nothing when the event type has no R3F mapping (e.g. wheel, tap, drag-update)', () => {
		const manager = createMockManager();
		const router = new R3FRouter(() => manager as AnyManager);
		const native = new Event('whatever');

		for (const t of ['wheel', 'tap', 'drag-start', 'pinch-update', 'hover-enter'] as const) {
			router.route(createEvent(t, native), 42);
		}

		for (const fn of Object.values(manager.handlers)) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it('does nothing when the manager is unavailable', () => {
		const router = new R3FRouter(() => null);
		const native = new Event('pointerdown');
		expect(() => router.route(createEvent('down', native), 42)).not.toThrow();
	});

	it('does nothing when the manager has no handlers map yet', () => {
		const router = new R3FRouter(() => ({ handlers: undefined }));
		const native = new Event('pointerdown');
		expect(() => router.route(createEvent('down', native), 42)).not.toThrow();
	});

	it('reads the manager lazily on every route call (late-bound R3F mount)', () => {
		// Simulates: InputManager + router constructed before R3F's
		// <Canvas> populates the event manager. The first `route` call
		// finds nothing; later calls find the manager once it's wired.
		let manager: MockManager | null = null;
		const router = new R3FRouter(() => manager as AnyManager);
		const native = new Event('pointerdown');

		router.route(createEvent('down', native), 42);
		// No manager yet — nothing should throw, nothing should dispatch.

		manager = createMockManager();
		router.route(createEvent('down', native), 42);
		expect(manager.handlers.onPointerDown).toHaveBeenCalledTimes(1);
	});
});
