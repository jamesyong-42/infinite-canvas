import type { EntityId } from '@jamesyong42/reactive-ecs';
import { Canvas } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { EngineProvider } from '../react/context/engine-context.js';
import type { ResolvedWidget } from '../react/context/widget-resolver-context.js';
import type { R3FWidgetProps } from '../react/widgets/registry.js';
import { CameraSync } from './CameraSync.js';
import { ProfilerProbe } from './ProfilerProbe.js';
import { R3FWidgetSlot } from './R3FWidgetSlot.js';

interface R3FManagerProps {
	engine: LayoutEngine;
	entities: EntityId[];
	resolve: (entityId: EntityId) => ResolvedWidget | null;
}

/**
 * Top-level coordinator for the R3F (React Three Fiber) rendering layer.
 *
 * Owns the `<Canvas>`, drives camera sync with the engine, mounts the
 * profiler probe, and renders one {@link R3FWidgetSlot} per R3F-surface
 * widget entity. Mirrors the role {@link WebGLManager} plays for the
 * vanilla-WebGL layer: one component/class per rendering surface that
 * InfiniteCanvas composes together.
 */
export function R3FManager({ engine, entities, resolve }: R3FManagerProps) {
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
					<R3FWidgetSlot key={entityId} entityId={entityId} component={component} />
				))}
			</EngineProvider>
		</Canvas>
	);
}
