import type { EntityId } from '@jamesyong42/reactive-ecs';
import { WebGLRenderTarget } from 'three';

/**
 * Bytes per pixel for the default render target format (RGBA8 colour +
 * 24-bit depth + 8-bit stencil packed into 32 bits = 8 bytes/pixel).
 */
const BYTES_PER_PIXEL = 8;

type PoolEntry = {
	rt: WebGLRenderTarget;
	/** Pixel width = logicalWidth × dpr, rounded. */
	pixelWidth: number;
	pixelHeight: number;
	dpr: number;
	bytes: number;
};

/**
 * Allocates one persistent `WebGLRenderTarget` per R3F widget entity. Used
 * by the compositor (RFC-002 Phase 4) so each widget paints into its own
 * texture instead of into the main canvas backbuffer.
 *
 * Acquire returns an existing FBO if its pixel resolution matches the
 * request; otherwise the old FBO is disposed and a new one created (sized
 * to the new resolution). Eviction under memory pressure is Phase 6 — this
 * pool grows monotonically until widgets are released.
 */
export class WidgetRenderTargetPool {
	private entries = new Map<EntityId, PoolEntry>();
	private totalBytes = 0;
	private disposed = false;

	/**
	 * Get or create an FBO for `entityId` at the requested logical size and
	 * device pixel ratio. If an FBO already exists at the same pixel
	 * dimensions, returns it unchanged.
	 */
	acquire(entityId: EntityId, width: number, height: number, dpr: number): WebGLRenderTarget {
		if (this.disposed) {
			throw new Error('WidgetRenderTargetPool: cannot acquire after dispose');
		}
		const pixelWidth = Math.max(1, Math.round(width * dpr));
		const pixelHeight = Math.max(1, Math.round(height * dpr));

		const existing = this.entries.get(entityId);
		if (existing && existing.pixelWidth === pixelWidth && existing.pixelHeight === pixelHeight) {
			return existing.rt;
		}

		if (existing) {
			existing.rt.dispose();
			this.totalBytes -= existing.bytes;
		}

		const rt = new WebGLRenderTarget(pixelWidth, pixelHeight);
		const bytes = pixelWidth * pixelHeight * BYTES_PER_PIXEL;
		this.entries.set(entityId, { rt, pixelWidth, pixelHeight, dpr, bytes });
		this.totalBytes += bytes;
		return rt;
	}

	/** Look up an FBO without creating one. */
	get(entityId: EntityId): WebGLRenderTarget | null {
		return this.entries.get(entityId)?.rt ?? null;
	}

	/**
	 * Release `entityId`'s FBO. Returns true if something was released.
	 * Safe to call after dispose — returns false rather than corrupting the
	 * byte counter or double-disposing the target.
	 */
	release(entityId: EntityId): boolean {
		if (this.disposed) return false;
		const entry = this.entries.get(entityId);
		if (!entry) return false;
		entry.rt.dispose();
		// Clamp at zero so out-of-order teardown never makes the counter
		// negative — entries.delete + dispose() race during Compositor
		// unmount could otherwise produce a misleading negative gauge.
		this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
		this.entries.delete(entityId);
		return true;
	}

	/** Total GPU bytes consumed by the pool. */
	bytesUsed(): number {
		return this.totalBytes;
	}

	/** Number of FBOs currently held. */
	size(): number {
		return this.entries.size;
	}

	/** Iterate live entries. */
	forEach(cb: (entityId: EntityId, rt: WebGLRenderTarget) => void): void {
		for (const [id, entry] of this.entries) cb(id, entry.rt);
	}

	/** Dispose every FBO. After this, acquire throws and release returns false. */
	dispose(): void {
		if (this.disposed) return;
		for (const entry of this.entries.values()) entry.rt.dispose();
		this.entries.clear();
		this.totalBytes = 0;
		this.disposed = true;
	}
}
