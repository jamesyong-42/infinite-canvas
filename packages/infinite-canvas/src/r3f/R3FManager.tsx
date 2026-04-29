import type { EntityId } from '@jamesyong42/reactive-ecs';
import { Canvas } from '@react-three/fiber';
import type * as React from 'react';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { useContainerRef } from '../react/context/container-ref-context.js';
import { EngineProvider } from '../react/context/engine-context.js';
import type { ResolvedWidget } from '../react/context/widget-resolver-context.js';
import { createR3FEventManager } from '../react/input/r3f/createR3FEventManager.js';
import type { R3FWidgetProps } from '../react/widgets/registry.js';
import { Compositor } from './compositor/Compositor.js';
import { VirtualWidget } from './compositor/VirtualWidget.js';
import { WidgetRegistry } from './compositor/WidgetRegistry.js';
import { WidgetStateMachine } from './compositor/WidgetStateMachine.js';
import { EngineInvalidator } from './EngineInvalidator.js';
import { ProfilerProbe } from './ProfilerProbe.js';

interface R3FManagerProps {
	engine: LayoutEngine;
	entities: EntityId[];
	resolve: (entityId: EntityId) => ResolvedWidget | null;
	/**
	 * Optional R3F nodes mounted at the Canvas root as siblings of the
	 * Compositor (so they live in the Canvas's default scene, not inside
	 * any widget portal). Canonical use: drei's `<Environment>` — the
	 * Compositor's `sharedEnv` propagation logic checks the root scene
	 * before iterating widget scenes, so a root-level env stays alive
	 * across widget navigation (RFC-004 Phase 5 follow-up).
	 */
	r3fRoot?: React.ReactNode;
	/**
	 * Late-bound handle for the R3F event manager. RFC-008's `R3FRouter`
	 * (constructed in `InfiniteCanvas`) reads this ref to dispatch into
	 * R3F's mesh handlers from the InputManager pipeline. The factory
	 * writes the produced manager into `.current` once R3F invokes it.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: R3F manager type isn't
	// surfaced cleanly through our types.
	eventManagerRef?: React.MutableRefObject<any>;
}

/**
 * Top-level coordinator for the R3F (React Three Fiber) rendering layer.
 *
 * Mounts a single `<Canvas>` and lets the {@link Compositor} drive the
 * render loop — each R3F widget paints into its own `WebGLRenderTarget`
 * via {@link VirtualWidget} and a final composition pass samples those
 * textures into the visible canvas (RFC-002 Phase 4).
 */
export function R3FManager({
	engine,
	entities,
	resolve,
	r3fRoot,
	eventManagerRef,
}: R3FManagerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	// Route R3F's native pointer listeners onto the canvas container, not
	// the canvas DOM element. Lets us keep `pointer-events: none` on the
	// canvas (so it never occludes DOM widgets stacked underneath at lower
	// z-indices) while still feeding R3F every event the bus sees.
	const containerRef = useContainerRef();

	// R3F needs an initial camera; the Compositor swaps in its own world-space
	// ortho camera as the canvas default once mounted.
	const initialCamera = useMemo(() => {
		const cam = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 10000);
		cam.position.set(0, 0, 1000);
		return cam;
	}, []);

	// Stable per-canvas registry (RFC-006). The Compositor populates it
	// as VirtualWidget instances mount/unmount; the EventRouter reads it
	// at intersect time to pick the right scene + camera for raycasting.
	const widgetRegistry = useMemo(() => new WidgetRegistry(), []);

	// RFC-008 v5 — same dispatch machinery as the default R3F manager
	// (bubbling, hover diff, click synthesis, capture, stopPropagation,
	// onPointerMissed fan-out), but `connect` / `disconnect` are no-ops:
	// the InputManager owns native pointer listeners on the canvas
	// container, and `R3FRouter` invokes R3F's mesh dispatch from the
	// pipeline instead of letting R3F register its own listeners. The
	// `compute` step still targets per-widget scenes for raycasting.
	const eventManager = useMemo(
		() =>
			createR3FEventManager(engine, widgetRegistry, (manager) => {
				if (eventManagerRef) eventManagerRef.current = manager;
			}),
		[engine, widgetRegistry, eventManagerRef],
	);

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
			frameloop="demand"
			events={eventManager}
			eventSource={
				// Cast: R3F's `eventSource` is typed `RefObject<HTMLElement>`
				// (non-null current), but our shared container ref is
				// `RefObject<HTMLDivElement | null>` because the div mounts
				// after first render. R3F reads `.current` lazily on first
				// event, by which point the ref is populated.
				(containerRef ?? undefined) as React.RefObject<HTMLElement> | undefined
			}
			gl={{ alpha: true, antialias: true }}
			style={{
				position: 'absolute',
				inset: 0,
				// Canvas itself never receives events — R3F listens on the
				// canvas container via `eventSource`, so the canvas can stay
				// transparent to pointers without losing widget interactions.
				// Keeps DOM widgets at lower z-indices clickable.
				pointerEvents: 'none',
				zIndex: 1,
				display: widgetEntries.length === 0 ? 'none' : 'block',
			}}
		>
			<EngineProvider value={engine}>
				<EngineInvalidator engine={engine} />
				<WidgetStateMachine engine={engine} />
				<ProfilerProbe engine={engine} widgetCount={widgetEntries.length} />
				{r3fRoot}
				<Compositor engine={engine} widgetRegistry={widgetRegistry}>
					{widgetEntries.map(({ entityId, component }) => (
						<VirtualWidget key={entityId} entityId={entityId} component={component} />
					))}
				</Compositor>
			</EngineProvider>
		</Canvas>
	);
}
