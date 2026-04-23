import { describe, expect, it } from 'vitest';
import { isOutOfBand, selectBand, ZOOM_BANDS } from '../r3f/compositor/ZoomBands.js';

describe('ZoomBands', () => {
	describe('selectBand', () => {
		it('clamps below the smallest band to the smallest band', () => {
			expect(selectBand(0.001)).toBe(ZOOM_BANDS[0]);
			expect(selectBand(0.01)).toBe(ZOOM_BANDS[0]);
		});

		it('clamps above the largest band to the largest band', () => {
			expect(selectBand(100)).toBe(ZOOM_BANDS[ZOOM_BANDS.length - 1]);
		});

		it('returns the smallest band ≥ zoom for in-range values', () => {
			expect(selectBand(1)).toBe(1);
			expect(selectBand(1.5)).toBe(2);
			expect(selectBand(0.4)).toBe(0.5);
			expect(selectBand(2.1)).toBe(4);
			expect(selectBand(8)).toBe(8);
		});

		it('returns the same band when called with the band value itself', () => {
			for (const b of ZOOM_BANDS) {
				expect(selectBand(b)).toBe(b);
			}
		});
	});

	describe('isOutOfBand', () => {
		it('returns false when paintedBand is unset (≤ 0)', () => {
			expect(isOutOfBand(1, 0)).toBe(false);
			expect(isOutOfBand(5, -1)).toBe(false);
		});

		it('returns false within the [band × 0.5, band × 2] tolerance window', () => {
			expect(isOutOfBand(1, 1)).toBe(false);
			expect(isOutOfBand(1.99, 1)).toBe(false);
			expect(isOutOfBand(0.51, 1)).toBe(false);
			expect(isOutOfBand(2, 1)).toBe(false); // 2/1 = 2, exactly at edge
			expect(isOutOfBand(0.5, 1)).toBe(false); // 0.5/1 = 0.5, exactly at edge
		});

		it('returns true outside the tolerance window', () => {
			expect(isOutOfBand(2.01, 1)).toBe(true); // ratio > 2
			expect(isOutOfBand(0.49, 1)).toBe(true); // ratio < 0.5
			expect(isOutOfBand(8, 1)).toBe(true);
			expect(isOutOfBand(0.1, 1)).toBe(true);
		});
	});
});
