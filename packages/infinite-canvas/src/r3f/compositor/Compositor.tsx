import type { EntityId } from '@jamesyong42/reactive-ecs';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Mesh, OrthographicCamera, PlaneGeometry } from 'three';
import { WorldBounds } from '../../ecs/components.js';
import type { LayoutEngine } from '../../ecs/engine/index.js';
import { CompositionMaterial } from './CompositionMaterial.js';
import { CompositorContext, type CompositorWidgetEntry } from './CompositorContext.js';
import { R3FRenderState } from './state.js';
import { WidgetRenderTargetPool } from './WidgetRenderTargetPool.js';

/**
 * Drives the per-widget paint + composition render loop (RFC-002 Phase 4).
 *
 * Lifecycle each invalidation:
 *   1. For every registered widget whose phase is Hot or Waking (or whose
 *      paintGeneration > fboGeneration), bind its FBO and render its scene
 *      with its widget-local camera.
 *   2. Update each widget's composition quad (position, scale, texture).
 *   3. Render the composition scene to the canvas backbuffer with a
 *      world-space orthographic camera matching the engine camera.
 *
 * Owns the `WidgetRenderTargetPool`. Children mount `<VirtualWidget />`
 * instances which register their scene+camera via context.
 *
 * Replaces the old `R3FWidgetSlot` + `CameraSync` pair.
 */
export function Compositor({
	engine,
	children,
}: {
	engine: LayoutEngine;
	children: React.ReactNode;
}) {
	const { gl, size, scene: defaultScene, set } = useThree();

	// Per-widget registry, kept outside React state so registration/dirty
	// tracking does not trigger re-renders.
	const widgetsRef = useRef(new Map<EntityId, CompositorWidgetEntry>());
	const poolRef = useRef<WidgetRenderTargetPool | null>(null);
	if (!poolRef.current) poolRef.current = new WidgetRenderTargetPool();
	const pool = poolRef.current;

	// Per-widget composition quad mesh kept in the default scene. Mounted /
	// removed as widgets register / unregister.
	const quadsRef = useRef(new Map<EntityId, Mesh>());

	// World-space ortho camera that drives the composition pass. Replaces
	// the role the previous CameraSync played for the shared scene.
	const compCamera = useMemo(() => new OrthographicCamera(0, 1, 0, -1, 0.1, 10000), []);

	// Make the compositor's camera the default Canvas camera so any built-in
	// R3F utilities (raycaster, etc.) have a sensible reference.
	useEffect(() => {
		set({ camera: compCamera });
	}, [set, compCamera]);

	const register = useCallback(
		(entityId: EntityId, entry: CompositorWidgetEntry) => {
			widgetsRef.current.set(entityId, entry);

			// Spawn a composition quad for this widget.
			const mesh = new Mesh(SHARED_QUAD_GEOMETRY, new CompositionMaterial());
			mesh.frustumCulled = false;
			mesh.visible = false; // Hidden until the widget has painted at least once.
			defaultScene.add(mesh);
			quadsRef.current.set(entityId, mesh);

			// Trigger an initial render so the widget can paint.
			entry.requestRepaint();

			return () => {
				widgetsRef.current.delete(entityId);
				const m = quadsRef.current.get(entityId);
				if (m) {
					defaultScene.remove(m);
					(m.material as CompositionMaterial).dispose();
					quadsRef.current.delete(entityId);
				}
				pool.release(entityId);
			};
		},
		[defaultScene, pool],
	);

	const ctxValue = useMemo(() => ({ pool, register }), [pool, register]);

	// Custom render loop. Priority > 0 suppresses R3F's default render so we
	// own the entire pass.
	useFrame(() => {
		const cam = engine.getCamera();

		// Sync composition camera frustum + position to the engine camera.
		compCamera.left = 0;
		compCamera.right = size.width / cam.zoom;
		compCamera.top = 0;
		compCamera.bottom = -(size.height / cam.zoom);
		compCamera.position.set(cam.x, -cam.y, 1000);
		compCamera.updateProjectionMatrix();

		const dpr = gl.getPixelRatio();
		const world = engine.world;

		// Per-widget paint pass.
		let widgetsRepainted = 0;
		const previousRenderTarget = gl.getRenderTarget();
		for (const [entityId, entry] of widgetsRef.current) {
			const wb = world.getComponent(entityId, WorldBounds);
			if (!wb) continue;
			const state = world.getComponent(entityId, R3FRenderState);
			if (!state) continue;

			const phaseWantsPaint = state.phase === 'Hot' || state.phase === 'Waking';
			const generationDirty = state.paintGeneration > state.fboGeneration;
			if (!phaseWantsPaint && !generationDirty && pool.get(entityId) !== null) {
				continue;
			}

			const fbo = pool.acquire(entityId, wb.worldWidth, wb.worldHeight, dpr);
			gl.setRenderTarget(fbo);
			gl.setClearColor(0x000000, 0);
			gl.clear(true, true, false);
			gl.render(entry.scene, entry.camera);

			// Mark the widget as painted at this generation.
			world.setComponent(entityId, R3FRenderState, {
				...state,
				fboGeneration: state.paintGeneration,
				paintedAt: {
					width: wb.worldWidth,
					height: wb.worldHeight,
					dpr,
					zoom: cam.zoom,
				},
			});
			widgetsRepainted++;
		}
		gl.setRenderTarget(previousRenderTarget);

		// Update composition quads.
		for (const [entityId, mesh] of quadsRef.current) {
			const wb = world.getComponent(entityId, WorldBounds);
			const fbo = pool.get(entityId);
			if (!wb || !fbo) {
				mesh.visible = false;
				continue;
			}
			mesh.visible = true;
			mesh.position.set(wb.worldX + wb.worldWidth / 2, -(wb.worldY + wb.worldHeight / 2), 0);
			mesh.scale.set(wb.worldWidth, wb.worldHeight, 1);
			(mesh.material as CompositionMaterial).setMap(fbo.texture);
		}

		// Composition pass to the canvas backbuffer.
		gl.setClearColor(0x000000, 0);
		gl.clear(true, true, false);
		gl.render(defaultScene, compCamera);

		// Stash this frame's repaint count where ProfilerProbe can read it.
		COMPOSITOR_TELEMETRY.widgetsRepainted = widgetsRepainted;
		COMPOSITOR_TELEMETRY.fboBytes = pool.bytesUsed();
	}, 1);

	return <CompositorContext.Provider value={ctxValue}>{children}</CompositorContext.Provider>;
}

/**
 * Shared between Compositor and ProfilerProbe so the probe can record FBO
 * bytes and per-frame repaint counts without an extra subscription path.
 * Module-scoped because both components live in the same canvas.
 */
export const COMPOSITOR_TELEMETRY = {
	widgetsRepainted: 0,
	fboBytes: 0,
};

/** Unit-square geometry shared by every composition quad — scaled per-mesh. */
const SHARED_QUAD_GEOMETRY = new PlaneGeometry(1, 1);
