import { BoxGeometry, MeshBasicMaterial, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ResourceRegistry } from '../r3f/compositor/ResourceRegistry.js';

describe('ResourceRegistry', () => {
	it('returns the same geometry for repeated acquires of the same key', () => {
		const reg = new ResourceRegistry();
		const factory = vi.fn(() => new BoxGeometry(1, 1, 1));
		const a = reg.acquireGeometry('box-1', factory);
		const b = reg.acquireGeometry('box-1', factory);
		expect(b).toBe(a);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(reg.geometryCount()).toBe(1);
	});

	it('disposes geometry only when refCount hits zero (deferred via microtask)', async () => {
		const reg = new ResourceRegistry();
		const geom = new BoxGeometry(1, 1, 1);
		const dispose = vi.spyOn(geom, 'dispose');

		reg.acquireGeometry('k', () => geom);
		reg.acquireGeometry('k', () => geom); // refCount = 2

		reg.releaseGeometry('k'); // refCount = 1
		await Promise.resolve(); // flush microtasks
		expect(dispose).not.toHaveBeenCalled();
		expect(reg.geometryCount()).toBe(1);

		reg.releaseGeometry('k'); // refCount = 0 → deferred dispose
		await Promise.resolve();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(reg.geometryCount()).toBe(0);
	});

	it('a re-acquire before the disposal microtask fires preserves the resource', async () => {
		const reg = new ResourceRegistry();
		const geom = new BoxGeometry(1, 1, 1);
		const dispose = vi.spyOn(geom, 'dispose');

		// Pattern that React StrictMode's effect double-mount triggers:
		// acquire → release → acquire (synchronously, before microtask).
		const a = reg.acquireGeometry('k', () => geom);
		reg.releaseGeometry('k'); // refCount = 0, queues microtask
		const b = reg.acquireGeometry('k', () => geom); // refCount = 1 → cancels disposal
		await Promise.resolve();
		expect(dispose).not.toHaveBeenCalled();
		expect(b).toBe(a);
		expect(reg.geometryCount()).toBe(1);
	});

	it('release on a missing key is a no-op', () => {
		const reg = new ResourceRegistry();
		expect(() => reg.releaseGeometry('nope')).not.toThrow();
	});

	it('material acquire / release follows the same contract', async () => {
		const reg = new ResourceRegistry();
		const a = reg.acquireMaterial('m', () => new MeshBasicMaterial());
		const b = reg.acquireMaterial('m', () => new MeshBasicMaterial());
		expect(b).toBe(a);
		expect(reg.materialCount()).toBe(1);
		reg.releaseMaterial('m');
		reg.releaseMaterial('m');
		await Promise.resolve();
		expect(reg.materialCount()).toBe(0);
	});

	it('texture acquire / release follows the same contract', async () => {
		const reg = new ResourceRegistry();
		const a = reg.acquireTexture('t', () => new Texture());
		const b = reg.acquireTexture('t', () => new Texture());
		expect(b).toBe(a);
		expect(reg.textureCount()).toBe(1);
		reg.releaseTexture('t');
		reg.releaseTexture('t');
		await Promise.resolve();
		expect(reg.textureCount()).toBe(0);
	});

	it('estimates geometry bytes from attribute buffers', () => {
		const reg = new ResourceRegistry();
		// BoxGeometry(1,1,1) creates position (24 verts × 3 floats × 4 bytes),
		// normal (same), uv (24 × 2 × 4), and an index (36 × 2 bytes).
		// We don't depend on the exact number — just that it's > 0 and that
		// adding more entries increases it.
		reg.acquireGeometry('a', () => new BoxGeometry(1, 1, 1));
		const oneEntry = reg.geometryBytes();
		expect(oneEntry).toBeGreaterThan(0);

		reg.acquireGeometry('b', () => new BoxGeometry(1, 1, 1));
		expect(reg.geometryBytes()).toBe(oneEntry * 2);
	});

	it('dispose clears every map and disposes every resource', () => {
		const reg = new ResourceRegistry();
		const g = new BoxGeometry(1, 1, 1);
		const m = new MeshBasicMaterial();
		const t = new Texture();
		const gd = vi.spyOn(g, 'dispose');
		const md = vi.spyOn(m, 'dispose');
		const td = vi.spyOn(t, 'dispose');

		reg.acquireGeometry('g', () => g);
		reg.acquireMaterial('m', () => m);
		reg.acquireTexture('t', () => t);
		reg.dispose();

		expect(gd).toHaveBeenCalled();
		expect(md).toHaveBeenCalled();
		expect(td).toHaveBeenCalled();
		expect(reg.geometryCount()).toBe(0);
		expect(reg.materialCount()).toBe(0);
		expect(reg.textureCount()).toBe(0);
	});
});
