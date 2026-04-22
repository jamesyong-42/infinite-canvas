import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import { createGeometryCardWidget } from '@jamesyong42/infinite-canvas';
import { Environment } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { z } from 'zod';

const schema = z.object({
	/** Material: 'gold' | 'chrome' | 'copper'. */
	metal: z.enum(['gold', 'chrome', 'copper']).default('gold'),
});
type GoldKnotData = z.infer<typeof schema>;

const METALS: Record<GoldKnotData['metal'], { color: string; roughness: number }> = {
	gold: { color: '#F5CE6E', roughness: 0.12 },
	chrome: { color: '#E8E8EE', roughness: 0.05 },
	copper: { color: '#D97B46', roughness: 0.18 },
};

function GoldKnotScene({ data, width, height }: GeometryCardRenderProps<GoldKnotData>) {
	const meshRef = useRef<Mesh>(null);
	const size = Math.min(width, height);
	const metal = METALS[data.metal];

	useFrame((state, dt) => {
		if (!meshRef.current) return;
		meshRef.current.rotation.y += dt * 0.4;
		meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.2;
	});

	return (
		<group>
			{/*
			 * NB: drei's Environment sets scene.environment globally, so this
			 * IBL affects every other R3F widget in the canvas as a side effect.
			 * Acceptable: it makes other PBR widgets look a little nicer too.
			 */}
			<Environment preset="apartment" />
			<ambientLight intensity={0.15} />
			<mesh ref={meshRef} position={[0, 0, 6]}>
				<torusKnotGeometry args={[size * 0.18, size * 0.055, 220, 40]} />
				<meshPhysicalMaterial
					color={metal.color}
					roughness={metal.roughness}
					metalness={1}
					clearcoat={0.8}
					clearcoatRoughness={0.05}
					envMapIntensity={1.4}
				/>
			</mesh>
		</group>
	);
}

export const GoldKnotCard = createGeometryCardWidget<GoldKnotData>({
	type: 'gold-knot-card',
	size: 'large',
	schema,
	defaultData: { metal: 'gold' },
	background: { color: '#14101A', roughness: 0.4, metalness: 0.2 },
	geometry: GoldKnotScene,
});
