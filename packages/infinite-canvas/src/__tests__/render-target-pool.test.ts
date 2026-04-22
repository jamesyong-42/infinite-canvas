import type { EntityId } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { WidgetRenderTargetPool } from '../r3f/compositor/WidgetRenderTargetPool.js';

const E = (n: number) => n as EntityId;

describe('WidgetRenderTargetPool', () => {
	it('starts empty', () => {
		const pool = new WidgetRenderTargetPool();
		expect(pool.size()).toBe(0);
		expect(pool.bytesUsed()).toBe(0);
		expect(pool.get(E(1))).toBeNull();
	});

	it('acquire creates an FBO and tracks bytes', () => {
		const pool = new WidgetRenderTargetPool();
		const rt = pool.acquire(E(1), 200, 100, 1);
		// 200 × 100 × 8 bytes/pixel = 160_000.
		expect(pool.bytesUsed()).toBe(160_000);
		expect(pool.size()).toBe(1);
		expect(pool.get(E(1))).toBe(rt);
	});

	it('reuses an existing FBO when dimensions match', () => {
		const pool = new WidgetRenderTargetPool();
		const a = pool.acquire(E(1), 200, 100, 1);
		const b = pool.acquire(E(1), 200, 100, 1);
		expect(b).toBe(a);
		expect(pool.size()).toBe(1);
		expect(pool.bytesUsed()).toBe(160_000);
	});

	it('replaces the FBO when dimensions change', () => {
		const pool = new WidgetRenderTargetPool();
		const a = pool.acquire(E(1), 200, 100, 1);
		const b = pool.acquire(E(1), 400, 100, 1);
		expect(b).not.toBe(a);
		expect(pool.size()).toBe(1);
		// 400 × 100 × 8 = 320_000.
		expect(pool.bytesUsed()).toBe(320_000);
	});

	it('multiplies size by dpr', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 100, 100, 2); // → 200×200 = 40_000 px × 8 = 320_000.
		expect(pool.bytesUsed()).toBe(320_000);
	});

	it('release removes the entry and frees bytes', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 200, 100, 1);
		pool.acquire(E(2), 100, 100, 1);
		expect(pool.bytesUsed()).toBe(160_000 + 80_000);

		expect(pool.release(E(1))).toBe(true);
		expect(pool.bytesUsed()).toBe(80_000);
		expect(pool.size()).toBe(1);
		expect(pool.get(E(1))).toBeNull();

		// Releasing again is a no-op.
		expect(pool.release(E(1))).toBe(false);
	});

	it('forEach iterates live entries', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 200, 100, 1);
		pool.acquire(E(2), 100, 100, 1);
		const seen: EntityId[] = [];
		pool.forEach((id) => {
			seen.push(id);
		});
		expect(seen.toSorted()).toEqual([1, 2]);
	});

	it('dispose clears every entry', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 200, 100, 1);
		pool.acquire(E(2), 100, 100, 1);
		pool.dispose();
		expect(pool.size()).toBe(0);
		expect(pool.bytesUsed()).toBe(0);
	});

	it('clamps zero dimensions to 1px so the texture is still allocatable', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 0, 0, 1); // → clamped to 1×1.
		expect(pool.bytesUsed()).toBe(8);
	});

	it('throws on acquire after dispose', () => {
		const pool = new WidgetRenderTargetPool();
		pool.dispose();
		expect(() => pool.acquire(E(1), 100, 100, 1)).toThrow(/cannot acquire after dispose/);
	});

	it('release after dispose is a no-op and never takes bytes negative', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 100, 100, 1);
		pool.acquire(E(2), 100, 100, 1);
		pool.dispose();
		expect(pool.bytesUsed()).toBe(0);
		// VirtualWidget cleanup might fire after Compositor unmount — the
		// pool must not make bytes go negative or double-dispose.
		expect(pool.release(E(1))).toBe(false);
		expect(pool.release(E(2))).toBe(false);
		expect(pool.bytesUsed()).toBe(0);
	});

	it('dispose is idempotent', () => {
		const pool = new WidgetRenderTargetPool();
		pool.acquire(E(1), 100, 100, 1);
		pool.dispose();
		expect(() => pool.dispose()).not.toThrow();
	});
});
