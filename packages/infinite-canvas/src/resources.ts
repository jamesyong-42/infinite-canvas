import type { CSSCursor } from './components.js';
import { defineResource } from './ecs/index.js';
import type { EntityId } from './ecs/index.js';

export interface NavigationFrame {
	containerId: EntityId | null;
	camera: { x: number; y: number; zoom: number };
}

export type CursorResourceData = {
	cursor: CSSCursor;
};

/**
 * Output sink for the cursor system. Written by cursorSystem each tick;
 * read by the RAF loop to apply style.cursor on the root container div.
 */
export const CursorResource = defineResource<CursorResourceData>('Cursor', {
	cursor: 'default',
});

export const CameraResource = defineResource('Camera', {
	x: 0,
	y: 0,
	zoom: 1,
});

export const ViewportResource = defineResource('Viewport', {
	width: 0,
	height: 0,
	dpr: 1,
});

export const ZoomConfigResource = defineResource('ZoomConfig', {
	min: 0.1,
	max: 5.0,
});

export const BreakpointConfigResource = defineResource('BreakpointConfig', {
	micro: 40,
	compact: 120,
	normal: 500,
	expanded: 1200,
});

export const NavigationStackResource = defineResource('NavigationStack', {
	frames: [{ containerId: null, camera: { x: 0, y: 0, zoom: 1 } }] as NavigationFrame[],
	changed: false,
});

export type Breakpoint = 'micro' | 'compact' | 'normal' | 'expanded' | 'detailed';
