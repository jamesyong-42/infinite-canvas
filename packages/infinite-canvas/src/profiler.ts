/**
 * Multi-layer performance profiler.
 *
 * Tracks three independent rendering concerns:
 *
 *   1. ECS tick — systems, visibility, entity counts. Driven by `engine.tick()`.
 *   2. WebGL engine pass — the library's grid + selection renderers. Runs
 *      inside the rAF loop immediately after each ECS tick, so samples share
 *      the ECS ring and carry matched tick ids.
 *   3. R3F canvas — the user's 3D widgets inside the shared `<Canvas>`. Runs
 *      continuously at rAF cadence regardless of engine ticks, so it has its
 *      own ring.
 *
 * All methods are no-ops when disabled — zero cost for production builds.
 * User Timing API marks are emitted when enabled so traces line up with
 * Chrome DevTools' Performance panel.
 */

// === Sample shapes ===

export interface TickSample {
	tick: number;
	timestamp: number;
	/** Total tick duration (ms) = ECS tick + WebGL engine pass. */
	totalMs: number;
	ecs: {
		/** Per-system durations (ms). */
		systems: Record<string, number>;
		/** Visible entity computation (ms). */
		visibilityMs: number;
		/** Entity counts at this frame. */
		entityCount: number;
		visibleCount: number;
	};
	webgl: {
		/** Grid renderer pass duration (ms). */
		gridMs: number;
		/** Selection + hover + snap-guide render pass duration (ms). */
		selectionMs: number;
		/** three.js `renderer.info.render.calls` delta this tick. */
		drawCalls: number;
		/** three.js `renderer.info.render.triangles` delta this tick. */
		triangles: number;
		/** Selection frames drawn this tick. */
		selectionFrames: number;
		/** Snap guides drawn this tick. */
		snapGuides: number;
		/** Equal-spacing indicators drawn this tick. */
		spacingIndicators: number;
		/** DOM slot.transform writes this tick (from changes.positionsChanged). */
		domPositionsUpdated: number;
	};
}

export interface R3FSample {
	timestamp: number;
	/** Delta since the previous R3F frame (ms). */
	dtMs: number;
	/** three.js renderer.info snapshot. */
	drawCalls: number;
	triangles: number;
	points: number;
	lines: number;
	programs: number;
	geometries: number;
	textures: number;
	activeWidgets: number;
}

// === Stats shapes ===

export interface FrameTimeStats {
	avg: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
}

export interface EcsStats {
	fps: number;
	frameTime: FrameTimeStats;
	systemAvg: Record<string, number>;
	systemP95: Record<string, number>;
	/** Avg frame time as % of 16.67ms (60 fps). */
	budgetUsed: number;
	sampleCount: number;
}

export interface WebGLStats {
	gridAvg: number;
	gridP95: number;
	selectionAvg: number;
	selectionP95: number;
	avgDrawCalls: number;
	avgTriangles: number;
	avgSelectionFrames: number;
	avgSnapGuides: number;
	avgDomUpdates: number;
	sampleCount: number;
}

export interface R3FStats {
	fps: number;
	frameTime: FrameTimeStats;
	avgDrawCalls: number;
	avgTriangles: number;
	/** Latest snapshots — these don't average meaningfully. */
	programs: number;
	geometries: number;
	textures: number;
	activeWidgets: number;
	sampleCount: number;
}

export interface ProfilerStats {
	ecs: EcsStats;
	webgl: WebGLStats;
	r3f: R3FStats;
}

// === Implementation ===

const TICK_RING_SIZE = 300; // ~5 s at 60 fps
const R3F_RING_SIZE = 300;

/** What's being timed inside the library's WebGL engine pass. */
export type WebGLPass = 'grid' | 'selection';

export class Profiler {
	private enabled = false;

	// Tick ring (ECS + engine WebGL pass — matched cadence).
	private tickRing: TickSample[] = [];
	private tickWrite = 0;
	private tickFilled = false;

	// R3F ring (continuous, independent cadence).
	private r3fRing: R3FSample[] = [];
	private r3fWrite = 0;
	private r3fFilled = false;

	// Scratch state for the currently-building tick sample.
	private frameStart = 0;
	private currentSystems: Record<string, number> = {};
	private visibilityMs = 0;
	private webglGridMs = 0;
	private webglSelectionMs = 0;
	private webglDrawCalls = 0;
	private webglTriangles = 0;
	private webglSelectionFrames = 0;
	private webglSnapGuides = 0;
	private webglSpacingIndicators = 0;
	private webglDomPositionsUpdated = 0;
	private currentTick = 0;

	// Monotonic baseline for reading renderer.info.render deltas.
	private webglPassDrawCallsBaseline = 0;
	private webglPassTrianglesBaseline = 0;

	/** Enable/disable profiling. When disabled, all methods are no-ops. */
	setEnabled(on: boolean) {
		this.enabled = on;
		if (!on) this.clear();
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	// === ECS tick instrumentation ===

	/** Call at the start of engine.tick(). */
	beginFrame(tick: number) {
		if (!this.enabled) return;
		this.currentTick = tick;
		this.currentSystems = {};
		this.visibilityMs = 0;
		this.webglGridMs = 0;
		this.webglSelectionMs = 0;
		this.webglDrawCalls = 0;
		this.webglTriangles = 0;
		this.webglSelectionFrames = 0;
		this.webglSnapGuides = 0;
		this.webglSpacingIndicators = 0;
		this.webglDomPositionsUpdated = 0;
		this.frameStart = performance.now();
		performance.mark('ic-frame-start');
	}

	/** Call around each ECS system execution. */
	beginSystem(name: string) {
		if (!this.enabled) return;
		performance.mark(`ic-sys-${name}-start`);
	}

	endSystem(name: string) {
		if (!this.enabled) return;
		performance.mark(`ic-sys-${name}-end`);
		try {
			const measure = performance.measure(
				`ic:sys:${name}`,
				`ic-sys-${name}-start`,
				`ic-sys-${name}-end`,
			);
			this.currentSystems[name] = measure.duration;
		} catch {
			// marks may be cleared
		}
		performance.clearMarks(`ic-sys-${name}-start`);
		performance.clearMarks(`ic-sys-${name}-end`);
	}

	beginVisibility() {
		if (!this.enabled) return;
		performance.mark('ic-vis-start');
	}

	endVisibility() {
		if (!this.enabled) return;
		performance.mark('ic-vis-end');
		try {
			const measure = performance.measure('ic:visibility', 'ic-vis-start', 'ic-vis-end');
			this.visibilityMs = measure.duration;
		} catch {
			// marks may be cleared
		}
		performance.clearMarks('ic-vis-start');
		performance.clearMarks('ic-vis-end');
	}

	// === WebGL engine pass instrumentation ===

	/** Call right before the named engine WebGL pass renders. */
	beginWebGL(pass: WebGLPass) {
		if (!this.enabled) return;
		performance.mark(`ic-gl-${pass}-start`);
	}

	/** Call right after the named engine WebGL pass renders. */
	endWebGL(pass: WebGLPass) {
		if (!this.enabled) return;
		performance.mark(`ic-gl-${pass}-end`);
		try {
			const measure = performance.measure(
				`ic:gl:${pass}`,
				`ic-gl-${pass}-start`,
				`ic-gl-${pass}-end`,
			);
			if (pass === 'grid') this.webglGridMs = measure.duration;
			else this.webglSelectionMs = measure.duration;
		} catch {
			// marks may be cleared
		}
		performance.clearMarks(`ic-gl-${pass}-start`);
		performance.clearMarks(`ic-gl-${pass}-end`);
	}

	/**
	 * Record WebGL engine pass counters for the current tick.
	 * `drawCallsDelta` / `trianglesDelta` should be the difference in
	 * `renderer.info.render.calls` / `.triangles` across this tick's passes.
	 */
	recordWebGLStats(stats: {
		drawCallsDelta: number;
		trianglesDelta: number;
		selectionFrames: number;
		snapGuides: number;
		spacingIndicators: number;
		domPositionsUpdated: number;
	}) {
		if (!this.enabled) return;
		this.webglDrawCalls = stats.drawCallsDelta;
		this.webglTriangles = stats.trianglesDelta;
		this.webglSelectionFrames = stats.selectionFrames;
		this.webglSnapGuides = stats.snapGuides;
		this.webglSpacingIndicators = stats.spacingIndicators;
		this.webglDomPositionsUpdated = stats.domPositionsUpdated;
	}

	/**
	 * Read a running baseline of `renderer.info.render.calls/triangles` so a
	 * caller can compute per-tick deltas without leaking three.js types.
	 * Returns the baseline snapshot taken BEFORE this call; callers should
	 * snapshot before the WebGL pass and pass the delta to
	 * `recordWebGLStats` after.
	 */
	readWebGLBaseline(info: { calls: number; triangles: number }): {
		calls: number;
		triangles: number;
	} {
		const prev = {
			calls: this.webglPassDrawCallsBaseline,
			triangles: this.webglPassTrianglesBaseline,
		};
		this.webglPassDrawCallsBaseline = info.calls;
		this.webglPassTrianglesBaseline = info.triangles;
		return prev;
	}

	/** Call at the end of engine.tick() — flushes a TickSample to the ring. */
	endFrame(entityCount: number, visibleCount: number) {
		if (!this.enabled) return;
		performance.mark('ic-frame-end');

		let totalMs: number;
		try {
			const measure = performance.measure('ic:frame', 'ic-frame-start', 'ic-frame-end');
			totalMs = measure.duration;
		} catch {
			totalMs = performance.now() - this.frameStart;
		}
		performance.clearMarks('ic-frame-start');
		performance.clearMarks('ic-frame-end');

		// `totalMs` is the ECS tick only — the WebGL engine pass runs AFTER
		// endFrame. Its ms lives separately in the sample so consumers can
		// combine (ecs.totalMs + webgl.gridMs + webgl.selectionMs) if they
		// want a compound figure.

		const sample: TickSample = {
			tick: this.currentTick,
			timestamp: performance.now(),
			totalMs,
			ecs: {
				systems: { ...this.currentSystems },
				visibilityMs: this.visibilityMs,
				entityCount,
				visibleCount,
			},
			webgl: {
				gridMs: this.webglGridMs,
				selectionMs: this.webglSelectionMs,
				drawCalls: this.webglDrawCalls,
				triangles: this.webglTriangles,
				selectionFrames: this.webglSelectionFrames,
				snapGuides: this.webglSnapGuides,
				spacingIndicators: this.webglSpacingIndicators,
				domPositionsUpdated: this.webglDomPositionsUpdated,
			},
		};

		if (this.tickRing.length < TICK_RING_SIZE) {
			this.tickRing.push(sample);
		} else {
			this.tickRing[this.tickWrite] = sample;
		}
		this.tickWrite = (this.tickWrite + 1) % TICK_RING_SIZE;
		if (this.tickRing.length >= TICK_RING_SIZE) this.tickFilled = true;
	}

	// === R3F canvas instrumentation ===

	/**
	 * Push one R3F frame sample. Called from the R3F canvas via a probe
	 * component that has access to `useThree`.
	 */
	recordR3FFrame(sample: Omit<R3FSample, 'timestamp'>) {
		if (!this.enabled) return;
		const full: R3FSample = { ...sample, timestamp: performance.now() };
		if (this.r3fRing.length < R3F_RING_SIZE) {
			this.r3fRing.push(full);
		} else {
			this.r3fRing[this.r3fWrite] = full;
		}
		this.r3fWrite = (this.r3fWrite + 1) % R3F_RING_SIZE;
		if (this.r3fRing.length >= R3F_RING_SIZE) this.r3fFilled = true;
	}

	// === Queries ===

	/** Get the last N tick samples (newest first). */
	getSamples(count?: number): TickSample[] {
		return readRing(this.tickRing, this.tickWrite, this.tickFilled, count);
	}

	/** Get the last N R3F samples (newest first). */
	getR3FSamples(count?: number): R3FSample[] {
		return readRing(this.r3fRing, this.r3fWrite, this.r3fFilled, count);
	}

	/** Compute rolling statistics across all three layers. */
	getStats(): ProfilerStats {
		return {
			ecs: this.getEcsStats(),
			webgl: this.getWebGLStats(),
			r3f: this.getR3FStats(),
		};
	}

	private getEcsStats(): EcsStats {
		const samples = this.tickRing;
		const n = samples.length;
		if (n === 0) {
			return {
				fps: 0,
				frameTime: { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 },
				systemAvg: {},
				systemP95: {},
				budgetUsed: 0,
				sampleCount: 0,
			};
		}

		const frameTimes = samples.map((s) => s.totalMs).sort((a, b) => a - b);
		const avg = mean(frameTimes);

		const fps = ringFps(samples, this.tickWrite, this.tickFilled, TICK_RING_SIZE);

		const systemNames = new Set<string>();
		for (const s of samples) for (const k of Object.keys(s.ecs.systems)) systemNames.add(k);

		const systemAvg: Record<string, number> = {};
		const systemP95: Record<string, number> = {};
		for (const name of systemNames) {
			const times = samples.map((s) => s.ecs.systems[name] ?? 0).sort((a, b) => a - b);
			systemAvg[name] = mean(times);
			systemP95[name] = percentile(times, 95);
		}

		return {
			fps,
			frameTime: {
				avg,
				p50: percentile(frameTimes, 50),
				p95: percentile(frameTimes, 95),
				p99: percentile(frameTimes, 99),
				max: frameTimes[frameTimes.length - 1],
			},
			systemAvg,
			systemP95,
			budgetUsed: (avg / 16.67) * 100,
			sampleCount: n,
		};
	}

	private getWebGLStats(): WebGLStats {
		const samples = this.tickRing;
		const n = samples.length;
		if (n === 0) {
			return {
				gridAvg: 0,
				gridP95: 0,
				selectionAvg: 0,
				selectionP95: 0,
				avgDrawCalls: 0,
				avgTriangles: 0,
				avgSelectionFrames: 0,
				avgSnapGuides: 0,
				avgDomUpdates: 0,
				sampleCount: 0,
			};
		}
		const gridTimes = samples.map((s) => s.webgl.gridMs).sort((a, b) => a - b);
		const selTimes = samples.map((s) => s.webgl.selectionMs).sort((a, b) => a - b);
		return {
			gridAvg: mean(gridTimes),
			gridP95: percentile(gridTimes, 95),
			selectionAvg: mean(selTimes),
			selectionP95: percentile(selTimes, 95),
			avgDrawCalls: mean(samples.map((s) => s.webgl.drawCalls)),
			avgTriangles: mean(samples.map((s) => s.webgl.triangles)),
			avgSelectionFrames: mean(samples.map((s) => s.webgl.selectionFrames)),
			avgSnapGuides: mean(samples.map((s) => s.webgl.snapGuides)),
			avgDomUpdates: mean(samples.map((s) => s.webgl.domPositionsUpdated)),
			sampleCount: n,
		};
	}

	private getR3FStats(): R3FStats {
		const samples = this.r3fRing;
		const n = samples.length;
		if (n === 0) {
			return {
				fps: 0,
				frameTime: { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 },
				avgDrawCalls: 0,
				avgTriangles: 0,
				programs: 0,
				geometries: 0,
				textures: 0,
				activeWidgets: 0,
				sampleCount: 0,
			};
		}
		const dts = samples.map((s) => s.dtMs).sort((a, b) => a - b);
		const fps = ringFps(samples, this.r3fWrite, this.r3fFilled, R3F_RING_SIZE);
		// Latest snapshot for gauge-style values.
		const latestIdx = this.r3fFilled ? (this.r3fWrite - 1 + R3F_RING_SIZE) % R3F_RING_SIZE : n - 1;
		const latest = samples[latestIdx];
		return {
			fps,
			frameTime: {
				avg: mean(dts),
				p50: percentile(dts, 50),
				p95: percentile(dts, 95),
				p99: percentile(dts, 99),
				max: dts[dts.length - 1],
			},
			avgDrawCalls: mean(samples.map((s) => s.drawCalls)),
			avgTriangles: mean(samples.map((s) => s.triangles)),
			programs: latest.programs,
			geometries: latest.geometries,
			textures: latest.textures,
			activeWidgets: latest.activeWidgets,
			sampleCount: n,
		};
	}

	/** Clear all collected data and baselines. */
	clear() {
		this.tickRing = [];
		this.tickWrite = 0;
		this.tickFilled = false;
		this.r3fRing = [];
		this.r3fWrite = 0;
		this.r3fFilled = false;
		this.webglPassDrawCallsBaseline = 0;
		this.webglPassTrianglesBaseline = 0;
	}
}

// === Helpers ===

function mean(xs: number[]): number {
	if (xs.length === 0) return 0;
	let sum = 0;
	for (const x of xs) sum += x;
	return sum / xs.length;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.floor((p / 100) * (sorted.length - 1));
	return sorted[idx] ?? 0;
}

function readRing<T extends { timestamp: number }>(
	ring: T[],
	write: number,
	filled: boolean,
	count: number | undefined,
): T[] {
	const n = ring.length;
	if (n === 0) return [];
	const take = Math.min(count ?? n, n);
	const out: T[] = [];
	for (let i = 0; i < take; i++) {
		const idx = (write - 1 - i + n) % n;
		out.push(ring[idx]);
	}
	// `filled` unused intentionally — wrap math above handles both phases.
	void filled;
	return out;
}

function ringFps<T extends { timestamp: number }>(
	ring: T[],
	write: number,
	filled: boolean,
	size: number,
): number {
	const n = ring.length;
	if (n < 2) return 0;
	const newest = ring[filled ? (write - 1 + size) % size : n - 1];
	const oldest = ring[filled ? write : 0];
	const spanMs = newest.timestamp - oldest.timestamp;
	return spanMs > 0 ? Math.round(((n - 1) / spanMs) * 1000) : 0;
}
