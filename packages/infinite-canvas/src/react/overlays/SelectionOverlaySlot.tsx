import type { EntityId } from '@jamesyong42/reactive-ecs';
import { memo, useEffect, useRef } from 'react';
import {
	Card,
	CardOverlapHotPoint,
	Dragging,
	OverlapCandidate,
	OverlapTarget,
	Transform2D,
} from '../../ecs/components.js';
import { useLayoutEngine } from '../context/engine-context.js';
import { useComponent, useTag } from '../hooks/ecs.js';
import { CardChrome } from '../widgets/CardChrome.js';

interface SelectionOverlaySlotProps {
	entityId: EntityId;
	slotRef: (entityId: EntityId, el: HTMLDivElement | null) => void;
}

/**
 * DOM chrome overlay for R3F widgets — renders the selection frame /
 * card decoration and positions itself at the widget's world AABB.
 *
 * Decoration only. Pointer events bypass this wrapper
 * (`pointer-events: none`) so they reach the R3F canvas underneath,
 * where the `EventRouter` raycasts the widget's local scene (RFC-006).
 * Engine semantics — drag, select, resize, double-click — are dispatched
 * by the canvas-level `PointerEventBus` after the widget's R3F handlers
 * have had a chance to call `event.stopPropagation()`.
 */
export const SelectionOverlaySlot = memo(function SelectionOverlaySlot({
	entityId,
	slotRef,
}: SelectionOverlaySlotProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const engine = useLayoutEngine();
	const dragging = useTag(entityId, Dragging);
	// Card presence + data drives DOM CardChrome. Subscribed reactively
	// so adding/removing/editing Card at runtime updates the slot
	// without a refresh.
	const card = useComponent(entityId, Card);
	// RFC-004 § Phase 3 — overlap state drives the two-layer glow.
	const overlapCandidate = useTag(entityId, OverlapCandidate);
	const overlapTarget = useTag(entityId, OverlapTarget);
	const hot = useComponent(entityId, CardOverlapHotPoint);

	useEffect(() => {
		slotRef(entityId, wrapperRef.current);
		return () => slotRef(entityId, null);
	}, [entityId, slotRef]);

	const t = engine.get(entityId, Transform2D);
	const initialStyle: React.CSSProperties = t
		? {
				transform: `translate(${t.x}px, ${t.y}px)`,
				width: `${t.width}px`,
				height: `${t.height}px`,
			}
		: {};

	return (
		<div
			ref={wrapperRef}
			className="pointer-events-none absolute left-0 top-0 origin-top-left will-change-transform"
			data-widget-slot=""
			style={initialStyle}
		>
			{card && (
				<CardChrome
					lifted={dragging}
					background={card.background}
					overlapCandidate={overlapCandidate}
					overlapTarget={overlapTarget}
					hotX={hot?.x}
					hotY={hot?.y}
					hotStrength={hot?.strength}
				/>
			)}
		</div>
	);
});
