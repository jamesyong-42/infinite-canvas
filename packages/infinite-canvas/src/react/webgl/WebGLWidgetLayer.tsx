import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EntityId } from '../../ecs/types.js';
import type { LayoutEngine } from '../../engine.js';
import type { ResolvedWidget } from '../context.js';
import { EngineProvider } from '../context.js';
import { WebGLWidgetSlot } from './WebGLWidgetSlot.js';

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
			component: React.ComponentType<{
				entityId: EntityId;
				width: number;
				height: number;
				zoom: number;
			}>;
		}[] = [];
		for (const id of entities) {
			const resolved = resolve(id);
			if (resolved && resolved.surface === 'webgl') {
				result.push({
					entityId: id,
					component: resolved.component as React.ComponentType<{
						entityId: EntityId;
						width: number;
						height: number;
						zoom: number;
					}>,
				});
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
				{widgetEntries.map(({ entityId, component }) => (
					<WebGLWidgetSlot key={entityId} entityId={entityId} component={component} />
				))}
			</EngineProvider>
		</Canvas>
	);
}
