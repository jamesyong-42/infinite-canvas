import { describe, expect, it } from 'vitest';
import { defineSystem } from '../define.js';
import { SystemScheduler } from '../scheduler.js';
import { createWorld } from '../world.js';

describe('SystemScheduler', () => {
	it('executes systems in registration order when no constraints', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(defineSystem({ name: 'a', execute: () => order.push('a') }));
		scheduler.register(defineSystem({ name: 'b', execute: () => order.push('b') }));
		scheduler.register(defineSystem({ name: 'c', execute: () => order.push('c') }));

		scheduler.execute(world);
		expect(order).toEqual(['a', 'b', 'c']);
	});

	it('respects after constraints', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(
			defineSystem({ name: 'render', after: 'physics', execute: () => order.push('render') }),
		);
		scheduler.register(defineSystem({ name: 'physics', execute: () => order.push('physics') }));
		scheduler.register(defineSystem({ name: 'input', execute: () => order.push('input') }));

		scheduler.execute(world);
		const physicsIdx = order.indexOf('physics');
		const renderIdx = order.indexOf('render');
		expect(physicsIdx).toBeLessThan(renderIdx);
	});

	it('respects before constraints', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(defineSystem({ name: 'a', execute: () => order.push('a') }));
		scheduler.register(defineSystem({ name: 'b', before: 'a', execute: () => order.push('b') }));

		scheduler.execute(world);
		expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
	});

	it('handles chain: a -> b -> c', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(defineSystem({ name: 'c', after: 'b', execute: () => order.push('c') }));
		scheduler.register(defineSystem({ name: 'a', execute: () => order.push('a') }));
		scheduler.register(defineSystem({ name: 'b', after: 'a', execute: () => order.push('b') }));

		scheduler.execute(world);
		expect(order).toEqual(['a', 'b', 'c']);
	});

	it('detects circular dependencies', () => {
		const scheduler = new SystemScheduler();

		scheduler.register(defineSystem({ name: 'a', after: 'b', execute: () => {} }));
		scheduler.register(defineSystem({ name: 'b', after: 'a', execute: () => {} }));

		expect(() => scheduler.getSystemNames()).toThrow(/circular/i);
	});

	it('removes systems', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(defineSystem({ name: 'a', execute: () => order.push('a') }));
		scheduler.register(defineSystem({ name: 'b', execute: () => order.push('b') }));

		scheduler.remove('a');
		scheduler.execute(world);
		expect(order).toEqual(['b']);
	});

	it('replaces system with same name', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(defineSystem({ name: 'a', execute: () => order.push('a1') }));
		scheduler.register(defineSystem({ name: 'a', execute: () => order.push('a2') }));

		scheduler.execute(world);
		expect(order).toEqual(['a2']);
	});

	it('ignores after/before referencing non-existent systems', () => {
		const order: string[] = [];
		const scheduler = new SystemScheduler();
		const world = createWorld();

		scheduler.register(
			defineSystem({ name: 'a', after: 'nonexistent', execute: () => order.push('a') }),
		);

		scheduler.execute(world);
		expect(order).toEqual(['a']);
	});
});
