import type { EntityId } from '@jamesyong42/reactive-ecs';
import { defineResource } from '@jamesyong42/reactive-ecs';
import type { CardPreset, CSSCursor } from './components.js';

/** A single frame in the navigation stack, capturing the container and camera state. */
export interface NavigationFrame {
	containerId: EntityId | null;
	camera: { x: number; y: number; zoom: number };
}

/** Data shape for the CursorResource. */
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

/** Camera state: world-space position (x, y) and zoom level. Updated by pan/zoom gestures. */
export const CameraResource = defineResource('Camera', {
	x: 0,
	y: 0,
	zoom: 1,
});

/** Viewport dimensions in CSS pixels and device pixel ratio. Updated on resize. */
export const ViewportResource = defineResource('Viewport', {
	width: 0,
	height: 0,
	dpr: 1,
});

/** Minimum and maximum zoom levels. */
export const ZoomConfigResource = defineResource('ZoomConfig', {
	min: 0.1,
	max: 5.0,
});

/** Screen-space pixel thresholds for responsive breakpoints (micro/compact/normal/expanded/detailed). */
export const BreakpointConfigResource = defineResource('BreakpointConfig', {
	micro: 40,
	compact: 120,
	normal: 500,
	expanded: 1200,
});

/** Navigation stack for hierarchical container traversal. */
export const NavigationStackResource = defineResource('NavigationStack', {
	frames: [{ containerId: null, camera: { x: 0, y: 0, zoom: 1 } }] as NavigationFrame[],
	changed: false,
});

/** Responsive breakpoint name derived from a widget's screen-space size. */
export type Breakpoint = 'micro' | 'compact' | 'normal' | 'expanded' | 'detailed';

/**
 * iOS-style card preset size map. Lookup happens by `Card.preset`; the
 * `cardSystem` stamps `Transform2D.width/height` from the resolved size.
 *
 * Defaults mirror iOS widget conventions — 155×155 tile + 19px gap.
 * Override at `createLayoutEngine({ cardPresets })` for tablet-scale or
 * custom design systems.
 */
export const CardPresetsResource = defineResource('CardPresets', {
	presets: {
		small: { width: 155, height: 155 },
		medium: { width: 329, height: 155 },
		large: { width: 329, height: 345 },
		xl: { width: 329, height: 535 },
	} as Record<CardPreset, { width: number; height: number }>,
	/** Gap between adjacent tiles (future tile-snap system reads this). */
	gap: 19,
});
