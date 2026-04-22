import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import { createGeometryCardWidget } from '@jamesyong42/infinite-canvas';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { z } from 'zod';

const schema = z.object({
	color: z.string().default('#E8523B'),
});
type CubeData = z.infer<typeof schema>;

function CubeScene({ data, width, height }: GeometryCardRenderProps<CubeData>) {
	const groupRef = useRef<Group>(null);
	const size = Math.min(width, height);

	useFrame((state, dt) => {
		if (!groupRef.current) return;
		groupRef.current.rotation.y += dt * 0.25;
		groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.18;
		groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 3;
	});

	const light = size * 1.8;
	const cubeSize = size * 0.42;

	return (
		<group>
			<pointLight
				position={[size * 0.5, size * 0.5, size * 0.8]}
				intensity={200}
				distance={light}
				decay={1.4}
				color="#FFFFFF"
			/>
			<pointLight
				position={[-size * 0.4, size * 0.2, size * 0.3]}
				intensity={80}
				distance={light}
				decay={1.6}
				color="#FFD4A3"
			/>
			<ambientLight intensity={0.3} />
			<group ref={groupRef}>
				<RoundedBox args={[cubeSize, cubeSize, cubeSize]} radius={cubeSize * 0.12} smoothness={4}>
					<meshStandardMaterial color={data.color} roughness={0.55} metalness={0.1} />
				</RoundedBox>
			</group>
		</group>
	);
}

export const FloatingCubeWidget = createGeometryCardWidget<CubeData>({
	type: 'floating-cube-widget',
	size: 'medium',
	schema,
	defaultData: { color: '#E8523B' },
	background: 'transparent',
	geometry: CubeScene,
});
