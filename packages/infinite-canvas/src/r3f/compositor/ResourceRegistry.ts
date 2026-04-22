import type { BufferGeometry, Material, Texture } from 'three';

/**
 * Disposable resource tracked by the registry.
 *
 * Three.js geometries / materials / textures all expose `.dispose()` and can
 * be safely shared across scenes — sharing avoids the per-widget GPU
 * duplication that the compositor's per-widget scenes would otherwise force.
 */
type Disposable = { dispose: () => void };

type Entry<T extends Disposable> = { resource: T; refCount: number };

/**
 * Archetype-keyed cache of GPU resources shared across per-widget scenes
 * (RFC-002 § Three.js resource sharing).
 *
 * Geometries, materials, and textures returned by `acquire*` are reference
 * counted. The registry disposes the underlying resource only after every
 * holder has called the matching `release*` — so 100 widgets of the same
 * card archetype share one geometry instance and one set of material
 * uniforms, rather than allocating 100 copies.
 */
export class ResourceRegistry {
	private geometries = new Map<string, Entry<BufferGeometry>>();
	private materials = new Map<string, Entry<Material>>();
	private textures = new Map<string, Entry<Texture>>();
	private disposed = false;

	acquireGeometry<T extends BufferGeometry>(key: string, factory: () => T): T {
		const existing = this.geometries.get(key);
		if (existing) {
			existing.refCount++;
			return existing.resource as T;
		}
		const resource = factory();
		this.geometries.set(key, { resource, refCount: 1 });
		return resource;
	}
	releaseGeometry(key: string): void {
		this.release(this.geometries, key);
	}

	acquireMaterial<T extends Material>(key: string, factory: () => T): T {
		const existing = this.materials.get(key);
		if (existing) {
			existing.refCount++;
			return existing.resource as T;
		}
		const resource = factory();
		this.materials.set(key, { resource, refCount: 1 });
		return resource;
	}
	releaseMaterial(key: string): void {
		this.release(this.materials, key);
	}

	acquireTexture<T extends Texture>(key: string, factory: () => T): T {
		const existing = this.textures.get(key);
		if (existing) {
			existing.refCount++;
			return existing.resource as T;
		}
		const resource = factory();
		this.textures.set(key, { resource, refCount: 1 });
		return resource;
	}
	releaseTexture(key: string): void {
		this.release(this.textures, key);
	}

	/** Number of distinct shared geometries currently held. */
	geometryCount(): number {
		return this.geometries.size;
	}

	/** Number of distinct shared materials currently held. */
	materialCount(): number {
		return this.materials.size;
	}

	/** Number of distinct shared textures currently held. */
	textureCount(): number {
		return this.textures.size;
	}

	/**
	 * Estimated GPU bytes for shared geometry attribute buffers. Best-effort —
	 * actual GPU footprint depends on driver alignment, but this is a useful
	 * relative metric for the profiler.
	 */
	geometryBytes(): number {
		let total = 0;
		for (const { resource } of this.geometries.values()) {
			for (const attr of Object.values(resource.attributes)) {
				if ('array' in attr && (attr.array as ArrayBufferView).byteLength) {
					total += (attr.array as ArrayBufferView).byteLength;
				}
			}
			if (resource.index) {
				total += (resource.index.array as ArrayBufferView).byteLength;
			}
		}
		return total;
	}

	/** Dispose every resource and clear the registry. */
	dispose(): void {
		if (this.disposed) return;
		for (const { resource } of this.geometries.values()) resource.dispose();
		for (const { resource } of this.materials.values()) resource.dispose();
		for (const { resource } of this.textures.values()) resource.dispose();
		this.geometries.clear();
		this.materials.clear();
		this.textures.clear();
		this.disposed = true;
	}

	/** True after `dispose()` — callers should re-create the registry instead of using it. */
	isDisposed(): boolean {
		return this.disposed;
	}

	private release<T extends Disposable>(map: Map<string, Entry<T>>, key: string): void {
		const entry = map.get(key);
		if (!entry) return;
		entry.refCount--;
		if (entry.refCount <= 0) {
			// Defer disposal by one microtask. Under React StrictMode the
			// effect cleanup fires immediately followed by a remount + new
			// acquire — without the defer, the resource is disposed before
			// the remount can re-acquire it. The microtask gives the
			// reacquire a chance to bump refCount back above 0; if it
			// doesn't, we dispose for real.
			queueMicrotask(() => {
				const current = map.get(key);
				if (current && current.refCount <= 0) {
					current.resource.dispose();
					map.delete(key);
				}
			});
		}
	}
}
