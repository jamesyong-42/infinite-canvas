import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import type { LayoutEngine } from '../ecs/engine/index.js';

/**
 * Reports one R3F frame sample per animation frame to the engine profiler.
 * Reads `renderer.info` from three.js — draw calls / triangles / memory /
 * programs — which is maintained by R3F's default render loop regardless
 * of whether we opt in. Only samples when the profiler is enabled.
 */
export function ProfilerProbe({
	engine,
	widgetCount,
}: {
	engine: LayoutEngine;
	widgetCount: number;
}) {
	const { gl } = useThree();
	const prevTimeRef = useRef<number | null>(null);
	const prevCallsRef = useRef(0);
	const prevTrianglesRef = useRef(0);
	const prevPointsRef = useRef(0);
	const prevLinesRef = useRef(0);

	useFrame(() => {
		const profiler = engine.profiler;
		if (!profiler.isEnabled()) {
			prevTimeRef.current = null;
			return;
		}
		const now = performance.now();
		const dtMs = prevTimeRef.current === null ? 0 : now - prevTimeRef.current;
		prevTimeRef.current = now;

		const info = gl.info;
		// renderer.info.render resets per frame when autoReset is true (default).
		// Read the current values as this frame's counts. But programs/memory
		// are cumulative gauges. Capture deltas defensively in case a future
		// change flips autoReset off.
		const calls = info.render.calls;
		const triangles = info.render.triangles;
		const points = info.render.points;
		const lines = info.render.lines;
		const frameCalls = info.autoReset ? calls : Math.max(0, calls - prevCallsRef.current);
		const frameTris = info.autoReset
			? triangles
			: Math.max(0, triangles - prevTrianglesRef.current);
		const framePoints = info.autoReset ? points : Math.max(0, points - prevPointsRef.current);
		const frameLines = info.autoReset ? lines : Math.max(0, lines - prevLinesRef.current);
		prevCallsRef.current = calls;
		prevTrianglesRef.current = triangles;
		prevPointsRef.current = points;
		prevLinesRef.current = lines;

		profiler.recordR3FFrame({
			dtMs,
			drawCalls: frameCalls,
			triangles: frameTris,
			points: framePoints,
			lines: frameLines,
			programs: info.programs?.length ?? 0,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			activeWidgets: widgetCount,
			// RFC-002 compositor fields — populated once Phase 4+ lands; zero
			// until then so the profiler shape is stable across phases.
			widgetsRepainted: 0,
			fboBytes: 0,
			phases: { hot: 0, warm: 0, cold: 0, waking: 0, dormant: 0 },
		});
	});

	return null;
}
