import type { EntityId } from '@jamesyong42/reactive-ecs';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LayoutEngine } from '../../engine.js';
import type { ResolvedWidget } from '../context.js';
import { EngineProvider } from '../context.js';
import type { R3FWidgetProps } from '../registry.js';
import { WebGLWidgetSlot } from './WebGLWidgetSlot.js';

// === Profiler probe (runs inside the R3F canvas) ===

/**
 * Reports one R3F frame sample per animation frame to the engine profiler.
 * Reads `renderer.info` from three.js — draw calls / triangles / memory /
 * programs — which is maintained by R3F's default render loop regardless
 * of whether we opt in. Only samples when the profiler is enabled.
 */
function ProfilerProbe({ engine, widgetCount }: { engine: LayoutEngine; widgetCount: number }) {
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
		});
	});

	return null;
}

// === Camera sync component (runs inside R3F) ===

function syncCamera(
	camera: THREE.Camera,
	size: { width: number; height: number },
	engine: LayoutEngine,
) {
	const cam = engine.getCamera();
	const ortho = camera as THREE.OrthographicCamera;

	// Frustum in world units — matches our engine coordinate system
	ortho.left = 0;
	ortho.right = size.width / cam.zoom;
	ortho.top = 0;
	ortho.bottom = -(size.height / cam.zoom);
	ortho.near = 0.1;
	ortho.far = 10000;

	// Position camera at engine camera origin; flip Y for Three.js
	ortho.position.set(cam.x, -cam.y, 1000);
	ortho.updateProjectionMatrix();
}

function CameraSync({ engine }: { engine: LayoutEngine }) {
	const { camera, size } = useThree();

	// Sync camera immediately on mount — don't wait for the first useFrame tick
	useLayoutEffect(() => {
		syncCamera(camera, size, engine);
	}, [camera, size, engine]);

	useFrame(() => {
		syncCamera(camera, size, engine);
	});

	return null;
}

// === Main layer component ===

interface WebGLWidgetLayerProps {
	engine: LayoutEngine;
	entities: EntityId[];
	resolve: (entityId: EntityId) => ResolvedWidget | null;
}

export function WebGLWidgetLayer({ engine, entities, resolve }: WebGLWidgetLayerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Create a stable orthographic camera (R3F needs one at init)
	const initialCamera = useMemo(() => {
		const cam = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 10000);
		cam.position.set(0, 0, 1000);
		return cam;
	}, []);

	// Build a map of entityId → component for rendering
	const widgetEntries = useMemo(() => {
		const result: {
			entityId: EntityId;
			component: React.ComponentType<R3FWidgetProps>;
		}[] = [];
		for (const id of entities) {
			const resolved = resolve(id);
			if (resolved && resolved.surface === 'webgl') {
				result.push({ entityId: id, component: resolved.component });
			}
		}
		return result;
	}, [entities, resolve]);

	return (
		<Canvas
			ref={canvasRef}
			camera={initialCamera}
			frameloop="always"
			gl={{ alpha: true, antialias: true }}
			style={{
				position: 'absolute',
				inset: 0,
				pointerEvents: 'none',
				zIndex: 1,
				display: widgetEntries.length === 0 ? 'none' : 'block',
			}}
		>
			<EngineProvider value={engine}>
				<CameraSync engine={engine} />
				<ProfilerProbe engine={engine} widgetCount={widgetEntries.length} />
				{widgetEntries.map(({ entityId, component }) => (
					<WebGLWidgetSlot key={entityId} entityId={entityId} component={component} />
				))}
			</EngineProvider>
		</Canvas>
	);
}
