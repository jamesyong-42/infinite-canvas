/**
 * Centralised input timing windows, dead zones, and debounce intervals
 * (RFC-008). Single source of truth — recognizers and engine handlers
 * import from here. Replaces today's per-file constant duplication
 * (`PointerEventBus`, `TouchEventBus`, the wheel `useEffect`).
 */

/** Mouse / pen drag dead zone in screen pixels. Matches today's `interaction-constants.ts`. */
export const DEAD_ZONE_MOUSE_PX = 4;

/** Touch drag dead zone in screen pixels. Matches today's `interaction-constants.ts`. */
export const DEAD_ZONE_TOUCH_PX = 8;

/** Quick-up window after pointerdown to count as a tap (no significant movement). */
export const TAP_WINDOW_MS = 250;

/** Window between two taps to register as a double-tap. */
export const DOUBLE_TAP_WINDOW_MS = 300;

/** Spatial threshold between two taps (centroid) to register as a double-tap. */
export const DOUBLE_TAP_DIST_PX = 30;

/** Idle window after a viewport gesture before clearing `engine.setGesturing(false)`. */
export const GESTURING_IDLE_MS = 200;

/** Double-tap zoom level cycle. */
export const ZOOM_TARGETS = [1, 2] as const;

/** If camera zoom is below this, double-tap zoom targets ZOOM_TARGETS[0]. */
export const ZOOM_LOW_THRESHOLD = 0.9;

/** If camera zoom is below this (and above LOW), double-tap zoom targets ZOOM_TARGETS[1]. */
export const ZOOM_HIGH_THRESHOLD = 1.8;

/** Wheel deltaY → zoom delta multiplier. Matches today's wheel `useEffect`. */
export const WHEEL_ZOOM_FACTOR = 0.01;
