import type { EntityId } from '@jamesyong42/reactive-ecs';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Dragging, Widget, WorldBounds } from '../../ecs/components.js';
import type { Modifiers } from '../../ecs/engine/index.js';
import { useContainerRef } from '../context/container-ref-context.js';
import { useLayoutEngine } from '../context/engine-context.js';
import { useWidgetResolver } from '../context/widget-resolver-context.js';
import { useTag } from '../hooks/ecs.js';
import { CardChrome } from '../widgets/CardChrome.js';
import type { R3FChromeConfig } from '../widgets/registry.js';

interface SelectionOverlaySlotProps {
	entityId: EntityId;
	slotRef: (entityId: EntityId, el: HTMLDivElement | null) => void;
}

function resolveChrome(chrome: R3FChromeConfig | undefined): {
	background: string;
	radius: number;
} | null {
	if (chrome === 'none') return null;
	if (!chrome || chrome === 'card') return { background: '#1c1c1e', radius: 21.67 };
	return { background: chrome.background ?? '#1c1c1e', radius: chrome.radius ?? 21.67 };
}

function getMods(e: React.PointerEvent): Modifiers {
	return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/**
 * DOM overlay for R3F widgets — provides selection frame and pointer
 * interaction (select, drag, resize) without rendering widget content.
 */
export const SelectionOverlaySlot = memo(function SelectionOverlaySlot({
	entityId,
	slotRef,
}: SelectionOverlaySlotProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const engine = useLayoutEngine();
	const containerRefObj = useContainerRef();
	const resolver = useWidgetResolver();
	const dragging = useTag(entityId, Dragging);

	const widgetType = engine.get(entityId, Widget)?.type ?? '';
	const resolved = resolver?.(entityId, widgetType);
	const chromeConfig =
		resolved && resolved.surface === 'webgl' ? resolveChrome(resolved.chrome) : null;

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
			data-widget-slot=""
			style={initialStyle}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onDoubleClick={onDoubleClick}
		>
			{chromeConfig && (
				<CardChrome
					lifted={dragging}
					radius={chromeConfig.radius}
					background={chromeConfig.background}
				/>
			)}
		</div>
	);
});
