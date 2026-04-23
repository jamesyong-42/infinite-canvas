import type { EntityId } from '@jamesyong42/reactive-ecs';
import type {
	WidgetBinding,
	WidgetRegistry,
	WidgetSurface,
} from '../../ecs/engine/widget-binding.js';
import { createWidgetRegistry } from '../../ecs/engine/widget-binding.js';

export type { WidgetRegistry, WidgetSurface };
export { createWidgetRegistry };

// === Widget Prop Contracts ===

/** Props passed to every DOM widget component. */
export interface DomWidgetProps {
	entityId: EntityId;
}

/** Props passed to every R3F widget component. Rendered in local coords. */
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
