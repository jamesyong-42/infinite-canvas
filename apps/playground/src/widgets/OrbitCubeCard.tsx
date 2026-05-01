import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import { createGeometryCardWidget } from '@jamesyong42/infinite-canvas';
import type { ThreeEvent } from '@react-three/fiber';
import { useCallback, useRef, useState } from 'react';
import type { Mesh } from 'three';
import { z } from 'zod';

const schema = z.object({
	hue: z.number().min(0).max(360).default(200),
});
type OrbitCubeData = z.infer<typeof schema>;

/**
 * RFC-008 § Default coexistence — exhibit widget for the InputManager
 * pipeline's "widget AND engine react to the same event" semantics.
 *
 * The cube's pointer handlers claim drag exclusively on the cube via
 * `e.target.setPointerCapture(e.pointerId)`: subsequent pointer events
 * route directly to the captured Object3D, so the canvas-container
 * `PointerAdapter` never sees them and the engine's `beginDrag` never
 * fires. Result:
 *
 *   - drag ON the cube → cube orbits, widget stays put
 *   - drag in the card chrome (around the cube) → widget moves on canvas
 *   - click on the cube → mesh `onClick` fires AND engine `click` fires
 *     (both correct: cube logs to console, widget gets selected — the
 *     coexistence holds even when the prior pointerdown captured)
 *   - hover the cube → mesh hover diff highlights AND engine selection
 *     ring + cursor update — full coexistence
 */
function OrbitCubeScene({ data, width, height }: GeometryCardRenderProps<OrbitCubeData>) {
	const meshRef = useRef<Mesh>(null);
	// Rotation tracked in refs so pointermove writes don't trigger a React
	// re-render mid-gesture. The mesh's quaternion/euler is updated
	// directly; React only re-renders on hover (color shift).
	const rotation = useRef({ x: 0, y: 0 });
	const drag = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
	const [hovered, setHovered] = useState(false);

	const size = Math.min(width, height) * 0.45;

	const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
		// Stop R3F's bubble so the bubble doesn't fan out to other meshes
		// in this widget. Note: this does NOT halt the InputManager
		// pipeline — the engine's `click` and `drag-start` handlers still
		// run. setPointerCapture below is what claims drag exclusivity.
		e.stopPropagation();
		// RFC-008 § Widget authoring — claim the drag for this mesh. The
		// browser routes subsequent pointermove / pointerup directly to
		// the captured Object3D, bypassing the canvas-container adapter,
		// so the engine never starts a widget drag.
		(e.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(
			e.pointerId,
		);
		drag.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
	}, []);

	const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		const dx = e.clientX - d.lastX;
		const dy = e.clientY - d.lastY;
		// 1 px ≈ 0.6° rotation. Keeps the gesture feeling tactile without
		// wraparound surprises.
		rotation.current.y += dx * 0.01;
		rotation.current.x += dy * 0.01;
		d.lastX = e.clientX;
		d.lastY = e.clientY;
		if (meshRef.current) {
			meshRef.current.rotation.y = rotation.current.y;
			meshRef.current.rotation.x = rotation.current.x;
		}
	}, []);

	const onPointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		(e.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(
			e.pointerId,
		);
		drag.current = null;
	}, []);

	const onClick = useCallback(
		(e: ThreeEvent<MouseEvent>) => {
			// Coexistence demo: this fires alongside the engine's `click`
			// handler. Engine selects the widget; cube logs.
			e.stopPropagation();
			console.debug('[OrbitCubeCard] mesh click', { hue: data.hue });
		},
		[data.hue],
	);

	const onPointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		setHovered(true);
	}, []);

	const onPointerOut = useCallback(() => {
		setHovered(false);
	}, []);

	const light = size * 3;

	return (
		<group>
			<pointLight
				position={[size * 0.6, size * 0.6, size * 0.8]}
				intensity={200}
				distance={light}
				decay={1.4}
				color="#FFFFFF"
			/>
			<pointLight
				position={[-size * 0.4, -size * 0.3, size * 0.5]}
				intensity={120}
				distance={light}
				decay={1.6}
				color={`hsl(${data.hue} 80% 70%)`}
			/>
			<ambientLight intensity={0.25} />
			<mesh
				ref={meshRef}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerOver={onPointerOver}
				onPointerOut={onPointerOut}
				onClick={onClick}
			>
				<boxGeometry args={[size, size, size]} />
				<meshPhysicalMaterial
					color={`hsl(${data.hue} ${hovered ? 90 : 65}% ${hovered ? 65 : 50}%)`}
					roughness={0.25}
					metalness={0.5}
					clearcoat={0.6}
					clearcoatRoughness={0.15}
				/>
			</mesh>
		</group>
	);
}

export const OrbitCubeCard = createGeometryCardWidget<OrbitCubeData>({
	type: 'orbit-cube-card',
	size: 'medium',
	schema,
	defaultData: { hue: 200 },
	background: 'linear-gradient(135deg, #102030 0%, #050a14 100%)',
	geometry: OrbitCubeScene,
	provides: ['widget'],
});
