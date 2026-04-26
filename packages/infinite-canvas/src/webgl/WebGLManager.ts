import * as THREE from 'three';
import type { EqualSpacingIndicator, SnapGuide } from '../ecs/spatial/snap.js';
import type { Profiler } from '../profiler/Profiler.js';
import type { GridConfig } from './renderers/GridRenderer.js';
import { GridRenderer } from './renderers/GridRenderer.js';
import type { SelectionBounds, SelectionConfig } from './renderers/SelectionRenderer.js';
import { SelectionRenderer } from './renderers/SelectionRenderer.js';
import type { SnapGuideConfig } from './renderers/SnapGuideRenderer.js';
import { SnapGuideRenderer } from './renderers/SnapGuideRenderer.js';

/** Construction options for {@link WebGLManager}. */
export interface WebGLManagerOptions {
	/** Grid rendering config. Pass `false` to disable the grid entirely. */
	grid?: Partial<GridConfig> | false;
	/** Selection overlay config (outline color, handle size, etc.). */
	selection?: Partial<SelectionConfig>;
	/** Snap guide overlay config (color, line width, alpha). */
	snapGuides?: Partial<SnapGuideConfig>;
}

/** Per-frame input passed to {@link WebGLManager.render}. */
export interface WebGLFrameInput {
	camera: { x: number; y: number; zoom: number };
	/** Selection outlines + 8 resize handles + hover. */
	selection: {
		bounds: SelectionBounds[];
		hovered: SelectionBounds | null;
	};
	/**
	 * Alignment guides + equal-spacing indicators. Independent of
	 * `selection` — guides display whenever the engine is computing
	 * snap math, regardless of whether anything is selected. Set
	 * `visible: false` to skip the snap-guide pass entirely (the
	 * guides are still computed by the engine; only the render is
	 * suppressed).
	 */
	snap: {
		guides: SnapGuide[];
		spacings: EqualSpacingIndicator[];
		visible: boolean;
	};
	/** Optional — if supplied, the manager records per-pass timings + GL info. */
	profiler?: Profiler;
	/** Forwarded into the profiler sample (count of DOM slot transform writes this tick). */
	domPositionsUpdated?: number;
}

/**
 * Top-level coordinator for the library's vanilla-WebGL layer.
 *
 * Owns a single `THREE.WebGLRenderer` and drives the built-in renderers
 * (dot grid, selection overlay, snap guides) through it. This replaces
 * the previous pattern where `GridRenderer` owned the renderer and
 * `SelectionRenderer` piggy-backed on it via an implicit side-effect —
 * a manager makes the sharing explicit and gives {@link InfiniteCanvas}
 * a single surface to talk to instead of three.
 */
export class WebGLManager {
	private renderer: THREE.WebGLRenderer;
	private grid: GridRenderer | null = null;
	private selection: SelectionRenderer;
	private snapGuides: SnapGuideRenderer;

	constructor(canvas: HTMLCanvasElement, opts: WebGLManagerOptions = {}) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: false,
			premultipliedAlpha: false,
		});
		this.renderer.setClearColor(0x000000, 0);
		// Accumulate `renderer.info.render.calls/triangles` across multiple
		// render() calls per tick. The manager resets once per frame in
		// `render()` so grid + selection + snap counts cover one tick cleanly.
		this.renderer.info.autoReset = false;

		if (opts.grid !== false) {
			this.grid = new GridRenderer();
			if (opts.grid) this.grid.setConfig(opts.grid);
		}

		this.selection = new SelectionRenderer();
		if (opts.selection) this.selection.setConfig(opts.selection);

		this.snapGuides = new SnapGuideRenderer();
		if (opts.snapGuides) this.snapGuides.setConfig(opts.snapGuides);
	}

	/** Resize the drawing buffer. Call on mount and ResizeObserver events. */
	setSize(width: number, height: number, dpr = 1): void {
		this.renderer.setSize(width, height, false);
		this.renderer.setPixelRatio(dpr);
		const resolution = new THREE.Vector2(width * dpr, height * dpr);
		this.grid?.setSize(width, height, dpr);
		this.selection.setSize(resolution, dpr);
		this.snapGuides.setSize(resolution, dpr);
	}

	/** Update grid visuals (colors, spacings, fade ranges, etc.). */
	setGridConfig(config: Partial<GridConfig>): void {
		this.grid?.setConfig(config);
	}

	/** Update selection overlay visuals (outline color, handle size, etc.). */
	setSelectionConfig(config: Partial<SelectionConfig>): void {
		this.selection.setConfig(config);
	}

	/** Update snap-guide visuals (color, line width, alpha). */
	setSnapGuideConfig(config: Partial<SnapGuideConfig>): void {
		this.snapGuides.setConfig(config);
	}

	/** Render one frame: grid → selection → snap guides, in stacking order. */
	render(input: WebGLFrameInput): void {
		const { camera, selection, snap, profiler } = input;

		// Reset once per frame so grid + selection + snap counts accumulate
		// into the same tick. Safe to call even when the profiler is
		// disabled — it's cheap and keeps info.render deterministic.
		this.renderer.info.reset();

		if (this.grid) {
			profiler?.beginWebGL('grid');
			this.grid.render(this.renderer, camera.x, camera.y, camera.zoom);
			profiler?.endWebGL('grid');
		}

		profiler?.beginWebGL('selection');
		this.selection.render(
			this.renderer,
			camera.x,
			camera.y,
			camera.zoom,
			selection.bounds,
			selection.hovered,
		);
		profiler?.endWebGL('selection');

		// Call the snap-guide pass on every visible frame, even when both
		// arrays are empty. The renderer always uploads the current counts
		// (zero or non-zero) so its uniforms stay in sync, and the shader's
		// own `discard` makes the empty case effectively free. This avoids
		// any class of stale-uniform bugs when guides come and go.
		if (snap.visible) {
			profiler?.beginWebGL('snap-guides');
			this.snapGuides.render(
				this.renderer,
				camera.x,
				camera.y,
				camera.zoom,
				snap.guides,
				snap.spacings,
			);
			profiler?.endWebGL('snap-guides');
		}

		if (profiler?.isEnabled()) {
			const info = this.renderer.info;
			profiler.recordWebGLStats({
				drawCalls: info.render.calls,
				triangles: info.render.triangles,
				selectionFrames: selection.bounds.length + (selection.hovered ? 1 : 0),
				snapGuides: snap.guides.length,
				spacingIndicators: snap.spacings.length,
				domPositionsUpdated: input.domPositionsUpdated ?? 0,
			});
		}
	}

	/** Release GL resources — call on unmount. */
	dispose(): void {
		this.grid?.dispose();
		this.selection.dispose();
		this.snapGuides.dispose();
		this.renderer.dispose();
	}

	/** Escape hatch if an advanced consumer needs the underlying three renderer. */
	getWebGLRenderer(): THREE.WebGLRenderer {
		return this.renderer;
	}
}
