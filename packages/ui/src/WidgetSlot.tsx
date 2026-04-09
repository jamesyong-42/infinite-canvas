import { memo, useCallback, useEffect, useRef } from 'react';
import type { EntityId, Modifiers } from '@infinite-canvas/core';
import { Widget, WorldBounds } from '@infinite-canvas/core';
import { useEngine, useWidgetResolver, useContainerRef } from './context.js';
import { useComponent } from './hooks.js';

interface WidgetSlotProps {
	entityId: EntityId;
	slotRef: (entityId: EntityId, el: HTMLDivElement | null) => void;
}

function getMods(e: React.PointerEvent): Modifiers {
	return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

export const WidgetSlot = memo(function WidgetSlot({ entityId, slotRef }: WidgetSlotProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const engine = useEngine();
	const containerRefObj = useContainerRef();
	const resolve = useWidgetResolver();

	const widgetComp = useComponent(entityId, Widget);

	const resolved = resolve?.(entityId, widgetComp?.type ?? '');
	const WidgetComponent = resolved?.component ?? null;

	// Register wrapper ref with the batch updater
	useEffect(() => {
		slotRef(entityId, wrapperRef.current);
		return () => slotRef(entityId, null);
	}, [entityId, slotRef]);

	// Convert clientX/Y to container-relative coords
	const toLocal = useCallback(
		(e: React.PointerEvent): { x: number; y: number } => {
			const rect = containerRefObj?.current?.getBoundingClientRect();
			if (!rect) return { x: e.clientX, y: e.clientY };
			return { x: e.clientX - rect.left, y: e.clientY - rect.top };
		},
		[containerRefObj],
	);

	// Fix #3: Capture pointer immediately on pointerdown for any widget interaction.
	// This ensures we always get pointerup even if the cursor leaves the window.
	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			// Don't intercept clicks on interactive elements inside widgets
			const target = e.target as HTMLElement;
			if (target.closest('button, input, textarea, select, [contenteditable]')) {
				e.stopPropagation(); // still prevent background handler
				return;
			}

			const { x, y } = toLocal(e);
			const directive = engine.handlePointerDown(x, y, e.button, getMods(e));

			// Always stop propagation — prevent background handler from double-processing
			e.stopPropagation();

			if (directive.action === 'capture-resize' || directive.action === 'passthrough-track-drag') {
				// Capture pointer for both resize AND tracking (so we get pointerup reliably)
				wrapperRef.current?.setPointerCapture(e.pointerId);
			}
			if (directive.action === 'capture-resize') {
				e.preventDefault();
			}
		},
		[engine, toLocal],
	);

	const capturedRef = useRef(false);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const { x, y } = toLocal(e);
			const directive = engine.handlePointerMove(x, y, getMods(e));

			// Fix #3: Only call setPointerCapture once when drag starts (not every move)
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
			// Release pointer capture (browser does this automatically, but be explicit)
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

	// Read WorldBounds at render time for initial inline position.
	// This ensures the div has the correct position on its very first paint —
	// no flash at (0,0). Subsequent updates come from the batch updater (rAF).
	const wb = engine.get(entityId, WorldBounds);
	const initialStyle: React.CSSProperties = wb
		? {
				transform: `translate(${wb.worldX}px, ${wb.worldY}px)`,
				width: `${wb.worldWidth}px`,
				height: `${wb.worldHeight}px`,
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
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onDoubleClick={onDoubleClick}
		>
			{content}
		</div>
	);
});
