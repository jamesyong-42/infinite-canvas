import type { EntityId } from '@jamesyong42/reactive-ecs';
import { Canvas } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { EngineProvider } from '../react/context/engine-context.js';
import type { ResolvedWidget } from '../react/context/widget-resolver-context.js';
import type { R3FWidgetProps } from '../react/widgets/registry.js';
import { Compositor } from './compositor/Compositor.js';
import { VirtualWidget } from './compositor/VirtualWidget.js';
import { WidgetStateMachine } from './compositor/WidgetStateMachine.js';
import { EngineInvalidator } from './EngineInvalidator.js';
import { ProfilerProbe } from './ProfilerProbe.js';

interface R3FManagerProps {
	engine: LayoutEngine;
	entities: EntityId[];
	resolve: (entityId: EntityId) => ResolvedWidget | null;
}

/**
 * Top-level coordinator for the R3F (React Three Fiber) rendering layer.
 *
 * Mounts a single `<Canvas>` and lets the {@link Compositor} drive the
 * render loop — each R3F widget paints into its own `WebGLRenderTarget`
 * via {@link VirtualWidget} and a final composition pass samples those
 * textures into the visible canvas (RFC-002 Phase 4).
 */
export function R3FManager({ engine, entities, resolve }: R3FManagerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// R3F needs an initial camera; the Compositor swaps in its own world-space
	// ortho camera as the canvas default once mounted.
	const initialCamera = useMemo(() => {
		const cam = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 10000);
		cam.position.set(0, 0, 1000);
		return cam;
	}, []);

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
				<EngineInvalidator engine={engine} />
				<WidgetStateMachine engine={engine} />
				<ProfilerProbe engine={engine} widgetCount={widgetEntries.length} />
				<Compositor engine={engine}>
					{widgetEntries.map(({ entityId, component }) => (
						<VirtualWidget key={entityId} entityId={entityId} component={component} />
					))}
				</Compositor>
			</EngineProvider>
		</Canvas>
	);
}
