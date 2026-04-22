import type { EntityId } from '@jamesyong42/reactive-ecs';
import { createPortal, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { OrthographicCamera, Scene } from 'three';
import { WorldBounds } from '../../ecs/components.js';
import { useComponent } from '../../react/hooks/ecs.js';
import type { R3FWidgetProps } from '../../react/widgets/registry.js';
import { useCompositor } from './CompositorContext.js';

/**
 * Mounts one R3F widget into its own Three.js scene + ortho camera so it
 * can be painted into a private `WebGLRenderTarget` instead of the main
 * canvas backbuffer.
 *
 * The user component is rendered in widget-local space — origin at centre,
 * X right, Y up, dimensions = (worldWidth, worldHeight) in world units.
 * That matches the contract the previous `R3FWidgetSlot` exposed, so user
 * widget code (e.g. `geometry-card`) needs no changes.
 *
 * VirtualWidget itself does not paint or composite — that's the
 * Compositor's job. We just create the scene/camera and register them so
 * the Compositor can iterate widgets in its render loop.
 */
export function VirtualWidget({
	entityId,
	component: Component,
}: {
	entityId: EntityId;
	component: React.ComponentType<R3FWidgetProps>;
}) {
	const { register } = useCompositor();
	const invalidate = useThree((s) => s.invalidate);

	// One scene + camera per widget, stable across re-renders.
	const scene = useMemo(() => new Scene(), []);
	const camera = useMemo(() => new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000), []);
	useEffect(() => {
		// Camera looks at origin from +Z so widget content drawn in the XY
		// plane is visible.
		camera.position.set(0, 0, 100);
		camera.lookAt(0, 0, 0);
	}, [camera]);

	const wb = useComponent(entityId, WorldBounds);

	// Track painted bounds so we can recompute the camera frustum if the
	// widget resizes mid-life. The Compositor reads camera dims at paint
	// time, so updating these here is enough.
	const lastBoundsRef = useRef<{ w: number; h: number } | null>(null);
	if (
		wb &&
		(!lastBoundsRef.current ||
			lastBoundsRef.current.w !== wb.worldWidth ||
			lastBoundsRef.current.h !== wb.worldHeight)
	) {
		camera.left = -wb.worldWidth / 2;
		camera.right = wb.worldWidth / 2;
		camera.top = wb.worldHeight / 2;
		camera.bottom = -wb.worldHeight / 2;
		camera.updateProjectionMatrix();
		lastBoundsRef.current = { w: wb.worldWidth, h: wb.worldHeight };
		// Resize → repaint.
		invalidate();
	}

	// Register with the Compositor on mount, deregister on unmount.
	useEffect(() => {
		const unregister = register(entityId, {
			scene,
			camera,
			requestRepaint: invalidate,
		});
		return unregister;
	}, [entityId, register, scene, camera, invalidate]);

	if (!wb) return null;

	// Portal mounts the React tree (and its useFrame / useState / etc.) into
	// the widget's own scene rather than the main R3F scene.
	return createPortal(
		<Component entityId={entityId} width={wb.worldWidth} height={wb.worldHeight} />,
		scene,
	);
}
