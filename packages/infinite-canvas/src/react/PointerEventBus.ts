import type React from 'react';
import type { LayoutEngine, Modifiers } from '../ecs/engine/index.js';

/**
 * Native HTML elements that capture clicks before any canvas interaction
 * fires — buttons, form fields, content-editable surfaces. Pointer-down
 * targets matching this selector skip the engine entirely so DOM widgets
 * containing a `<button>` or `<input>` work the way the user expects.
 *
 * Widget authors who want additional opt-out elements call
 * `e.stopPropagation()` from their child handler — the bus only fires when
 * the bubble actually reaches the canvas container.
 */
const NATIVE_INTERACTIVE_SELECTOR = 'button, input, textarea, select, [contenteditable]';

function modsFrom(e: {
	shiftKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	metaKey: boolean;
}): Modifiers {
	return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/**
 * Single source of `engine.handlePointer*` invocations from the React tree
 * (RFC-006). The container's pointer handlers delegate to this object;
 * widget slots no longer call the engine directly. Phase 1 keeps the
 * existing slot-level engine calls in place — the bus just absorbs the
 * container's prior inline handlers verbatim, so behaviour is unchanged.
 *
 * Phase 2 removes the slot calls and the bus becomes the only call site.
 * Phase 3 adds the R3F EventRouter as a sibling concern, leaving the bus
 * unchanged.
 */
export class PointerEventBus {
	constructor(
		private readonly engine: LayoutEngine,
		private readonly getContainer: () => HTMLDivElement | null,
	) {}

	private toLocal(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
		const rect = this.getContainer()?.getBoundingClientRect();
		if (!rect) return null;
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	onPointerDown = (e: React.PointerEvent): void => {
		const target = e.target as HTMLElement | null;
		// Native interactives: let the browser handle the click. Engine
		// stays out so a button inside a DOM widget doesn't start a drag.
		if (target?.closest(NATIVE_INTERACTIVE_SELECTOR)) return;

		const local = this.toLocal(e);
		if (!local) return;

		const directive = this.engine.handlePointerDown(local.x, local.y, e.button, modsFrom(e));
		// Capture only when the directive commits to a non-click outcome.
		// `passthrough-track-drag` is deliberately excluded: tracking might
		// resolve to a click (release without crossing the dead zone), and
		// capturing on the container would redirect mouseup to the
		// container, breaking native click synthesis on the original
		// element (e.g. a `<li>` inside a DOM widget). Capture is set
		// later by `onPointerMove` if the engine upgrades to capture-drag.
		//
		// `capture-drag` from pointerdown happens only in the fly-back
		// interrupt path (RFC-004) — already a drag, capture immediately.
		// `capture-marquee` and `capture-resize` similarly commit to a
		// drag-style interaction at pointerdown.
		if (
			directive.action === 'capture-resize' ||
			directive.action === 'capture-marquee' ||
			directive.action === 'capture-drag'
		) {
			this.getContainer()?.setPointerCapture(e.pointerId);
		}
		if (directive.action === 'capture-resize') {
			e.preventDefault();
		}
	};

	onPointerMove = (e: React.PointerEvent): void => {
		const local = this.toLocal(e);
		if (!local) return;
		const directive = this.engine.handlePointerMove(local.x, local.y, modsFrom(e));
		// First move past the dead zone: tracking → dragging. Capture now
		// so the drag continues even if the cursor leaves the container.
		// Idempotent — setPointerCapture is a no-op when already captured.
		if (directive.action === 'capture-drag') {
			const container = this.getContainer();
			if (container && !container.hasPointerCapture(e.pointerId)) {
				container.setPointerCapture(e.pointerId);
			}
		}
	};

	onPointerUp = (e: React.PointerEvent): void => {
		const container = this.getContainer();
		if (container?.hasPointerCapture(e.pointerId)) {
			container.releasePointerCapture(e.pointerId);
		}
		this.engine.handlePointerUp();
	};

	onPointerLeave = (e: React.PointerEvent): void => {
		// Cursor exited the canvas — push a sentinel move so the engine
		// clears its hovered entity / cursor / selection-ring chrome.
		// Coords far outside the viewport guarantee no spatial-index hit.
		// (R3F's own EventRouter clears its hover state via `cancelPointer`
		// when the next intersect call returns no hits, so we don't need
		// to flush it explicitly here.)
		this.engine.handlePointerMove(-1e9, -1e9, modsFrom(e));
	};

	onDoubleClick = (e: React.MouseEvent): void => {
		const target = e.target as HTMLElement | null;
		if (target?.closest(NATIVE_INTERACTIVE_SELECTOR)) return;
		const local = this.toLocal(e);
		if (!local) return;
		const entity = this.engine.pickAt(local.x, local.y);
		if (entity !== null) this.engine.enterContainer(entity);
	};
}
