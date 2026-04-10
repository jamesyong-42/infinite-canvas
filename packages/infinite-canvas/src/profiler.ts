/**
 * Performance profiler with User Timing API integration.
 * Zero-cost when disabled — all methods are no-ops.
 * When enabled, data shows in Chrome DevTools Performance tab.
 */

export interface FrameSample {
	tick: number;
	timestamp: number;
	/** Total tick duration (ms) */
	totalMs: number;
	/** Per-system durations (ms) */
	systems: Record<string, number>;
	/** Visible entity computation (ms) */
	visibilityMs: number;
	/** Entity counts at this frame */
	entityCount: number;
	visibleCount: number;
}

export interface ProfilerStats {
	/** Frames per second (based on tick rate, not rAF) */
	fps: number;
	/** Frame time stats (ms) */
	frameTime: { avg: number; p50: number; p95: number; p99: number; max: number };
	/** Per-system average time (ms) */
	systemAvg: Record<string, number>;
	/** Per-system p95 time (ms) */
	systemP95: Record<string, number>;
	/** Frame budget utilization at 60fps (%) */
	budgetUsed: number;
	/** Total samples in buffer */
	sampleCount: number;
}

const RING_SIZE = 300; // ~5 seconds at 60fps

export class Profiler {
	private enabled = false;
	private ring: FrameSample[] = [];
	private writeIdx = 0;
	private filled = false;

	// Scratch state for current frame
	private frameStart = 0;
	private currentSystems: Record<string, number> = {};
	private visibilityMs = 0;
	private currentTick = 0;

	/** Enable/disable profiling. When disabled, all methods are no-ops. */
	setEnabled(on: boolean) {
		this.enabled = on;
		if (!on) {
			this.ring = [];
			this.writeIdx = 0;
			this.filled = false;
		}
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	/** Call at the start of engine.tick() */
	beginFrame(tick: number) {
		if (!this.enabled) return;
		this.currentTick = tick;
		this.currentSystems = {};
		this.visibilityMs = 0;
		this.frameStart = performance.now();
		performance.mark('ic-frame-start');
	}

	/** Call around each system execution */
	beginSystem(name: string) {
		if (!this.enabled) return;
		performance.mark(`ic-sys-${name}-start`);
	}

	endSystem(name: string) {
		if (!this.enabled) return;
		performance.mark(`ic-sys-${name}-end`);
		try {
			const measure = performance.measure(
				`ic:${name}`,
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

	/** Call around the visibility computation phase */
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

	/** Call at the end of engine.tick() */
	endFrame(entityCount: number, visibleCount: number) {
		if (!this.enabled) return;
		performance.mark('ic-frame-end');

		let totalMs = 0;
		try {
			const measure = performance.measure('ic:frame', 'ic-frame-start', 'ic-frame-end');
			totalMs = measure.duration;
		} catch {
			totalMs = performance.now() - this.frameStart;
		}
		performance.clearMarks('ic-frame-start');
		performance.clearMarks('ic-frame-end');

		const sample: FrameSample = {
			tick: this.currentTick,
			timestamp: performance.now(),
			totalMs,
			systems: { ...this.currentSystems },
			visibilityMs: this.visibilityMs,
			entityCount,
			visibleCount,
		};

		// Write to ring buffer
		if (this.ring.length < RING_SIZE) {
			this.ring.push(sample);
		} else {
			this.ring[this.writeIdx] = sample;
		}
		this.writeIdx = (this.writeIdx + 1) % RING_SIZE;
		if (this.ring.length >= RING_SIZE) this.filled = true;
	}

	/** Get the last N frame samples (newest first) */
	getSamples(count?: number): FrameSample[] {
		const n = Math.min(count ?? this.ring.length, this.ring.length);
		const result: FrameSample[] = [];
		for (let i = 0; i < n; i++) {
			const idx = (this.writeIdx - 1 - i + this.ring.length) % this.ring.length;
			if (idx >= 0 && idx < this.ring.length) {
				result.push(this.ring[idx]);
			}
		}
		return result;
	}

	/** Compute rolling statistics from the ring buffer */
	getStats(): ProfilerStats {
		const samples = this.ring;
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

		// Frame times sorted for percentiles
		const frameTimes = samples.map((s) => s.totalMs).sort((a, b) => a - b);

		// FPS from time span
		const newest = samples[this.filled ? (this.writeIdx - 1 + RING_SIZE) % RING_SIZE : n - 1];
		const oldest = samples[this.filled ? this.writeIdx : 0];
		const spanMs = newest.timestamp - oldest.timestamp;
		const fps = spanMs > 0 ? Math.round(((n - 1) / spanMs) * 1000) : 0;

		// Percentiles
		const percentile = (sorted: number[], p: number) => {
			const idx = Math.floor((p / 100) * (sorted.length - 1));
			return sorted[idx] ?? 0;
		};

		const avg = frameTimes.reduce((a, b) => a + b, 0) / n;

		// Per-system stats
		const systemNames = new Set<string>();
		for (const s of samples) {
			for (const name of Object.keys(s.systems)) systemNames.add(name);
		}

		const systemAvg: Record<string, number> = {};
		const systemP95: Record<string, number> = {};
		for (const name of systemNames) {
			const times = samples.map((s) => s.systems[name] ?? 0).sort((a, b) => a - b);
			systemAvg[name] = times.reduce((a, b) => a + b, 0) / n;
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

	/** Clear all collected data */
	clear() {
		this.ring = [];
		this.writeIdx = 0;
		this.filled = false;
	}
}
