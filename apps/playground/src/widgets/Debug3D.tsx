import type { EntityId, R3FWidget } from '@jamesyong42/infinite-canvas';
import { useIsSelected, useWidgetData } from '@jamesyong42/infinite-canvas';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { z } from 'zod';

const schema = z.object({
	title: z.string().default('3D'),
	color: z.string().default('#3b82f6'),
});

export type Debug3DData = z.infer<typeof schema>;

function Debug3DView({
	entityId,
	width,
	height,
}: {
	entityId: EntityId;
	width: number;
	height: number;
}) {
	const groupRef = useRef<Mesh>(null);
	const data = useWidgetData<Debug3DData>(entityId);
	const isSelected = useIsSelected(entityId);

	const color = data.color ?? '#3b82f6';
	const size = Math.min(width, height) * 0.4;

	// Slow rotation on the inner group
	useFrame((_state, delta) => {
		if (groupRef.current) {
			groupRef.current.rotation.y += delta * 0.5;
			groupRef.current.rotation.x += delta * 0.3;
		}
	});

	return (
		<group>
			{/* Background plane */}
			<mesh position={[0, 0, -1]}>
				<planeGeometry args={[width, height]} />
				<meshBasicMaterial color={isSelected ? '#1e3a5f' : '#0a0a0a'} transparent opacity={0.3} />
			</mesh>

			{/* Wireframe border */}
			<mesh position={[0, 0, -0.5]}>
				<planeGeometry args={[width, height]} />
				<meshBasicMaterial color={isSelected ? '#2563eb' : '#444'} wireframe />
			</mesh>

			{/* Spinning cube */}
			<group ref={groupRef}>
				<mesh>
					<boxGeometry args={[size, size, size]} />
					<meshBasicMaterial color={color} wireframe />
				</mesh>
				<mesh>
					<boxGeometry args={[size * 0.98, size * 0.98, size * 0.98]} />
					<meshBasicMaterial color={color} transparent opacity={0.15} />
				</mesh>
			</group>
		</group>
	);
}

export const Debug3D: R3FWidget<Debug3DData> = {
	type: 'debug-3d',
	surface: 'webgl',
	schema,
	defaultData: { title: '3D', color: '#3b82f6' },
	defaultSize: { width: 250, height: 250 },
	component: Debug3DView,
};
