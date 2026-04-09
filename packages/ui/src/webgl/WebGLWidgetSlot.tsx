import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { EntityId } from '@infinite-canvas/core';
import { WorldBounds } from '@infinite-canvas/core';
import { useEngine } from '../context.js';
import { useComponent } from '../hooks.js';

interface WebGLWidgetSlotProps {
	entityId: EntityId;
	component: React.ComponentType<{ entityId: EntityId; width: number; height: number }>;
}

/**
 * Positions a Three.js Group at the entity's world-space center.
 * The widget component renders in local space: origin at center,
 * X right, Y up, dimensions = (width, height) in world units.
 */
export function WebGLWidgetSlot({ entityId, component: WidgetComponent }: WebGLWidgetSlotProps) {
	const groupRef = useRef<Group>(null);
	const engine = useEngine();

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
			<WidgetComponent
				entityId={entityId}
				width={wb.worldWidth}
				height={wb.worldHeight}
			/>
		</group>
	);
}
