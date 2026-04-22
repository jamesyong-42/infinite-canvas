import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import { createGeometryCardWidget } from '@jamesyong42/infinite-canvas';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { z } from 'zod';

const schema = z.object({
	hue: z.number().min(0).max(360).default(285),
});
type TorusKnotData = z.infer<typeof schema>;

function TorusKnotScene({ data, width, height }: GeometryCardRenderProps<TorusKnotData>) {
	const meshRef = useRef<Mesh>(null);
	const size = Math.min(width, height);

	useFrame((_, dt) => {
		if (!meshRef.current) return;
		meshRef.current.rotation.y += dt * 0.35;
		meshRef.current.rotation.x += dt * 0.18;
	});

	const light = size * 2.2;

	return (
		<group>
			<pointLight
				position={[size * 0.5, size * 0.5, size * 0.7]}
				intensity={220}
				distance={light}
				decay={1.4}
				color="#FFFFFF"
			/>
			<pointLight
				position={[-size * 0.5, -size * 0.3, size * 0.5]}
				intensity={110}
				distance={light}
				decay={1.6}
				color={`hsl(${data.hue} 80% 70%)`}
			/>
			<ambientLight intensity={0.2} />
			<mesh ref={meshRef} position={[0, 0, 6]}>
				<torusKnotGeometry args={[size * 0.18, size * 0.06, 180, 32]} />
				<meshPhysicalMaterial
					color={`hsl(${data.hue} 70% 58%)`}
					roughness={0.18}
					metalness={0.25}
					clearcoat={1}
					clearcoatRoughness={0.08}
					iridescence={1}
					iridescenceIOR={1.6}
					iridescenceThicknessRange={[100, 800]}
				/>
			</mesh>
		</group>
	);
}

export const TorusKnotCard = createGeometryCardWidget<TorusKnotData>({
	type: 'torus-knot-card',
	size: 'medium',
	schema,
	defaultData: { hue: 285 },
	background: { color: '#0B0B10', roughness: 0.9, metalness: 0 },
	geometry: TorusKnotScene,
});
