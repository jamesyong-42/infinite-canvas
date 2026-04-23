import type { EntityId } from '@jamesyong42/reactive-ecs';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, type Scene } from 'three';
import { Dragging, WorldBounds } from '../../ecs/components.js';
import type { LayoutEngine } from '../../ecs/engine/index.js';
import { CompositorContext, type CompositorWidgetEntry } from './CompositorContext.js';
import { type EvictionCandidate, selectEvictions } from './eviction.js';
import { ResourceRegistry } from './ResourceRegistry.js';
import { R3FRenderBudget, R3FRenderState } from './state.js';
import { WidgetRenderTargetPool } from './WidgetRenderTargetPool.js';
import { isOutOfBand, selectBand } from './ZoomBands.js';

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
	const invalidate = useThree((s) => s.invalidate);

	// Per-widget registry, kept outside React state so registration/dirty
	// tracking does not trigger re-renders.
	const widgetsRef = useRef(new Map<EntityId, CompositorWidgetEntry>());

	// Pool + registry are created lazily and re-created if a previous instance
	// was disposed (React StrictMode mounts → cleanup → remount; the cleanup
	// disposes the resource but the same component instance is re-used, so
	// the ref still points at the disposed object).
	const poolRef = useRef<WidgetRenderTargetPool | null>(null);
	if (!poolRef.current || poolRef.current.isDisposed()) {
		poolRef.current = new WidgetRenderTargetPool();
	}
	const pool = poolRef.current;
	const registryRef = useRef<ResourceRegistry | null>(null);
	if (!registryRef.current || registryRef.current.isDisposed()) {
		registryRef.current = new ResourceRegistry();
	}
	const registry = registryRef.current;

	// Per-Compositor unit-square geometry — shared across all composition
	// quads in this canvas, scaled per-mesh. Not disposed in cleanup: GC
	// reclaims it when the Compositor instance is fully released, and
	// disposing here would leave a stale BufferGeometry across StrictMode's
	// double-mount cycle (Three.js doesn't expose a public "isDisposed").
	const quadGeometry = useMemo(() => new PlaneGeometry(1, 1), []);

	// Per-widget composition quad mesh kept in the default scene. Mounted /
	// removed as widgets register / unregister.
	const quadsRef = useRef(new Map<EntityId, Mesh>());

	// Per-widget drag-lift state, lerped at composition time. Lives outside
	// the per-widget scene so the widget's FBO never has to grow to fit
	// scaled-up content (which would clip rounded corners against the FBO
	// rectangle). RFC-002 § Phase 7 in spirit.
	const liftRef = useRef(new Map<EntityId, { scale: number; z: number }>());

	// Dynamic DPR: drop the canvas pixel ratio while the user is actively
	// gesturing (pinch / wheel) and restore on idle. Cuts composition GPU
	// cost during continuous interaction without making the static idle
	// view fuzzy. Tracks the last applied DPR so we only call
	// gl.setPixelRatio (which reallocates backing buffers) on transitions.
	const lastDprRef = useRef(-1);
	const idleDpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
	const gestureDpr = Math.min(idleDpr, 1);

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

			// Spawn a composition quad for this widget. MeshBasicMaterial
			// (rather than a custom ShaderMaterial) so Three.js's built-in
			// pipeline handles texture color-space conversion + tone mapping
			// + sRGB output encoding the same way it does for direct-to-canvas
			// rendering. Otherwise the FBO's tone-mapped values get displayed
			// in the wrong gamma space and look washed-out / desaturated.
			const mesh = new Mesh(
				quadGeometry,
				new MeshBasicMaterial({
					transparent: true,
					depthWrite: false,
					alphaTest: 0.001,
				}),
			);
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
					(m.material as MeshBasicMaterial).dispose();
					quadsRef.current.delete(entityId);
				}
				liftRef.current.delete(entityId);
				pool.release(entityId);
			};
		},
		[defaultScene, pool, quadGeometry],
	);

	const ctxValue = useMemo(() => ({ pool, registry, register }), [pool, registry, register]);

	// Dispose pool + registry on unmount (the lazy-init at the top of the
	// component re-creates them on the next render if React mounts us
	// again — StrictMode cleanup-then-remount, HMR, etc.).
	useEffect(() => {
		return () => {
			pool.dispose();
			registry.dispose();
		};
	}, [pool, registry]);

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

		// Apply dynamic DPR for the canvas backbuffer. setPixelRatio
		// reallocates buffers, so only call it on actual transitions.
		const targetDpr = cam.gesturing ? gestureDpr : idleDpr;
		if (lastDprRef.current !== targetDpr) {
			gl.setPixelRatio(targetDpr);
			lastDprRef.current = targetDpr;
		}

		const dpr = gl.getPixelRatio();
		const world = engine.world;

		// Share scene.environment across per-widget scenes. In the old
		// shared-scene architecture, drei's <Environment> mounted inside any
		// widget set IBL on the single root scene, so every PBR material got
		// the env reflection for free. With per-widget scenes each portal
		// sees only its own env; PBR materials in other widgets (especially
		// metallic ones) would render unlit. Propagate the first env we find
		// to every widget scene so global IBL behaviour is preserved.
		let sharedEnv = null as Scene['environment'];
		for (const [, entry] of widgetsRef.current) {
			if (entry.scene.environment) {
				sharedEnv = entry.scene.environment;
				break;
			}
		}
		if (sharedEnv) {
			for (const [eid, entry] of widgetsRef.current) {
				if (entry.scene.environment === sharedEnv) continue;
				entry.scene.environment = sharedEnv;
				// Re-render so the new IBL is reflected in this widget's FBO.
				const s = world.getComponent(eid, R3FRenderState);
				if (s) {
					world.setComponent(eid, R3FRenderState, {
						...s,
						paintGeneration: s.paintGeneration + 1,
					});
				}
			}
		}

		// Per-widget paint pass. Each paint is wrapped in try/finally so a
		// throwing widget can't leave the GL render target bound to its FBO
		// — that would corrupt the subsequent composition pass into the
		// canvas backbuffer.
		const band = selectBand(cam.zoom);
		const effectiveDpr = dpr * band;
		let widgetsRepainted = 0;
		for (const [entityId, entry] of widgetsRef.current) {
			const wb = world.getComponent(entityId, WorldBounds);
			if (!wb) continue;
			const state = world.getComponent(entityId, R3FRenderState);
			if (!state) continue;

			const phaseWantsPaint = state.phase === 'Hot' || state.phase === 'Waking';
			const generationDirty = state.paintGeneration > state.fboGeneration;
			// Hysteresis-banded zoom: if camera zoom has wandered outside the
			// band the widget was painted at, repaint at the new band so the
			// composition sample ratio snaps back near 1:1.
			//
			// While the user is actively gesturing (pinch / wheel zoom), we
			// SKIP band-driven repaints — without this, a continuous pinch
			// would trigger a repaint storm across every visible widget at
			// each band crossing. The composition shader's bilinear stretch
			// is "good enough" during the gesture; a single batch repaint
			// happens once the user stops.
			const bandChanged = !cam.gesturing && isOutOfBand(cam.zoom, state.paintedAt.zoom);
			if (!phaseWantsPaint && !generationDirty && !bandChanged && pool.get(entityId) !== null) {
				continue;
			}

			const fbo = pool.acquire(entityId, wb.worldWidth, wb.worldHeight, effectiveDpr);
			gl.setRenderTarget(fbo);
			try {
				gl.setClearColor(0x000000, 0);
				gl.clear(true, true, false);
				gl.render(entry.scene, entry.camera);
			} finally {
				gl.setRenderTarget(null);
			}

			// Mark the widget as painted at this generation. paintedAt.zoom
			// stores the BAND (not the live camera zoom) so subsequent ticks
			// compare against the same hysteresis edge.
			world.setComponent(entityId, R3FRenderState, {
				...state,
				fboGeneration: state.paintGeneration,
				paintedAt: {
					width: wb.worldWidth,
					height: wb.worldHeight,
					dpr: effectiveDpr,
					zoom: band,
				},
			});
			widgetsRepainted++;
		}

		// Eviction pass — if the pool is over budget after this frame's
		// paints, release FBOs in priority order until back under: Cold (LRU)
		// → Warm (LRU) → Dormant (LRU). Hot / Waking are never evicted. The
		// state machine sees fboGeneration=-1 and transitions evicted
		// widgets to Waking on next paint when they're visible again.
		const budget = world.getResource(R3FRenderBudget);
		if (pool.bytesUsed() > budget.maxBytes) {
			const candidates: EvictionCandidate[] = [];
			for (const info of pool.entryInfos()) {
				const s = world.getComponent(info.entityId, R3FRenderState);
				if (!s) continue;
				candidates.push({
					entityId: info.entityId,
					phase: s.phase,
					bytes: info.bytes,
					lastUsedMs: info.lastUsedMs,
				});
			}
			const toEvict = selectEvictions(candidates, pool.bytesUsed(), budget.maxBytes);
			for (const eid of toEvict) {
				const s = world.getComponent(eid, R3FRenderState);
				// Dormant evictions are logged at debug level so the memory
				// budget can be tuned when they happen — RFC § Phase 6.
				if (s?.phase === 'Dormant') {
					console.debug(
						'[r3f-compositor] evicting Dormant widget',
						eid,
						'— consider raising R3FRenderBudget.maxBytes',
					);
				}
				pool.release(eid);
				if (s) {
					world.setComponent(eid, R3FRenderState, { ...s, fboGeneration: -1 });
				}
			}
		}

		// Update composition quads. A quad is only made visible after its
		// widget's FBO has been painted at least once — checked via
		// fboGeneration >= 0 so a freshly-acquired (empty) target never gets
		// sampled into the composition.
		//
		// Drag-lift is applied here (composition layer), not inside the
		// widget's FBO — keeping the FBO at exactly widget bounds means
		// rounded corners never get clipped by the FBO rectangle.
		let liftStillSettling = false;
		for (const [entityId, mesh] of quadsRef.current) {
			const wb = world.getComponent(entityId, WorldBounds);
			const state = world.getComponent(entityId, R3FRenderState);
			const fbo = pool.get(entityId);
			if (!wb || !fbo || !state || state.fboGeneration < 0) {
				mesh.visible = false;
				continue;
			}
			// Refresh LRU timestamp — eviction would otherwise treat
			// still-composited Warm widgets as stale because pool.acquire is
			// only called on repaint and Warm widgets never repaint.
			pool.touch(entityId);

			// Lerp drag-lift toward target.
			const dragging = world.hasTag(entityId, Dragging);
			const targetScale = dragging ? 1.05 : 1;
			const targetZ = dragging ? 8 : 0;
			let lift = liftRef.current.get(entityId);
			if (!lift) {
				lift = { scale: 1, z: 0 };
				liftRef.current.set(entityId, lift);
			}
			lift.scale += (targetScale - lift.scale) * 0.2;
			lift.z += (targetZ - lift.z) * 0.2;
			if (Math.abs(targetScale - lift.scale) > 0.001 || Math.abs(targetZ - lift.z) > 0.01) {
				liftStillSettling = true;
			} else {
				// Snap to target so we don't drift forever within the epsilon.
				lift.scale = targetScale;
				lift.z = targetZ;
			}

			mesh.visible = true;
			mesh.position.set(wb.worldX + wb.worldWidth / 2, -(wb.worldY + wb.worldHeight / 2), lift.z);
			mesh.scale.set(wb.worldWidth * lift.scale, wb.worldHeight * lift.scale, 1);
			const material = mesh.material as MeshBasicMaterial;
			if (material.map !== fbo.texture) {
				material.map = fbo.texture;
				material.needsUpdate = true;
			}
		}

		// Composition pass to the canvas backbuffer. Explicit setRenderTarget
		// guards against any future code path leaving an FBO bound.
		gl.setRenderTarget(null);
		gl.setClearColor(0x000000, 0);
		gl.clear(true, true, false);
		gl.render(defaultScene, compCamera);

		// Stash this frame's repaint count where ProfilerProbe can read it.
		COMPOSITOR_TELEMETRY.widgetsRepainted = widgetsRepainted;
		COMPOSITOR_TELEMETRY.fboBytes = pool.bytesUsed();

		// Self-sustain the demand loop while a lift is settling, OR while
		// any widget is in Hot phase (animation-signalled widgets — e.g.
		// rotating mesh — need continuous frames). invalidate() inside a
		// useFrame sets internal.frames to 2, so the loop keeps spinning.
		let anyHot = false;
		for (const eid of widgetsRef.current.keys()) {
			const s = world.getComponent(eid, R3FRenderState);
			if (s?.phase === 'Hot') {
				anyHot = true;
				break;
			}
		}
		if (liftStillSettling || anyHot) invalidate();
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
