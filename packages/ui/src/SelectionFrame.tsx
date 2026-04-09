import { memo } from 'react';
import type { EntityId } from '@infinite-canvas/core';

interface SelectionFrameProps {
	entityId: EntityId;
}

/**
 * Renders the selection border and resize handles around a selected widget.
 * Positioned by the parent WidgetSlot — this just fills its bounds.
 */
export const SelectionFrame = memo(function SelectionFrame(_props: SelectionFrameProps) {
	const handleClass =
		'absolute h-2.5 w-2.5 rounded-sm border-2 border-blue-500 bg-white';

	return (
		<div className="pointer-events-none absolute inset-0">
			{/* Selection border */}
			<div className="absolute inset-0 rounded border-2 border-blue-500" />

			{/* Resize handles — pointer-events-auto so they're clickable */}
			{/* Corners */}
			<div
				className={`${handleClass} pointer-events-auto -left-1.5 -top-1.5 cursor-nw-resize`}
				data-handle="nw"
			/>
			<div
				className={`${handleClass} pointer-events-auto -right-1.5 -top-1.5 cursor-ne-resize`}
				data-handle="ne"
			/>
			<div
				className={`${handleClass} pointer-events-auto -bottom-1.5 -left-1.5 cursor-sw-resize`}
				data-handle="sw"
			/>
			<div
				className={`${handleClass} pointer-events-auto -bottom-1.5 -right-1.5 cursor-se-resize`}
				data-handle="se"
			/>
			{/* Edges */}
			<div
				className={`${handleClass} pointer-events-auto -top-1.5 left-1/2 -translate-x-1/2 cursor-n-resize`}
				data-handle="n"
			/>
			<div
				className={`${handleClass} pointer-events-auto -bottom-1.5 left-1/2 -translate-x-1/2 cursor-s-resize`}
				data-handle="s"
			/>
			<div
				className={`${handleClass} pointer-events-auto -left-1.5 top-1/2 -translate-y-1/2 cursor-w-resize`}
				data-handle="w"
			/>
			<div
				className={`${handleClass} pointer-events-auto -right-1.5 top-1/2 -translate-y-1/2 cursor-e-resize`}
				data-handle="e"
			/>
		</div>
	);
});
