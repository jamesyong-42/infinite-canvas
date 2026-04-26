/**
 * Overlap glow — visual config for the drag-over highlight applied to
 * cards (DOM `CardChrome` + R3F `CompositionMaterial`).
 *
 * Single-layer design: a soft radial gradient at the hot point in a
 * neutral color, blended normally over the card content. Deliberately
 * simple — no backdrop-filter, no saturation/contrast tricks, no rim,
 * no bloom. Three tunables: color, alpha (per state), falloff radius.
 *
 * Flows two ways from `<InfiniteCanvas overlapGlow={...} />`:
 *   1. CSS custom properties on the canvas container — read by
 *      `CardChrome` via `var(--ic-glow-…, fallback)` for DOM widgets.
 *   2. Shared shader uniforms — every `CompositionMaterial` instance
 *      references the same uniform objects, so mutating
 *      {@link sharedGlowUniforms} updates all R3F cards at once.
 *
 * Each `[candidate, target]` pair holds the value used while the card
 * is just an overlap candidate vs. when the drop will actually consume.
 */

import { sharedGlowUniforms } from '../../r3f/compositor/CompositionMaterial.js';

export interface OverlapGlowConfig {
	/** Inner glow RGB color in 0-1 range. */
	glowColor: [number, number, number];
	/** Inner-glow alpha, [candidate, target]. */
	glowAlpha: [number, number];
	/**
	 * Inner-glow blur radius in CSS px — the blur arg of the inset
	 * box-shadow that paints the glow. Matches `--glow-size` in the
	 * reference (card-light.html). [candidate, target].
	 */
	glowSize: [number, number];
	/** Rim RGB color in 0-1 range (independent of glowColor). */
	rimColor: [number, number, number];
	/** Rim width in CSS px (DOM only — shader rim thickness is fixed). */
	rimWidth: number;
	/** Rim alpha at the bright (hot-point-side) end, [candidate, target]. */
	rimAlpha: [number, number];
	/**
	 * Rim radial-gradient circle radius in CSS px. Matches `600px circle`
	 * in the reference. Larger = more uniform rim (less pooling toward
	 * hot point); smaller = tighter pooling.
	 */
	rimRadius: number;
}

export const DEFAULT_OVERLAP_GLOW_CONFIG: OverlapGlowConfig = {
	glowColor: [0.5, 0.5, 0.5],
	glowAlpha: [0.25, 0.45],
	glowSize: [60, 80],
	rimColor: [0.5, 0.5, 0.5],
	rimWidth: 1.5,
	rimAlpha: [0.55, 0.85],
	rimRadius: 600,
};

function rgbTriplet(color: [number, number, number]): string {
	const [r, g, b] = color;
	return `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
}

/** Write the config as CSS custom properties on `target`. CardChrome reads them. */
export function applyOverlapGlowVars(target: HTMLElement, c: OverlapGlowConfig): void {
	const s = target.style;
	s.setProperty('--ic-glow-color', rgbTriplet(c.glowColor));
	s.setProperty('--ic-glow-alpha-c', String(c.glowAlpha[0]));
	s.setProperty('--ic-glow-alpha-t', String(c.glowAlpha[1]));
	s.setProperty('--ic-glow-size-c', `${c.glowSize[0]}px`);
	s.setProperty('--ic-glow-size-t', `${c.glowSize[1]}px`);
	s.setProperty('--ic-rim-color', rgbTriplet(c.rimColor));
	s.setProperty('--ic-rim-width', `${c.rimWidth}px`);
	s.setProperty('--ic-rim-alpha-c', String(c.rimAlpha[0]));
	s.setProperty('--ic-rim-alpha-t', String(c.rimAlpha[1]));
	s.setProperty('--ic-rim-radius', `${c.rimRadius}px`);
}

/** Push the same config into the shared shader uniforms (mutates in place). */
export function applyOverlapGlowShaderUniforms(c: OverlapGlowConfig): void {
	sharedGlowUniforms.uGlowColor.value.set(c.glowColor[0], c.glowColor[1], c.glowColor[2]);
	sharedGlowUniforms.uGlowAlpha.value.set(c.glowAlpha[0], c.glowAlpha[1]);
	// Shader operates in UV (0..1). Convert px → UV using a fixed
	// reference card width of 200px — close enough for visual parity
	// across the typical iOS-widget size range.
	sharedGlowUniforms.uGlowFalloff.value.set(c.glowSize[0] / 200, c.glowSize[1] / 200);
	sharedGlowUniforms.uRimColor.value.set(c.rimColor[0], c.rimColor[1], c.rimColor[2]);
	sharedGlowUniforms.uRimAlpha.value.set(c.rimAlpha[0], c.rimAlpha[1]);
	sharedGlowUniforms.uRimRadius.value = c.rimRadius / 200;
}

export function mergeOverlapGlow(override?: Partial<OverlapGlowConfig>): OverlapGlowConfig {
	return { ...DEFAULT_OVERLAP_GLOW_CONFIG, ...override };
}
