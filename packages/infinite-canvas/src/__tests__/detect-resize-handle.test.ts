import { describe, expect, it } from 'vitest';
import { detectResizeHandle } from '../ecs/engine/interaction.js';

/**
 * Unit tests for the RFC-005 Phase 1 inline resize-handle hotspot
 * detector. Pure-math helper — no ECS / world dependency, so it's
 * tested in isolation.
 *
 * Current `HANDLE_HIT_SIZE_PX` = 16 → half-size = 8 world units at
 * zoom 1.
 */
describe('detectResizeHandle', () => {
	// A 200×150 widget anchored at (100, 100) in world coords.
	const wb = { x: 100, y: 100, width: 200, height: 150 };

	describe('corner hotspots (zoom = 1)', () => {
		it('detects nw at the top-left corner', () => {
			expect(detectResizeHandle(100, 100, wb, 1)).toBe('nw');
		});
		it('detects ne at the top-right corner', () => {
			expect(detectResizeHandle(300, 100, wb, 1)).toBe('ne');
		});
		it('detects sw at the bottom-left corner', () => {
			expect(detectResizeHandle(100, 250, wb, 1)).toBe('sw');
		});
		it('detects se at the bottom-right corner', () => {
			expect(detectResizeHandle(300, 250, wb, 1)).toBe('se');
		});
		it('detects nw within the corner slop band (≤ half = 8 px)', () => {
			expect(detectResizeHandle(108, 108, wb, 1)).toBe('nw');
			expect(detectResizeHandle(92, 92, wb, 1)).toBe('nw');
		});
	});

	describe('edge hotspots (zoom = 1)', () => {
		it('detects n at the top-edge midpoint', () => {
			expect(detectResizeHandle(200, 100, wb, 1)).toBe('n');
		});
		it('detects s at the bottom-edge midpoint', () => {
			expect(detectResizeHandle(200, 250, wb, 1)).toBe('s');
		});
		it('detects w at the left-edge midpoint', () => {
			expect(detectResizeHandle(100, 175, wb, 1)).toBe('w');
		});
		it('detects e at the right-edge midpoint', () => {
			expect(detectResizeHandle(300, 175, wb, 1)).toBe('e');
		});
	});

	describe('corner-over-edge priority', () => {
		// Small 10×10 widget so corner and edge hotspots overlap — at zoom 1
		// with half = 8, corners and edges all share the same hit region.
		const small = { x: 0, y: 0, width: 10, height: 10 };

		it('returns corner when a corner and an edge both match (top-left)', () => {
			// (0, 0) is both 'nw' corner and inside 'n' / 'w' edge bands.
			// Corner loop runs first → 'nw'.
			expect(detectResizeHandle(0, 0, small, 1)).toBe('nw');
		});
		it('returns corner when a corner and an edge both match (bottom-right)', () => {
			// (10, 10) is the 'se' corner of a 10×10 widget at origin. Also
			// inside 's' and 'e' edge bands at zoom 1. Corner loop wins → 'se'.
			expect(detectResizeHandle(10, 10, small, 1)).toBe('se');
		});
	});

	describe('off-widget / miss cases', () => {
		it('returns null far from the widget', () => {
			expect(detectResizeHandle(500, 500, wb, 1)).toBeNull();
		});
		it('returns null inside the widget body but away from any edge', () => {
			expect(detectResizeHandle(200, 175, wb, 1)).toBeNull();
		});
		it('returns null just outside the corner slop band (> half)', () => {
			expect(detectResizeHandle(91, 91, wb, 1)).toBeNull();
		});
	});

	describe('zoom scaling', () => {
		it('shrinks the hotspot at higher zoom — miss at (115, 100) at zoom 2', () => {
			// At zoom 2: half = 8 / 2 = 4 world units. nw corner at (100,100)
			// has range x:[96,104] y:[96,104]. (115, 100) misses.
			expect(detectResizeHandle(115, 100, wb, 2)).toBeNull();
		});
		it('grows the hotspot at lower zoom — hit at (115, 100) at zoom 0.5', () => {
			// At zoom 0.5: half = 8 / 0.5 = 16 world units. nw corner at
			// (100,100) has range x:[84,116] y:[84,116]. (115, 100) is in
			// that box → nw.
			expect(detectResizeHandle(115, 100, wb, 0.5)).toBe('nw');
		});
	});
});
