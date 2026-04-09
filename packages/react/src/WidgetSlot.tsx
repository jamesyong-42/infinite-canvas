import { memo, useCallback, useEffect, useRef } from 'react';
import type { EntityId, Modifiers } from '@infinite-canvas/core';
import { Widget, Selected } from '@infinite-canvas/core';
import { useEngine, useWidgetResolver } from './context.js';
import { useComponent, useTag } from './hooks.js';
import { SelectionFrame } from './SelectionFrame.js';

interface WidgetSlotProps {
	entityId: EntityId;
	/** Called by the batch updater to set the ref for imperative positioning */
	slotRef: (entityId: EntityId, el: HTMLDivElement | null) => void;
}

function getMods(e: React.PointerEvent): Modifiers {
	return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

export const WidgetSlot = memo(function WidgetSlot({ entityId, slotRef }: WidgetSlotProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const engine = useEngine();
	const resolve = useWidgetResolver();

	const widgetComp = useComponent(entityId, Widget);
	const isSelected = useTag(entityId, Selected);

	const WidgetComponent = resolve?.(entityId, widgetComp?.type ?? '');

	// Register wrapper ref with the batch updater
	useEffect(() => {
		slotRef(entityId, wrapperRef.current);
		return () => slotRef(entityId, null);
	}, [entityId, slotRef]);

	// Pointer routing — ask engine what to do
	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			const directive = engine.handlePointerDown(e.clientX, e.clientY, e.button, getMods(e));
			if (directive.action === 'capture-resize' || directive.action === 'capture-marquee') {
				e.stopPropagation();
				e.preventDefault();
				wrapperRef.current?.setPointerCapture(e.pointerId);
			}
			// passthrough-track-drag: widget gets the click, engine watches for drag
		},
		[engine],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const directive = engine.handlePointerMove(e.clientX, e.clientY, getMods(e));
			if (directive.action === 'capture-drag') {
				wrapperRef.current?.setPointerCapture(e.pointerId);
				e.stopPropagation();
			}
		},
		[engine],
	);

	const onPointerUp = useCallback(
		(_e: React.PointerEvent) => {
			engine.handlePointerUp();
		},
		[engine],
	);

	// Double-click to enter container
	const onDoubleClick = useCallback(() => {
		engine.enterContainer(entityId);
	}, [engine, entityId]);

	if (!WidgetComponent) {
		// No resolver or unknown widget type — render a placeholder
		return (
			<div
				ref={wrapperRef}
				className="absolute left-0 top-0 origin-top-left will-change-transform"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onDoubleClick={onDoubleClick}
			>
				<div className="h-full w-full rounded border border-dashed border-gray-300 bg-gray-50" />
				{isSelected && <SelectionFrame entityId={entityId} />}
			</div>
		);
	}

	return (
		<div
			ref={wrapperRef}
			className="absolute left-0 top-0 origin-top-left will-change-transform"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onDoubleClick={onDoubleClick}
		>
			<WidgetComponent entityId={entityId} />
			{isSelected && <SelectionFrame entityId={entityId} />}
		</div>
	);
});
