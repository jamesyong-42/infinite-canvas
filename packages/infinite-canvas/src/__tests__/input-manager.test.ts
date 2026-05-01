import type { EntityId } from '@jamesyong42/reactive-ecs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { InputManager } from '../react/input/InputManager.js';
import type {
	Adapter,
	InputEvent,
	InputEventType,
	Recognizer,
	WidgetSurfaceRouter,
} from '../react/input/types.js';

/** Stub engine: only the surface InputManager touches. */
function createStubEngine(
	opts: {
		pickAt?: (x: number, y: number) => EntityId | null;
		getSurface?: (entityId: EntityId) => 'dom' | 'webgl' | 'webview' | null;
	} = {},
): LayoutEngine {
	const setGesturing = vi.fn();
	const pickAt = vi.fn(opts.pickAt ?? (() => null));
	const getSurface = opts.getSurface ?? (() => null);
	const get = vi.fn((entityId: EntityId, type: { name: string }) => {
		if (type.name === 'Widget') {
			const surface = getSurface(entityId);
			return surface ? { type: '', surface } : undefined;
		}
		return undefined;
	});
	const getCamera = vi.fn(() => ({ x: 0, y: 0, zoom: 1, gesturing: false }));
	return {
		pickAt,
		get,
		getCamera,
		setGesturing,
	} as unknown as LayoutEngine;
}

function makeContainer(): HTMLElement {
	// Minimal fake; we don't exercise listener attachment here, only dispatch.
	return {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		getBoundingClientRect: () => ({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			toJSON: () => ({}),
		}),
	} as unknown as HTMLElement;
}

function makeEvent(type: InputEventType, overrides: Partial<InputEvent> = {}): InputEvent {
	return {
		type,
		source: 'mouse',
		pointerId: 1,
		primary: true,
		screen: { x: 100, y: 100 },
		world: { x: 100, y: 100 },
		modifiers: { shift: false, ctrl: false, alt: false, meta: false },
		timestamp: Date.now(),
		...overrides,
	};
}

class NoopAdapter implements Adapter {
	attached = false;
	detached = false;
	attach(): () => void {
		this.attached = true;
		return () => {
			this.detached = true;
		};
	}
}

describe('InputManager', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	describe('lifecycle', () => {
		it('attach mounts adapters and detacher unmounts them', () => {
			const adapter = new NoopAdapter();
			const m = new InputManager(createStubEngine(), makeContainer(), [adapter]);
			const detach = m.attach();
			expect(adapter.attached).toBe(true);
			expect(adapter.detached).toBe(false);
			detach();
			expect(adapter.detached).toBe(true);
		});

		it('detach calls reset on recognizers', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const reset = vi.fn();
			m.addRecognizer({ observe: () => {}, reset });
			const detach = m.attach();
			detach();
			expect(reset).toHaveBeenCalledTimes(1);
		});

		it('attach with no adapters still works', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const detach = m.attach();
			expect(() => detach()).not.toThrow();
		});
	});

	describe('handler registration', () => {
		it('on registers a handler and dispatches to it', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const handler = vi.fn();
			m.on('down', handler);
			m.dispatch(makeEvent('down'));
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('on returns an unsubscribe function', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const handler = vi.fn();
			const off = m.on('down', handler);
			off();
			m.dispatch(makeEvent('down'));
			expect(handler).not.toHaveBeenCalled();
		});

		it('multiple handlers for the same type all fire', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const h1 = vi.fn();
			const h2 = vi.fn();
			m.on('down', h1);
			m.on('down', h2);
			m.dispatch(makeEvent('down'));
			expect(h1).toHaveBeenCalledTimes(1);
			expect(h2).toHaveBeenCalledTimes(1);
		});

		it('handlers only fire for matching event type', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const downHandler = vi.fn();
			const moveHandler = vi.fn();
			m.on('down', downHandler);
			m.on('move', moveHandler);
			m.dispatch(makeEvent('down'));
			expect(downHandler).toHaveBeenCalledTimes(1);
			expect(moveHandler).not.toHaveBeenCalled();
		});

		it('a throwing handler does not break the pipeline', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const h1 = vi.fn(() => {
				throw new Error('boom');
			});
			const h2 = vi.fn();
			m.on('down', h1);
			m.on('down', h2);
			m.dispatch(makeEvent('down'));
			expect(h2).toHaveBeenCalledTimes(1);
			expect(errSpy).toHaveBeenCalled();
			errSpy.mockRestore();
		});
	});

	describe('recognizers', () => {
		it('addRecognizer subscribes; observe runs after handlers', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const order: string[] = [];
			m.on('down', () => order.push('handler'));
			const recognizer: Recognizer = {
				observe: () => order.push('recognizer'),
			};
			m.addRecognizer(recognizer);
			m.dispatch(makeEvent('down'));
			expect(order).toEqual(['handler', 'recognizer']);
		});

		it('addRecognizer returns an unsubscribe function', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const observe = vi.fn();
			const off = m.addRecognizer({ observe });
			m.dispatch(makeEvent('down'));
			expect(observe).toHaveBeenCalledTimes(1);
			off();
			m.dispatch(makeEvent('move'));
			expect(observe).toHaveBeenCalledTimes(1); // unchanged after off()
		});

		it('a throwing recognizer does not break later recognizers', () => {
			const m = new InputManager(createStubEngine(), makeContainer(), []);
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const r1Observe = vi.fn(() => {
				throw new Error('boom');
			});
			const r2Observe = vi.fn();
			m.addRecognizer({ observe: r1Observe });
			m.addRecognizer({ observe: r2Observe });
			m.dispatch(makeEvent('down'));
			expect(r2Observe).toHaveBeenCalledTimes(1);
			errSpy.mockRestore();
		});
	});

	describe('routers', () => {
		it('setRouter routes events when entity hit and surface matches', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent('down'));
			expect(router.route).toHaveBeenCalledTimes(1);
			expect(router.route).toHaveBeenCalledWith(expect.objectContaining({ type: 'down' }), 42);
		});

		it('routing skipped when no entity at point', () => {
			const engine = createStubEngine({ pickAt: () => null });
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent('down'));
			expect(router.route).not.toHaveBeenCalled();
		});

		it('routing skipped when surface mismatches', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'dom',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent('down'));
			expect(router.route).not.toHaveBeenCalled();
		});

		it('routing skipped for synthetic events', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent('drag-start', { source: 'synthetic' }));
			expect(router.route).not.toHaveBeenCalled();
		});

		it('routing skipped for non-pointer event types (wheel)', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent('wheel', { source: 'wheel' }));
			expect(router.route).not.toHaveBeenCalled();
		});

		it.each([
			'click',
			'dblclick',
			'contextmenu',
		] as const)('routes %s family events through the surface router (v6 unification)', (type) => {
			// Pre-v6 these were registered by R3F's `connect` listener and
			// bypassed the InputManager entirely — the engine couldn't
			// observe clicks, so capturing meshes broke widget selection.
			// v6 puts them on the same path as down/move/up.
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent(type));
			expect(router.route).toHaveBeenCalledTimes(1);
			expect(router.route).toHaveBeenCalledWith(expect.objectContaining({ type }), 42);
		});

		it('routing skipped for pointerleave (cursor exits — no entity to deliver to)', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			m.setRouter(router);
			m.dispatch(makeEvent('pointerleave'));
			expect(router.route).not.toHaveBeenCalled();
		});

		it('setRouter returns an unsubscribe function', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const router: WidgetSurfaceRouter = {
				surface: 'webgl',
				route: vi.fn(),
			};
			const off = m.setRouter(router);
			off();
			m.dispatch(makeEvent('down'));
			expect(router.route).not.toHaveBeenCalled();
		});

		it('router is invoked before handlers', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const order: string[] = [];
			m.on('down', () => order.push('handler'));
			m.setRouter({
				surface: 'webgl',
				route: () => order.push('router'),
			});
			m.dispatch(makeEvent('down'));
			expect(order).toEqual(['router', 'handler']);
		});

		it('a throwing router does not break the pipeline', () => {
			const engine = createStubEngine({
				pickAt: () => 42 as EntityId,
				getSurface: () => 'webgl',
			});
			const m = new InputManager(engine, makeContainer(), []);
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const handler = vi.fn();
			m.on('down', handler);
			m.setRouter({
				surface: 'webgl',
				route: () => {
					throw new Error('boom');
				},
			});
			m.dispatch(makeEvent('down'));
			expect(handler).toHaveBeenCalledTimes(1);
			errSpy.mockRestore();
		});
	});

	describe('pickAt', () => {
		it('delegates to engine.pickAt with screen coords', () => {
			const engine = createStubEngine({
				pickAt: (x, y) => (x === 5 && y === 7 ? (99 as EntityId) : null),
			});
			const m = new InputManager(engine, makeContainer(), []);
			expect(m.pickAt({ x: 5, y: 7 })).toBe(99);
			expect(m.pickAt({ x: 0, y: 0 })).toBe(null);
		});
	});

	describe('notifyGesturing', () => {
		it('calls engine.setGesturing(true) immediately', () => {
			const engine = createStubEngine();
			const m = new InputManager(engine, makeContainer(), []);
			m.notifyGesturing();
			expect(engine.setGesturing).toHaveBeenCalledWith(true);
		});

		it('calls engine.setGesturing(false) after the idle window', () => {
			const engine = createStubEngine();
			const m = new InputManager(engine, makeContainer(), []);
			m.notifyGesturing();
			expect(engine.setGesturing).toHaveBeenCalledWith(true);
			vi.advanceTimersByTime(199);
			expect(engine.setGesturing).not.toHaveBeenCalledWith(false);
			vi.advanceTimersByTime(2);
			expect(engine.setGesturing).toHaveBeenCalledWith(false);
		});

		it('successive notifyGesturing calls debounce the false call', () => {
			const engine = createStubEngine();
			const m = new InputManager(engine, makeContainer(), []);
			m.notifyGesturing();
			vi.advanceTimersByTime(150);
			m.notifyGesturing();
			vi.advanceTimersByTime(150);
			expect(engine.setGesturing).not.toHaveBeenCalledWith(false);
			vi.advanceTimersByTime(60);
			expect(engine.setGesturing).toHaveBeenCalledWith(false);
		});
	});
});
