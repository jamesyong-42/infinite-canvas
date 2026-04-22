import { createContext, useContext } from 'react';
import type { LayoutEngine } from '../../ecs/engine/index.js';

const EngineContext = createContext<LayoutEngine | null>(null);

export const EngineProvider = EngineContext.Provider;

/**
 * Returns the LayoutEngine instance from the nearest InfiniteCanvas context.
 * Throws if used outside an InfiniteCanvas provider.
 */
export function useLayoutEngine(): LayoutEngine {
	const engine = useContext(EngineContext);
	if (!engine) {
		throw new Error('useLayoutEngine must be used within an <InfiniteCanvas>');
	}
	return engine;
}
