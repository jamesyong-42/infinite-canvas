/**
 * Pipeline phases for the infinite-canvas `LayoutEngine`.
 *
 * `reactive-ecs` ships zero phase vocabulary — phase names and order are the
 * consumer's responsibility. These names are infinite-canvas's choice; a UI
 * tool, a game engine, and an agent simulator would each pick differently.
 *
 * Phase intent:
 * - `input`     — drain external intent (gestures, raw flag captures) into the world
 * - `react`     — maintain invariants in response to mutations from prior writes
 * - `control`   — state machines, intent resolution, navigation
 * - `simulate`  — time-driven mutations (tweens, animation)
 * - `derive`    — compute frame-local derived state (visibility, sort, layout)
 * - `present`   — build outputs for renderers (frame-changes, visible lists)
 * - `cleanup`   — end-of-frame bookkeeping (clearDirty, incrementTick, emitFrame)
 *
 * See RFC-010 for the full architectural rationale.
 */
export const ENGINE_PHASES = [
	'input',
	'react',
	'control',
	'simulate',
	'derive',
	'present',
	'cleanup',
] as const;

export type EnginePhase = (typeof ENGINE_PHASES)[number];
