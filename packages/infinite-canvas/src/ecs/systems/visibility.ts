import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Transform2D, Visible, Widget, WidgetBreakpoint, ZIndex } from '../components.js';
import type { VisibleEntity } from '../engine/types.js';
import { VisibleEntitiesResource } from '../resources.js';

/**
 * Build the per-frame visible-entity list consumed by `InfiniteCanvas`.
 *
 * Iterates `query(Widget, Visible)` (the latter tag is set by `cullSystem`
 * in the same `derive` phase that ran earlier this tick), pulls render-
 * relevant fields off `Transform2D` / `WidgetBreakpoint` / `ZIndex`, sorts
 * by `zIndex`, and writes the resulting array into `VisibleEntitiesResource.
 * current`. The previous tick's entityId set is also preserved on
 * `.prev` so `frameChangesSystem` can compute entered/exited.
 *
 * RFC-010 Phase 4 — replaces lines 830–857 of the inline tail of
 * `engine.tick()`. Profiler instrumentation flows automatically through
 * `SystemProfiler.beginSystem('visibility')`; the previously-dedicated
 * `Profiler.beginVisibility / endVisibility` calls are dropped (the
 * exported `visibilityMs` stat field becomes vestigial — `systemAvg.
 * visibility` carries the same signal).
 */
export const visibilitySystem = defineSystem({
	name: 'visibility',
	phase: 'present',
	execute: (world: World) => {
		const newVisible: VisibleEntity[] = [];
		const newVisibleSet = new Set<EntityId>();

		for (const entity of world.query(Widget, Visible)) {
			const t = world.getComponent(entity, Transform2D);
			const widget = world.getComponent(entity, Widget);
			const bp = world.getComponent(entity, WidgetBreakpoint);
			const zIdx = world.getComponent(entity, ZIndex);
			if (!t || !widget) continue;

			newVisibleSet.add(entity);
			newVisible.push({
				entityId: entity,
				x: t.x,
				y: t.y,
				width: t.width,
				height: t.height,
				breakpoint: bp?.current ?? 'normal',
				zIndex: zIdx?.value ?? 0,
				surface: widget.surface,
				widgetType: widget.type,
			});
		}

		newVisible.sort((a, b) => a.zIndex - b.zIndex);

		// `prev` is the *previous* tick's set — copy current `current`'s
		// ids before overwriting. `frameChangesSystem` reads `prev` to
		// compute entered/exited.
		const previous = world.getResource(VisibleEntitiesResource);
		const prev = new Set<EntityId>();
		for (const v of previous.current) prev.add(v.entityId);

		world.setResource(VisibleEntitiesResource, {
			current: newVisible,
			prev,
		});
	},
});
