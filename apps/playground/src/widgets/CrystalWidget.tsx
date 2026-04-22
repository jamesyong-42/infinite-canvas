import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import { createGeometryCardWidget } from '@jamesyong42/infinite-canvas';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { z } from 'zod';

const schema = z.object({
	tint: z.string().default('#9AE5FF'),
});
type CrystalData = z.infer<typeof schema>;

function CrystalScene({ data, width, height }: GeometryCardRenderProps<CrystalData>) {
	const meshRef = useRef<Mesh>(null);
	const size = Math.min(width, height);

	useFrame((state, dt) => {
		if (!meshRef.current) return;
		meshRef.current.rotation.y += dt * 0.4;
		meshRef.current.rotation.x += dt * 0.15;
		// Gentle idle bob.
		meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 2;
	});

	const lightDistance = size * 2;

	return (
		<group>
			<pointLight
				position={[size * 0.3, size * 0.4, size * 0.6]}
				intensity={180}
				distance={lightDistance}
				decay={1.4}
				color="#FFFFFF"
			/>
			<pointLight
				position={[-size * 0.3, -size * 0.3, size * 0.3]}
				intensity={80}
				distance={lightDistance}
				decay={1.6}
				color="#CBDFFF"
			/>
			<ambientLight intensity={0.4} />
			<mesh ref={meshRef}>
				<icosahedronGeometry args={[size * 0.3, 0]} />
				<meshPhysicalMaterial
					color={data.tint}
					roughness={0.08}
					transmission={0.85}
					thickness={1.2}
					ior={1.45}
					clearcoat={1}
					clearcoatRoughness={0.05}
					attenuationDistance={2.5}
					attenuationColor={data.tint}
				/>
			</mesh>
		</group>
	);
}

export const CrystalWidget = createGeometryCardWidget<CrystalData>({
	type: 'crystal-widget',
	size: 'small',
	schema,
	defaultData: { tint: '#9AE5FF' },
	background: 'transparent',
	geometry: CrystalScene,
});
