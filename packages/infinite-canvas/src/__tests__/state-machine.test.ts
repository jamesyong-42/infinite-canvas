import { describe, expect, it } from 'vitest';
import { computePhase } from '../r3f/compositor/WidgetStateMachine.js';

describe('R3F WidgetStateMachine.computePhase', () => {
	// (active, visible, culled, animationSignal)

	it('returns Dormant when the widget is not Active regardless of other tags', () => {
		expect(computePhase(false, false, false, false)).toBe('Dormant');
		expect(computePhase(false, true, false, false)).toBe('Dormant');
		expect(computePhase(false, false, true, false)).toBe('Dormant');
		expect(computePhase(false, true, true, true)).toBe('Dormant');
	});

	it('returns Hot when Active + Visible + animation signal', () => {
		expect(computePhase(true, true, false, true)).toBe('Hot');
	});

	it('returns Warm when Active + Visible + idle', () => {
		expect(computePhase(true, true, false, false)).toBe('Warm');
	});

	it('returns Cold when Active + Culled', () => {
		expect(computePhase(true, false, true, false)).toBe('Cold');
		// Even with an animation signal, off-screen widgets are Cold (no point
		// painting what isn't visible).
		expect(computePhase(true, false, true, true)).toBe('Cold');
	});

	it('returns Cold for Active entities that have no viewport tag yet', () => {
		// Before the first cull tick, an Active entity may have neither Visible
		// nor Culled set. Treat as Cold so we do not spuriously paint.
		expect(computePhase(true, false, false, false)).toBe('Cold');
	});
});
