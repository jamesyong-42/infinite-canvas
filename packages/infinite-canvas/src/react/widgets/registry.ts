import type { EntityId } from '@jamesyong42/reactive-ecs';
import type {
	WidgetBinding,
	WidgetInteractionHandlers,
	WidgetRegistry,
	WidgetSurface,
} from '../../ecs/engine/widget-binding.js';
import { createWidgetRegistry } from '../../ecs/engine/widget-binding.js';

export type { WidgetInteractionHandlers, WidgetRegistry, WidgetSurface };
export { createWidgetRegistry };

// === Widget Prop Contracts ===

/**
 * Props passed to every DOM widget component. The component is mounted
 * inside a sized `WidgetSlot` div — size via CSS or layout — and renders
 * normal React/HTML.
 *
 * Pointer events work natively (RFC-006): `onClick`, `onPointerOver`,
 * focus, native form inputs, contenteditable, drag-and-drop API — all
 * dispatched by the browser's event path and reach widget children
 * before they bubble to the canvas-level `PointerEventBus`.
 *
 * To opt out of engine routing (drag / select / resize) for an event,
 * call `e.stopPropagation()` from inside the widget. `<button>`,
 * `<input>`, `<textarea>`, `<select>`, and `[contenteditable]` opt out
 * automatically — the bus skips engine routing when the event target
 * matches one of those native interactive selectors.
 */
export interface DomWidgetProps {
	entityId: EntityId;
}

/**
 * Props passed to every R3F widget component. Rendered in widget-local
 * coords — the origin is the widget centre, X right, Y up — and the
 * component declares its own Three.js scene through R3F primitives.
 *
 * Pointer events on `<mesh>` / `<group>` work natively (RFC-006):
 * `onClick`, `onPointerOver`, `onPointerOut`, `onPointerEnter`,
 * `onPointerLeave`, `onPointerMove`, `onPointerDown`, `onPointerUp`,
 * `onPointerMissed`, `event.point` / `event.uv` / `event.intersections`,
 * R3F's `event.stopPropagation()` and `setPointerCapture` — all
 * dispatched by a custom EventManager that raycasts the widget's
 * own scene with widget-local coords.
 *
 * To opt out of engine routing (drag / select / resize) for an event,
 * additionally call `event.nativeEvent.stopPropagation()` to prevent
 * the canvas-container `PointerEventBus` from receiving it.
 */
export interface R3FWidgetProps {
	entityId: EntityId;
	/** Widget width in world units. */
	width: number;
	/** Widget height in world units. */
	height: number;
}

// === Widget Definitions ===

/** A DOM-rendered widget. The component is wrapped in a sized div — size via CSS. */
export interface DomWidget<T = Record<string, unknown>> extends WidgetBinding<T> {
	surface?: 'dom';
	component: React.ComponentType<DomWidgetProps>;
}

/**
 * An R3F (React Three Fiber) widget. The component receives local-space
 * width/height. Card-shaped chrome / lift / drag-promote / compositor
 * discard are all opted in via the `Card` ECS component on the spawned
 * entity (typically declared in the widget's archetype) — see
 * `createGeometryCardWidget` for the convenience wrapper.
 */
export interface R3FWidget<T = Record<string, unknown>> extends WidgetBinding<T> {
	surface: 'webgl';
	component: React.ComponentType<R3FWidgetProps>;
}

/** Either kind of widget. */
export type Widget<T = Record<string, unknown>> = DomWidget<T> | R3FWidget<T>;

/** Narrows to the R3F variant. */
export function isR3FWidget<T>(widget: Widget<T>): widget is R3FWidget<T> {
	return widget.surface === 'webgl';
}
