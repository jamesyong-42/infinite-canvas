import type { EntityId } from '@jamesyong42/reactive-ecs';
import { memo, useEffect, useRef } from 'react';
import { Transform2D, Widget } from '../../ecs/components.js';
import { useLayoutEngine } from '../context/engine-context.js';
import { useWidgetResolver } from '../context/widget-resolver-context.js';
import { useComponent } from '../hooks/ecs.js';

interface WidgetSlotProps {
	entityId: EntityId;
	slotRef: (entityId: EntityId, el: HTMLDivElement | null) => void;
}

/**
 * Wrapper for a DOM widget — owns the slot's positioning, registers its
 * ref with the rAF batcher, and renders the user's widget component.
 *
 * Pointer routing lives in the canvas-level `PointerEventBus` (RFC-006).
 * The slot does not call the engine; user widget React handlers run on
 * the natural DOM event path and bubble to the bus, which decides
 * whether to invoke engine semantics. Authors call `e.stopPropagation()`
 * from inside their widget to opt out of engine drag/select.
 */
export const WidgetSlot = memo(function WidgetSlot({ entityId, slotRef }: WidgetSlotProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const engine = useLayoutEngine();
	const resolve = useWidgetResolver();

	const widgetComp = useComponent(entityId, Widget);

	// DOM slot — only renders DOM widgets. R3F widgets go through R3FManager.
	const resolved = resolve?.(entityId, widgetComp?.type ?? '');
	const WidgetComponent = resolved && resolved.surface === 'dom' ? resolved.component : null;

	useEffect(() => {
		slotRef(entityId, wrapperRef.current);
		return () => slotRef(entityId, null);
	}, [entityId, slotRef]);

	// Read Transform2D at render time for initial inline position.
	// This ensures the div has the correct position on its very first paint —
	// no flash at (0,0). Subsequent updates come from the batch updater (rAF).
	const t = engine.get(entityId, Transform2D);
	const initialStyle: React.CSSProperties = t
		? {
				transform: `translate(${t.x}px, ${t.y}px)`,
				width: `${t.width}px`,
				height: `${t.height}px`,
			}
		: {};

	const content = WidgetComponent ? (
		<WidgetComponent entityId={entityId} />
	) : (
		<div className="h-full w-full rounded border border-dashed border-gray-300 bg-gray-50" />
	);

	return (
		<div
			ref={wrapperRef}
			data-widget-slot=""
			className="absolute left-0 top-0 origin-top-left will-change-transform"
			style={initialStyle}
		>
			{content}
		</div>
	);
});
