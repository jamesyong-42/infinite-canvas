import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import { createGeometryCardWidget } from '@jamesyong42/infinite-canvas';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { z } from 'zod';

const schema = z.object({
	color: z.string().default('#F5B8D0'),
});
type MatteSphereData = z.infer<typeof schema>;

function MatteSphereScene({ data, width, height }: GeometryCardRenderProps<MatteSphereData>) {
	const meshRef = useRef<Mesh>(null);
	const size = Math.min(width, height);

	// Static — does not opt into useWidgetAnimation, so this card is painted
	// once and reused as a cheap reference for comparing against the other
	// continuously-animating geometry widgets.

	const lightDistance = size * 1.5;

	return (
		<group>
			<pointLight
				position={[size * 0.4, size * 0.4, size * 0.6]}
				intensity={160}
				distance={lightDistance}
				decay={1.4}
				color="#FFFFFF"
			/>
			<pointLight
				position={[-size * 0.4, -size * 0.3, size * 0.4]}
				intensity={60}
				distance={lightDistance}
				decay={1.6}
				color="#8AB4FF"
			/>
			<ambientLight intensity={0.25} />
			<mesh ref={meshRef} position={[0, 0, 4]}>
				<sphereGeometry args={[size * 0.32, 48, 48]} />
				<meshStandardMaterial color={data.color} roughness={0.35} metalness={0.05} />
			</mesh>
		</group>
	);
}

export const MatteSphereCard = createGeometryCardWidget<MatteSphereData>({
	type: 'matte-sphere-card',
	size: 'small',
	schema,
	defaultData: { color: '#F5B8D0' },
	background: 'linear-gradient(135deg, #FFB6C1 0%, #FF7E8A 55%, #C24A6B 100%)',
	geometry: MatteSphereScene,
	provides: ['widget'],
});
