import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Transform2D, Visible, Widget, WidgetBreakpoint } from '../components.js';
import type { Breakpoint } from '../resources.js';
import { BreakpointConfigResource, CameraResource } from '../resources.js';

/**
 * Compute breakpoints for visible widgets based on screen size.
 * Fix #10: Always update screenWidth/screenHeight even if breakpoint tier doesn't change.
 */
export const breakpointSystem = defineSystem({
	name: 'breakpoint',
	phase: 'derive',
	after: 'cull',
	execute: (world: World) => {
		const camera = world.getResource(CameraResource);
		const config = world.getResource(BreakpointConfigResource);

		for (const entity of world.query(Widget, Visible)) {
			const transform = world.getComponent(entity, Transform2D);
			if (!transform) continue;

			const screenWidth = transform.width * camera.zoom;
			const screenHeight = transform.height * camera.zoom;

			let bp: Breakpoint;
			if (screenWidth < config.micro) bp = 'micro';
			else if (screenWidth < config.compact) bp = 'compact';
			else if (screenWidth < config.normal) bp = 'normal';
			else if (screenWidth < config.expanded) bp = 'expanded';
			else bp = 'detailed';

			const existing = world.getComponent(entity, WidgetBreakpoint);
			if (!existing) {
				world.addComponent(entity, WidgetBreakpoint, {
					current: bp,
					screenWidth,
					screenHeight,
				});
			} else {
				// Fix #10: Update if breakpoint tier changed OR screen dimensions changed significantly.
				// Compare rounded values to avoid floating-point instability at fractional zoom levels.
				const bpChanged = existing.current !== bp;
				const sizeChanged =
					Math.round(existing.screenWidth) !== Math.round(screenWidth) ||
					Math.round(existing.screenHeight) !== Math.round(screenHeight);

				if (bpChanged || sizeChanged) {
					world.setComponent(entity, WidgetBreakpoint, {
						current: bp,
						screenWidth,
						screenHeight,
					});
				}
			}
		}
	},
});
