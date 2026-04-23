import type { EntityId } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { type EvictionCandidate, selectEvictions } from '../r3f/compositor/eviction.js';

const E = (n: number) => n as EntityId;

function c(
	entityId: EntityId,
	phase: EvictionCandidate['phase'],
	bytes: number,
	lastUsedMs: number,
): EvictionCandidate {
	return { entityId, phase, bytes, lastUsedMs };
}

describe('selectEvictions', () => {
	it('returns [] when total ≤ budget', () => {
		const candidates = [c(E(1), 'Warm', 100, 0), c(E(2), 'Cold', 100, 0)];
		expect(selectEvictions(candidates, 200, 200)).toEqual([]);
		expect(selectEvictions(candidates, 199, 200)).toEqual([]);
		expect(selectEvictions([], 0, 100)).toEqual([]);
	});

	it('evicts Cold widgets before Warm widgets', () => {
		const candidates = [
			c(E(1), 'Warm', 100, 0),
			c(E(2), 'Cold', 100, 0),
			c(E(3), 'Cold', 100, 100),
		];
		// Total 300, budget 150 → must evict 2× 100 bytes.
		// Order: Cold E(2) (older), Cold E(3) (newer), then Warm E(1).
		expect(selectEvictions(candidates, 300, 150)).toEqual([E(2), E(3)]);
	});

	it('evicts Warm widgets only after all Cold are gone', () => {
		const candidates = [c(E(1), 'Warm', 100, 0), c(E(2), 'Cold', 100, 50)];
		// Total 200, budget 50 → evict E(2) (Cold) first, then E(1) (Warm).
		expect(selectEvictions(candidates, 200, 50)).toEqual([E(2), E(1)]);
	});

	it('evicts Dormant only after Cold and Warm', () => {
		const candidates = [
			c(E(1), 'Dormant', 100, 0),
			c(E(2), 'Warm', 100, 50),
			c(E(3), 'Cold', 100, 100),
		];
		// Total 300, budget 0 → evict in priority order: Cold, Warm, Dormant.
		expect(selectEvictions(candidates, 300, 0)).toEqual([E(3), E(2), E(1)]);
	});

	it('within a phase, oldest lastUsedMs evicts first', () => {
		const candidates = [
			c(E(1), 'Cold', 100, 1000),
			c(E(2), 'Cold', 100, 100), // oldest
			c(E(3), 'Cold', 100, 500),
		];
		expect(selectEvictions(candidates, 300, 150)).toEqual([E(2), E(3)]);
	});

	it('never evicts Hot or Waking', () => {
		const candidates = [c(E(1), 'Hot', 100, 0), c(E(2), 'Waking', 100, 0), c(E(3), 'Cold', 100, 0)];
		// Budget 0 — even an impossible target must not touch Hot / Waking.
		expect(selectEvictions(candidates, 300, 0)).toEqual([E(3)]);
	});

	it('stops as soon as the budget is satisfied', () => {
		const candidates = [
			c(E(1), 'Cold', 50, 0),
			c(E(2), 'Cold', 50, 50),
			c(E(3), 'Cold', 50, 100),
			c(E(4), 'Cold', 50, 150),
		];
		// Total 200, budget 80 → evict 2× 50 = 100 bytes (down to 100, still > 80,
		// so a third must go too). Wait through carefully:
		//   start: 200
		//   evict E(1): 150
		//   evict E(2): 100
		//   evict E(3): 50  ← now ≤ 80, stop
		expect(selectEvictions(candidates, 200, 80)).toEqual([E(1), E(2), E(3)]);
	});
});
