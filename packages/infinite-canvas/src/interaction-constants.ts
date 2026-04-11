/**
 * Shared interaction sizing and threshold constants.
 *
 * Single source of truth for hit-zone sizes, visual handle sizes, dead zones,
 * and minimum widget dimensions. Consumed by the engine, the selection
 * renderer, the touch gesture state machine, and the (currently dead-code)
 * SelectionFrame DOM component. See RFC-001, Phase 1.
 */

/**
 * Visual handle size rendered by SelectionRenderer (full width, screen px).
 * Constant across zoom — the SDF shader converts via pxToWorld.
 */
export const HANDLE_VISUAL_SIZE_PX = 8;

/**
 * Hit-zone size for handles (full width, screen px). Deliberately larger than
 * HANDLE_VISUAL_SIZE_PX to give a generous clickable area — preserves the
 * "invisible hit tolerance" feel the current engine provides via `8 / zoom`
 * (full clickable width = 16 px). Do not reduce this without a UX test.
 */
export const HANDLE_HIT_SIZE_PX = 16;

/** Drag dead zone for mouse input. */
export const DEAD_ZONE_MOUSE_PX = 4;

/** Drag dead zone for touch input. Wider than mouse because fingers are fuzzier. */
export const DEAD_ZONE_TOUCH_PX = 8;

/** Minimum widget dimension (world units), enforced live and on undo/redo. */
export const MIN_WIDGET_SIZE = 20;
