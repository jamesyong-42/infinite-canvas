import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type * as THREE from 'three';
import type { LayoutEngine } from '../ecs/engine/index.js';

/**
 * Synchronises the R3F orthographic camera with the engine's camera each
 * frame (and immediately on mount) so R3F widget world coordinates line up
 * with the DOM widgets rendered by InfiniteCanvas.
 */
export function CameraSync({ engine }: { engine: LayoutEngine }) {
	const { camera, size } = useThree();

	useLayoutEffect(() => {
		syncCamera(camera, size, engine);
	}, [camera, size, engine]);

	useFrame(() => {
		syncCamera(camera, size, engine);
	});

	return null;
}

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
