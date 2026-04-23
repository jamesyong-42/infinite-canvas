import type { EntityId } from '@jamesyong42/reactive-ecs';
import type { R3FPhase } from './state.js';

/**
 * One pool entry as eviction candidate. Built by the Compositor from
 * `pool.entryInfos()` joined with each widget's `R3FRenderState.phase`.
 */
export type EvictionCandidate = {
	entityId: EntityId;
	phase: R3FPhase;
	bytes: number;
	lastUsedMs: number;
};

/**
 * Eviction priority — lower numbers evict first. Hot and Waking are never
 * evicted because they are about to be (or are actively) painted.
 *
 *   Cold     0  off-screen, eviction-eligible immediately
 *   Warm     1  visible + idle, retained while budget allows
 *   Dormant  2  inactive but eviction-protected — only released as a
 *               last resort because losing the FBO costs the
 *               "instant re-activation" guarantee
 *   Waking   ∞  scheduled to repaint imminently — never evict
 *   Hot      ∞  actively painted every frame — never evict
 */
const PHASE_PRIORITY: Record<R3FPhase, number> = {
	Cold: 0,
	Warm: 1,
	Dormant: 2,
	Waking: Number.POSITIVE_INFINITY,
	Hot: Number.POSITIVE_INFINITY,
};

/**
 * Returns the ordered list of entity ids to release so total bytes ≤ budget.
 * Sort key: `(phasePriority, lastUsedMs)` — within a phase, oldest goes
 * first (LRU). Hot / Waking widgets are never returned even if the budget
 * is impossible to satisfy without them.
 *
 * Pure function — Compositor calls this in its useFrame and forwards each
 * id to `pool.release()`.
 */
export function selectEvictions(
	candidates: EvictionCandidate[],
	totalBytes: number,
	maxBytes: number,
): EntityId[] {
	if (totalBytes <= maxBytes) return [];

	const eligible = candidates.filter((c) => Number.isFinite(PHASE_PRIORITY[c.phase]));
	eligible.sort((a, b) => {
		const p = PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase];
		if (p !== 0) return p;
		return a.lastUsedMs - b.lastUsedMs;
	});

	const toEvict: EntityId[] = [];
	let remaining = totalBytes;
	for (const c of eligible) {
		if (remaining <= maxBytes) break;
		toEvict.push(c.entityId);
		remaining -= c.bytes;
	}
	return toEvict;
}
