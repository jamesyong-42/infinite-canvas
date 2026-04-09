import { memo, useCallback, useEffect, useRef } from 'react';
import type { EntityId, Modifiers } from '@infinite-canvas/core';
import { Selected, WorldBounds } from '@infinite-canvas/core';
import { useEngine, useContainerRef } from './context.js';
import { useTag } from './hooks.js';
import { SelectionFrame } from './SelectionFrame.js';

interface SelectionOverlaySlotProps {
	entityId: EntityId;
	slotRef: (entityId: EntityId, el: HTMLDivElement | null) => void;
}

function getMods(e: React.PointerEvent): Modifiers {
	return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/**
 * DOM overlay for WebGL widgets — provides selection frame and pointer
 * interaction (select, drag, resize) without rendering widget content.
 */
export const SelectionOverlaySlot = memo(function SelectionOverlaySlot({ entityId, slotRef }: SelectionOverlaySlotProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const engine = useEngine();
	const containerRefObj = useContainerRef();
	const isSelected = useTag(entityId, Selected);

	useEffect(() => {
		slotRef(entityId, wrapperRef.current);
		return () => slotRef(entityId, null);
	}, [entityId, slotRef]);

	const toLocal = useCallback(
		(e: React.PointerEvent) => {
			const rect = containerRefObj?.current?.getBoundingClientRect();
			if (!rect) return { x: e.clientX, y: e.clientY };
			return { x: e.clientX - rect.left, y: e.clientY - rect.top };
		},
		[containerRefObj],
	);

	const capturedRef = useRef(false);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.stopPropagation();
			const { x, y } = toLocal(e);
			const directive = engine.handlePointerDown(x, y, e.button, getMods(e));
			if (directive.action === 'capture-resize' || directive.action === 'passthrough-track-drag') {
				wrapperRef.current?.setPointerCapture(e.pointerId);
			}
			if (directive.action === 'capture-resize') {
				e.preventDefault();
			}
		},
		[engine, toLocal],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const { x, y } = toLocal(e);
			const directive = engine.handlePointerMove(x, y, getMods(e));
			if (directive.action === 'capture-drag' && !capturedRef.current) {
				capturedRef.current = true;
				e.stopPropagation();
			}
		},
		[engine, toLocal],
	);

	const onPointerUp = useCallback(
		(e: React.PointerEvent) => {
			e.stopPropagation();
			capturedRef.current = false;
			if (wrapperRef.current?.hasPointerCapture(e.pointerId)) {
				wrapperRef.current.releasePointerCapture(e.pointerId);
			}
			engine.handlePointerUp();
		},
		[engine],
	);

	const onDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			engine.enterContainer(entityId);
		},
		[engine, entityId],
	);

	const wb = engine.get(entityId, WorldBounds);
	const initialStyle: React.CSSProperties = wb
		? {
				transform: `translate(${wb.worldX}px, ${wb.worldY}px)`,
				width: `${wb.worldWidth}px`,
				height: `${wb.worldHeight}px`,
			}
		: {};

	return (
		<div
			ref={wrapperRef}
			className="absolute left-0 top-0 origin-top-left will-change-transform"
			style={initialStyle}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onDoubleClick={onDoubleClick}
		>
			{isSelected && <SelectionFrame entityId={entityId} />}
		</div>
	);
});
