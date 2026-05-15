import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { TransformTween } from '../components.js';
import { EngineDirtyResource } from '../resources.js';

/**
 * `cleanup`-phase systems that close out a tick. They run in this order
 * (enforced via within-phase `after:` constraints):
 *
 *   clearDirty → incrementTick → emitFrame → tweenKeepalive
 *
 * 1. `clearDirty`     — clear the World's per-frame `queryChanged` /
 *                       `queryAdded` buffers AND reset the engine-level
 *                       `EngineDirtyResource.dirty` flag.
 * 2. `incrementTick`  — bump `world.currentTick`. Must come after
 *                       `clearDirty` so subscribers triggered by
 *                       `emitFrame` see the new tick number.
 * 3. `emitFrame`      — notify `onFrame` subscribers (`EngineInvalidator`,
 *                       widget state machine, React hooks).
 * 4. `tweenKeepalive` — RFC-004 § Phase 2/4. If any `TransformTween` is
 *                       still alive, re-set `EngineDirtyResource.dirty`
 *                       so the next rAF wakes the engine and the
 *                       animation keeps running. Must run *after*
 *                       `clearDirty`'s reset; otherwise its write would
 *                       be clobbered.
 *
 * RFC-010 Phase 4 — replaces lines 887–903 of the inline tail of
 * `engine.tick()`.
 */

export const clearDirtySystem = defineSystem({
	name: 'clearDirty',
	phase: 'cleanup',
	execute: (world: World) => {
		world.clearDirty();
		world.setResource(EngineDirtyResource, { dirty: false });
	},
});

export const incrementTickSystem = defineSystem({
	name: 'incrementTick',
	phase: 'cleanup',
	after: 'clearDirty',
	execute: (world: World) => {
		world.incrementTick();
	},
});

export const emitFrameSystem = defineSystem({
	name: 'emitFrame',
	phase: 'cleanup',
	after: 'incrementTick',
	execute: (world: World) => {
		world.emitFrame();
	},
});

export const tweenKeepaliveSystem = defineSystem({
	name: 'tweenKeepalive',
	phase: 'cleanup',
	after: 'emitFrame',
	execute: (world: World) => {
		// Cheap: bails after one iteration. The Transform2D reactive
		// observer skips markDirty (it only refreshes the spatial index),
		// so a tween's own Transform2D writes don't re-dirty the engine.
		// Without this re-dirty, the engine would tick once into the
		// animation and then freeze the card mid-fly-back.
		for (const _ of world.query(TransformTween)) {
			world.setResource(EngineDirtyResource, { dirty: true });
			return;
		}
	},
});
