import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CanvasEngine, EntityId } from '@infinite-canvas/core';
import type { ResolvedWidget } from '../context.js';
import { EngineProvider } from '../context.js';
import { WebGLWidgetSlot } from './WebGLWidgetSlot.js';

// === Camera sync component (runs inside R3F) ===

function CameraSync({ engine }: { engine: CanvasEngine }) {
	const { camera, size } = useThree();

	useFrame(() => {
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
	});

	return null;
}

// === Main layer component ===

interface WebGLWidgetLayerProps {
	engine: CanvasEngine;
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
		const result: { entityId: EntityId; component: React.ComponentType<{ entityId: EntityId; width: number; height: number }> }[] = [];
		for (const id of entities) {
			const resolved = resolve(id);
			if (resolved && resolved.surface === 'webgl') {
				result.push({
					entityId: id,
					component: resolved.component as React.ComponentType<{ entityId: EntityId; width: number; height: number }>,
				});
			}
		}
		return result;
	}, [entities, resolve]);

	if (widgetEntries.length === 0) return null;

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
			}}
		>
			<EngineProvider value={engine}>
				<CameraSync engine={engine} />
				{widgetEntries.map(({ entityId, component }) => (
					<WebGLWidgetSlot
						key={entityId}
						entityId={entityId}
						component={component}
					/>
				))}
			</EngineProvider>
		</Canvas>
	);
}
