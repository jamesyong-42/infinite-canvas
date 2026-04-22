import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { LayoutEngine } from '../ecs/engine/index.js';

/**
 * Subscribes to engine frame events and invalidates the R3F canvas only when
 * something has changed that affects R3F output. With `frameloop="demand"` on
 * the parent `<Canvas>`, the canvas only renders in response to these
 * invalidations — idle scenes produce zero R3F frames.
 *
 * Triggers invalidation on: camera change, position change (drag/resize),
 * widgets entering or exiting the visible set.
 */
export function EngineInvalidator({ engine }: { engine: LayoutEngine }) {
	const invalidate = useThree((s) => s.invalidate);

	useEffect(() => {
		return engine.onFrame(() => {
			const c = engine.getFrameChanges();
			if (
				c.cameraChanged ||
				c.positionsChanged.length > 0 ||
				c.entered.length > 0 ||
				c.exited.length > 0
			) {
				invalidate();
			}
		});
	}, [engine, invalidate]);

	return null;
}
