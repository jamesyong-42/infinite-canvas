import type { EntityId } from '@jamesyong42/reactive-ecs';
import { describe, expect, it, vi } from 'vitest';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { ClickAdapter } from '../react/input/adapters/ClickAdapter.js';
import type { InputEvent, InputManager } from '../react/input/types.js';

/**
 * RFC-008 v6 — ClickAdapter unit tests. Verifies the adapter dispatches
 * `click` / `dblclick` / `contextmenu` InputEvents with container-relative
 * coordinates, honors the native-interactive skip semantics, and always
 * preventDefault's `contextmenu` (canvas isn't a place for the browser
 * context menu).
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
	fire: (type: string, e: MouseEvent) => void;
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
		attach: () => () => {},
		on: () => () => {},
		addRecognizer: () => () => {},
		setRouter: () => () => {},
		pickAt: () => null as EntityId | null,
		notifyGesturing: () => {},
	} as unknown as InputManager;
	return { manager, events };
}

interface ClickOpts extends Partial<MouseEvent> {
	clientX: number;
	clientY: number;
	target?: EventTarget | null;
}

function clickEvent(type: string, opts: ClickOpts) {
	const preventDefault = vi.fn();
	return {
		type,
		button: 0,
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		timeStamp: 0,
		preventDefault,
		...opts,
	} as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function targetMatching(selector: string | null): EventTarget {
	return {
		closest: vi.fn((sel: string) => (selector !== null && sel.includes(selector) ? {} : null)),
	} as unknown as EventTarget;
}

describe('ClickAdapter', () => {
	it('dispatches click as a container-relative InputEvent', () => {
		const adapter = new ClickAdapter();
		const container = makeContainer({ left: 50, top: 30 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		container.fire(
			'click',
			clickEvent('click', {
				clientX: 200,
				clientY: 100,
				target: targetMatching(null),
			}),
		);

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('click');
		expect(events[0].screen).toEqual({ x: 150, y: 70 });
		expect(events[0].button).toBe(0);
	});

	it('dispatches dblclick as a separate InputEvent type', () => {
		const adapter = new ClickAdapter();
		const container = makeContainer({ left: 0, top: 0 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		container.fire(
			'dblclick',
			clickEvent('dblclick', {
				clientX: 100,
				clientY: 100,
				target: targetMatching(null),
			}),
		);

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('dblclick');
	});

	it('preventDefaults contextmenu and dispatches it as InputEvent', () => {
		const adapter = new ClickAdapter();
		const container = makeContainer({ left: 0, top: 0 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		const e = clickEvent('contextmenu', {
			clientX: 100,
			clientY: 100,
			target: targetMatching(null),
		});
		container.fire('contextmenu', e);

		expect(e.preventDefault).toHaveBeenCalled();
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('contextmenu');
	});

	it('skips click on native-interactive targets (button, input, etc.)', () => {
		// The selector match prevents `<button>` clicks inside DOM widgets
		// from spawning a canvas-level selection on top of the button's own
		// onClick. Authors who want canvas coexistence call
		// `e.stopPropagation()` from the button's handler.
		const adapter = new ClickAdapter();
		const container = makeContainer({ left: 0, top: 0 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		container.fire(
			'click',
			clickEvent('click', {
				clientX: 100,
				clientY: 100,
				target: targetMatching('button'),
			}),
		);

		expect(events).toHaveLength(0);
	});

	it('still preventDefaults contextmenu on native-interactive but does not dispatch', () => {
		// preventDefault must run unconditionally — we never want the
		// browser context menu on the canvas, including over inputs (the
		// browser's own input context menu would still appear; we only
		// suppress the global one).
		const adapter = new ClickAdapter();
		const container = makeContainer({ left: 0, top: 0 });
		const { manager, events } = fakeManager();
		adapter.attach(container.el, manager);

		const e = clickEvent('contextmenu', {
			clientX: 100,
			clientY: 100,
			target: targetMatching('input'),
		});
		container.fire('contextmenu', e);

		expect(e.preventDefault).toHaveBeenCalled();
		expect(events).toHaveLength(0);
	});

	it('detacher removes the three listeners', () => {
		const adapter = new ClickAdapter();
		const container = makeContainer({ left: 0, top: 0 });
		const { manager } = fakeManager();
		const detach = adapter.attach(container.el, manager);
		detach();

		expect(container.el.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
		expect(container.el.removeEventListener).toHaveBeenCalledWith('dblclick', expect.any(Function));
		expect(container.el.removeEventListener).toHaveBeenCalledWith(
			'contextmenu',
			expect.any(Function),
		);
	});
});
