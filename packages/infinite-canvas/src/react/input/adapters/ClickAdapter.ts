import { screenToWorld } from '../../../ecs/math.js';
import { inputLog } from '../debug.js';
import type { Adapter, Button, InputEvent, InputManager, InputSource } from '../types.js';
import { NATIVE_INTERACTIVE_SELECTOR } from './native-interactive.js';

/**
 * Click / dblclick / contextmenu adapter (RFC-008 v6).
 *
 * The browser fires click / dblclick / contextmenu through a native event
 * channel that's distinct from `pointerdown` / `pointerup` — they're
 * synthesised after the pointer cycle completes (down → up with little
 * movement, double-click within a short window, right-click). Pre-v6 the
 * canvas had no adapter for these: R3F registered its own listeners on
 * the container via `EventManager.connect`, and the InputManager pipeline
 * never saw them. Two side effects:
 *
 *   1. A click on a mesh that called `setPointerCapture` skipped the
 *      `tap` recognizer (capture-claim) so the engine's selection logic
 *      didn't run — the widget didn't select.
 *   2. Clicks couldn't be observed by recognizers / handlers / external
 *      listeners through the manager, only via direct R3F mesh handlers.
 *
 * v6 makes click / dblclick / contextmenu first-class `InputEvent`s. The
 * adapter dispatches them through `InputManager.dispatch`, which routes
 * to the surface router (R3FRouter for webgl widgets — invokes the
 * mesh's `onClick` etc.) and fires engine handlers (which run
 * `selectEntity` for click, `enterContainer` for dblclick).
 *
 * `preventDefault` discipline:
 *   - `click` / `dblclick`: never. Browser focus / activation must run.
 *   - `contextmenu`: always. Canvas isn't a place for the browser context
 *     menu.
 *
 * Native-interactive skip mirrors `PointerAdapter`: a click landing on a
 * `<button>` / `<input>` / etc. inside a DOM widget is suppressed at the
 * adapter so the widget body doesn't get re-selected over the user's
 * intent (typing, button activation, etc.). Authors who want canvas-level
 * coexistence with their own native interactive call
 * `e.stopPropagation()` so the click never reaches the container.
 */
export class ClickAdapter implements Adapter {
	attach(container: HTMLElement, manager: InputManager): () => void {
		const make = (type: 'click' | 'dblclick' | 'contextmenu', e: MouseEvent): InputEvent => {
			const rect = container.getBoundingClientRect();
			const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			const camera = manager.engine.getCamera();
			const world = screenToWorld(screen.x, screen.y, camera);
			const button: Button = (e.button as 0 | 1 | 2) ?? null;

			return {
				type,
				source: clickSource(e),
				// Modern browsers fire `PointerEvent` for click / dblclick /
				// contextmenu (it extends MouseEvent), so `pointerId` is often
				// available; older paths fall back to 0. Recognizers don't
				// observe click events, so this only matters for routers and
				// downstream handlers that want to correlate with the
				// preceding pointerdown.
				pointerId: pointerIdOf(e),
				primary: true,
				screen,
				world,
				button,
				modifiers: {
					shift: e.shiftKey,
					ctrl: e.ctrlKey,
					alt: e.altKey,
					meta: e.metaKey,
				},
				timestamp: e.timeStamp,
				native: e,
			};
		};

		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			const targetTag = target ? `${target.tagName}${target.id ? `#${target.id}` : ''}` : 'null';
			if (target?.closest(NATIVE_INTERACTIVE_SELECTOR)) {
				inputLog('Adapter', `click → SKIPPED (native interactive)`, {
					target: targetTag,
				});
				return;
			}
			inputLog('Adapter', `click → InputManager`, {
				screen: {
					x: e.clientX - container.getBoundingClientRect().left,
					y: e.clientY - container.getBoundingClientRect().top,
				},
				target: targetTag,
			});
			manager.dispatch(make('click', e));
		};

		const onDblClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.closest(NATIVE_INTERACTIVE_SELECTOR)) return;
			inputLog('Adapter', `dblclick → InputManager`);
			manager.dispatch(make('dblclick', e));
		};

		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
			const target = e.target as HTMLElement | null;
			if (target?.closest(NATIVE_INTERACTIVE_SELECTOR)) return;
			inputLog('Adapter', `contextmenu → InputManager`);
			manager.dispatch(make('contextmenu', e));
		};

		container.addEventListener('click', onClick);
		container.addEventListener('dblclick', onDblClick);
		container.addEventListener('contextmenu', onContextMenu);

		return () => {
			container.removeEventListener('click', onClick);
			container.removeEventListener('dblclick', onDblClick);
			container.removeEventListener('contextmenu', onContextMenu);
		};
	}
}

function pointerIdOf(e: MouseEvent): number {
	const pe = e as Partial<PointerEvent>;
	return typeof pe.pointerId === 'number' ? pe.pointerId : 0;
}

function clickSource(e: MouseEvent): InputSource {
	const pe = e as Partial<PointerEvent>;
	switch (pe.pointerType) {
		case 'mouse':
			return 'mouse';
		case 'pen':
			return 'pen';
		case 'touch':
			return 'touch';
		default:
			return 'mouse';
	}
}
