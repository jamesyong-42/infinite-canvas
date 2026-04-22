import { describe, expect, it } from 'vitest';
import { computePhase } from '../r3f/compositor/WidgetStateMachine.js';

describe('R3F WidgetStateMachine.computePhase', () => {
	// Args: (active, visible, culled, animationSignal, hasFbo)

	it('returns Dormant when the widget is not Active regardless of other tags', () => {
		expect(computePhase(false, false, false, false, false)).toBe('Dormant');
		expect(computePhase(false, true, false, false, true)).toBe('Dormant');
		expect(computePhase(false, false, true, false, false)).toBe('Dormant');
		expect(computePhase(false, true, true, true, true)).toBe('Dormant');
	});

	it('returns Hot when Active + Visible + animation signal, regardless of FBO state', () => {
		expect(computePhase(true, true, false, true, false)).toBe('Hot');
		expect(computePhase(true, true, false, true, true)).toBe('Hot');
	});

	it('returns Warm when Active + Visible + idle + valid FBO', () => {
		expect(computePhase(true, true, false, false, true)).toBe('Warm');
	});

	it('returns Waking when Active + Visible + idle + no valid FBO', () => {
		// Newly un-culled widget that needs its first paint, or an evicted
		// widget rejoining the visible set.
		expect(computePhase(true, true, false, false, false)).toBe('Waking');
	});

	it('returns Cold when Active + Culled', () => {
		expect(computePhase(true, false, true, false, true)).toBe('Cold');
		expect(computePhase(true, false, true, false, false)).toBe('Cold');
		// Off-screen widgets are Cold even with an animation signal — no
		// point painting what isn't visible.
		expect(computePhase(true, false, true, true, true)).toBe('Cold');
	});

	it('returns Cold for Active entities that have no viewport tag yet', () => {
		// Before the first cull tick, an Active entity may have neither
		// Visible nor Culled set. Treat as Cold to avoid spurious paints.
		expect(computePhase(true, false, false, false, false)).toBe('Cold');
	});
});
