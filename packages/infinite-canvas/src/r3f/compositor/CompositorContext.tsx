import type { EntityId } from '@jamesyong42/reactive-ecs';
import { createContext, useContext } from 'react';
import type { OrthographicCamera, Scene } from 'three';
import type { WidgetRenderTargetPool } from './WidgetRenderTargetPool.js';

/**
 * Per-widget registration entry the Compositor needs in order to paint
 * the widget's scene into its FBO each frame.
 */
export type CompositorWidgetEntry = {
	scene: Scene;
	camera: OrthographicCamera;
	/**
	 * Bumped by the widget when its content has changed and needs a repaint.
	 * Compared against fboGeneration in R3FRenderState.
	 */
	requestRepaint: () => void;
};

export type CompositorContextValue = {
	pool: WidgetRenderTargetPool;
	register: (entityId: EntityId, entry: CompositorWidgetEntry) => () => void;
};

export const CompositorContext = createContext<CompositorContextValue | null>(null);

export function useCompositor(): CompositorContextValue {
	const ctx = useContext(CompositorContext);
	if (!ctx) {
		throw new Error('useCompositor must be used inside <Compositor>');
	}
	return ctx;
}
