import type { EntityId } from '@jamesyong42/reactive-ecs';
import { defineResource } from '@jamesyong42/reactive-ecs';
import type { CardPreset, CSSCursor } from './components.js';
import type { SpatialIndex } from './spatial/SpatialIndex.js';

/**
 * A single frame in the navigation stack. `containerId === null` is the
 * root canvas; any other value is the entity id of the container whose
 * sub-canvas the user is currently inside. Camera state lives on a
 * `ContainerCamera` component per container (or `RootCameraResource`
 * for the root frame), not in the stack itself — see RFC-004 § Phase 0c.
 */
export interface NavigationFrame {
	containerId: EntityId | null;
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

/**
 * Camera state: world-space position (x, y) and zoom level.
 *
 * `gesturing` is true while the user is actively manipulating the camera
 * (continuous wheel zoom, pinch, two-finger pan). Set/cleared by gesture
 * handlers via {@link LayoutEngine.setGesturing}; render layers can use it
 * to defer expensive work (e.g. the R3F compositor skips zoom-band
 * repaints while gesturing so a continuous pinch doesn't trigger a
 * repaint storm across every visible widget).
 */
export const CameraResource = defineResource('Camera', {
	x: 0,
	y: 0,
	zoom: 1,
	gesturing: false,
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

/**
 * Navigation stack for hierarchical container traversal. Always has at
 * least one frame (the root). The last element is the current frame;
 * `containerId === null` means the user is at the root canvas.
 *
 * Runtime-only view state — deliberately not serialized, so reloading a
 * saved canvas always drops the user at the root frame (RFC-004 § Phase 0c).
 */
export const NavigationStackResource = defineResource('NavigationStack', {
	frames: [{ containerId: null }] as NavigationFrame[],
	changed: false,
});

/** Shape shared by `ContainerCamera` components and `RootCameraResource`. */
export type FrameCameraState = { x: number; y: number; zoom: number };

/**
 * Camera state for the root canvas. Persisted (serialized) so the root
 * view returns to its previous pan/zoom across navigation push/pop and
 * across save/load. Container frames use the `ContainerCamera` component
 * on the container entity instead (RFC-004 § Phase 0c).
 */
export const RootCameraResource = defineResource<FrameCameraState>('RootCamera', {
	x: 0,
	y: 0,
	zoom: 1,
});

/** Responsive breakpoint name derived from a widget's screen-space size. */
export type Breakpoint = 'micro' | 'compact' | 'normal' | 'expanded' | 'detailed';

/**
 * Built-in card preset sizes (iOS widget conventions — 155×155 tile).
 * Single source of truth consumed by:
 *   - {@link CardPresetsResource} — runtime lookup by the cardSystem.
 *   - `createCardWidget` / `createGeometryCardWidget` — widget-registration-
 *     time `defaultSize`, which must be known before the engine is built.
 */
export const DEFAULT_CARD_PRESET_SIZES: Record<CardPreset, { width: number; height: number }> = {
	small: { width: 155, height: 155 },
	medium: { width: 329, height: 155 },
	large: { width: 329, height: 345 },
	xl: { width: 329, height: 535 },
};

/**
 * iOS-style card preset size map. Lookup happens by `Card.preset`; the
 * `cardSystem` stamps `Transform2D.width/height` from the resolved size.
 *
 * Override at `createLayoutEngine({ cardPresets })` for tablet-scale or
 * custom design systems.
 */
export const CardPresetsResource = defineResource('CardPresets', {
	presets: { ...DEFAULT_CARD_PRESET_SIZES },
	/** Gap between adjacent tiles (future tile-snap system reads this). */
	gap: 19,
});

/** ECS resource holding the SpatialIndex instance for viewport culling and hit testing. */
export const SpatialIndexResource = defineResource('SpatialIndex', {
	instance: null as SpatialIndex | null,
});

/**
 * Render-layer order, low → high. `<InfiniteCanvas>` mounts a DOM
 * container for each entry; widgets render into the container that
 * matches their `Layer.name`. Per-widget `ZIndex` controls intra-layer
 * ordering. RFC-003.
 *
 * Default: `['background', 'base', 'overlay']`. Out-of-the-box the
 * three names map to fixed DOM positions in `<InfiniteCanvas>`'s
 * stacking sandwich: background and base sit beneath the R3F canvas
 * (zIndex < 1), overlay sits above it (zIndex 2). Custom layer names
 * are not yet rendered by the default `<InfiniteCanvas>`.
 */
export type LayerOrderData = {
	layers: import('./components.js').LayerName[];
};

export const LayerOrderResource = defineResource<LayerOrderData>('LayerOrder', {
	layers: ['background', 'base', 'overlay'],
});
