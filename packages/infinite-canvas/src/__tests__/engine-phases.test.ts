import { defineSystem } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { ENGINE_PHASES } from '../ecs/engine/phases.js';
import { createLayoutEngine } from '../index.js';

describe('ENGINE_PHASES', () => {
	it('declares the documented phase vocabulary in execution order', () => {
		expect(ENGINE_PHASES).toEqual([
			'input',
			'react',
			'control',
			'simulate',
			'derive',
			'present',
			'cleanup',
		]);
	});
});

describe('LayoutEngine phase wiring', () => {
	it('constructs without throwing — proves all registered systems use valid phases', () => {
		expect(() => createLayoutEngine()).not.toThrow();
	});

	it('runs caller-registered probe systems in phase order on tick()', () => {
		const engine = createLayoutEngine();
		const log: string[] = [];

		// Register one probe per declared phase. Each probe pushes its phase
		// name onto `log` when it runs. After tick(), `log` should reflect
		// `ENGINE_PHASES` ordering. (Probes for empty phases like `input`,
		// `present`, and `cleanup` confirm the phase is reachable even when no
		// engine-owned system lives there yet — RFC-010 Phases 4-5 will
		// populate them.)
		for (const phase of ENGINE_PHASES) {
			engine.registerSystem(
				defineSystem({
					name: `probe-${phase}`,
					phase,
					execute: () => log.push(phase),
				}),
			);
		}

		engine.tick();
		expect(log).toEqual([...ENGINE_PHASES]);
	});

	it('rejects a system that uses an unknown phase', () => {
		const engine = createLayoutEngine();
		expect(() =>
			engine.registerSystem(
				defineSystem({ name: 'rogue', phase: 'unknown-phase', execute: () => {} }),
			),
		).toThrow(/not in configured phases/);
	});
});
