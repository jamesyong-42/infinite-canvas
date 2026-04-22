import type { EntityId } from '@jamesyong42/reactive-ecs';
import { createPortal, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { OrthographicCamera, Scene } from 'three';
import { WorldBounds } from '../../ecs/components.js';
import { useLayoutEngine } from '../../react/context/engine-context.js';
import { useComponent } from '../../react/hooks/ecs.js';
import type { R3FWidgetProps } from '../../react/widgets/registry.js';
import { useCompositor } from './CompositorContext.js';
import { R3FRenderState } from './state.js';

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
	const engine = useLayoutEngine();

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
	const w = wb?.worldWidth ?? 0;
	const h = wb?.worldHeight ?? 0;

	// Recompute the camera frustum + signal a repaint when bounds change.
	// useLayoutEffect (not render-time) so the mutation runs after commit
	// — bumping paintGeneration through setComponent during render would
	// trigger a re-entrant update.
	useLayoutEffect(() => {
		if (!w || !h) return;
		camera.left = -w / 2;
		camera.right = w / 2;
		camera.top = h / 2;
		camera.bottom = -h / 2;
		camera.updateProjectionMatrix();
		// The widget's FBO needs to be re-painted at the new dimensions.
		// Bump paintGeneration so the compositor's generationDirty check
		// picks it up; without this, a Warm widget on resize would keep
		// its old-sized FBO sampled into a new-sized quad (stretched).
		const current = engine.world.getComponent(entityId, R3FRenderState);
		if (current) {
			engine.world.setComponent(entityId, R3FRenderState, {
				...current,
				paintGeneration: current.paintGeneration + 1,
			});
		}
		invalidate();
	}, [camera, w, h, engine, entityId, invalidate]);

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
