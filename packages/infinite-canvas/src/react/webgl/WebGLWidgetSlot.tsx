import type { EntityId } from '@jamesyong42/reactive-ecs';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { WorldBounds } from '../../components.js';
import { useLayoutEngine } from '../context.js';
import { useComponent } from '../hooks.js';
import type { R3FWidgetProps } from '../registry.js';

interface WebGLWidgetSlotProps {
	entityId: EntityId;
	component: React.ComponentType<R3FWidgetProps>;
}

/**
 * Positions a Three.js Group at the entity's world-space center.
 * The widget component renders in local space: origin at center,
 * X right, Y up, dimensions = (width, height) in world units.
 */
export function WebGLWidgetSlot({ entityId, component: WidgetComponent }: WebGLWidgetSlotProps) {
	const groupRef = useRef<Group>(null);
	const engine = useLayoutEngine();

	// Read WorldBounds reactively for initial render
	const wb = useComponent(entityId, WorldBounds);

	// Update position every frame (camera may have moved)
	useFrame(() => {
		if (!groupRef.current) return;
		const bounds = engine.get(entityId, WorldBounds);
		if (!bounds) return;
		// Position at center of bounding box; flip Y for Three.js
		groupRef.current.position.set(
			bounds.worldX + bounds.worldWidth / 2,
			-(bounds.worldY + bounds.worldHeight / 2),
			0,
		);
	});

	if (!wb) return null;

	return (
		<group ref={groupRef}>
			<WidgetComponent entityId={entityId} width={wb.worldWidth} height={wb.worldHeight} />
		</group>
	);
}
