/**
 * Hysteresis-banded zoom-resolution policy (RFC-002 § Zoom handling).
 *
 * A widget's FBO is allocated at `widget bounds × dpr × band(zoom)` pixels.
 * As long as the camera zoom stays within `[band × 0.5, band × 2]` of the
 * band the widget was painted at, no repaint is needed — the composition
 * shader does a small up/down sample. Crossing that gap triggers a repaint
 * at the new band, snapping back to a 1:1 (or near-1:1) sample ratio.
 *
 * Bands are powers of 2 so each band covers a 4× display range. With the
 * default ladder (0.0625 ↔ 16) we span camera zooms 0.03125 ↔ 32 — covering
 * essentially every realistic infinite-canvas zoom level.
 */
export const ZOOM_BANDS = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16] as const;

/**
 * Pick the band whose `[band × 0.5, band × 2]` range contains the current
 * zoom. The smallest band ≥ zoom (after rounding to a band edge) is the
 * canonical choice — keeps the texture resolution at or above what the
 * display needs.
 */
export function selectBand(zoom: number): number {
	if (zoom <= ZOOM_BANDS[0]) return ZOOM_BANDS[0];
	if (zoom >= ZOOM_BANDS[ZOOM_BANDS.length - 1]) return ZOOM_BANDS[ZOOM_BANDS.length - 1];
	for (const b of ZOOM_BANDS) {
		if (zoom <= b) return b;
	}
	return ZOOM_BANDS[ZOOM_BANDS.length - 1];
}

/**
 * Returns true if the widget needs to be repainted because the camera
 * zoom has wandered outside the tolerance window of the band it was
 * painted at.
 *
 * `paintedBand` of 0 (or negative) means the widget has never been
 * painted yet — caller should treat that as "needs paint" through other
 * channels (Waking phase / paintGeneration > fboGeneration).
 */
export function isOutOfBand(currentZoom: number, paintedBand: number): boolean {
	if (paintedBand <= 0) return false;
	const ratio = currentZoom / paintedBand;
	return ratio > 2 || ratio < 0.5;
}
