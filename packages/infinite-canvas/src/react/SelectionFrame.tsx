import { memo } from 'react';
import type { EntityId } from '../ecs/types.js';
import { HANDLE_VISUAL_SIZE_PX } from '../interaction-constants.js';

interface SelectionFrameProps {
	entityId: EntityId;
}

/**
 * Renders the selection border and resize handles around a selected widget.
 * Positioned by the parent WidgetSlot — this just fills its bounds.
 */
export const SelectionFrame = memo(function SelectionFrame(_props: SelectionFrameProps) {
	// Handle size and offset derived from the shared interaction constants so
	// this DOM renderer stays in lock-step with the WebGL SelectionRenderer.
	const size = `${HANDLE_VISUAL_SIZE_PX}px`;
	const offset = `${HANDLE_VISUAL_SIZE_PX / -2}px`;

	const handleStyle = { width: size, height: size } as const;
	const handleClass = 'absolute rounded-sm border-2 border-blue-500 bg-white';

	return (
		<div className="pointer-events-none absolute inset-0">
			{/* Selection border */}
			<div className="absolute inset-0 rounded border-2 border-blue-500" />

			{/* Resize handles — pointer-events-auto so they're clickable */}
			{/* Corners */}
			<div
				className={`${handleClass} pointer-events-auto cursor-nw-resize`}
				style={{ ...handleStyle, left: offset, top: offset }}
				data-handle="nw"
			/>
			<div
				className={`${handleClass} pointer-events-auto cursor-ne-resize`}
				style={{ ...handleStyle, right: offset, top: offset }}
				data-handle="ne"
			/>
			<div
				className={`${handleClass} pointer-events-auto cursor-sw-resize`}
				style={{ ...handleStyle, bottom: offset, left: offset }}
				data-handle="sw"
			/>
			<div
				className={`${handleClass} pointer-events-auto cursor-se-resize`}
				style={{ ...handleStyle, bottom: offset, right: offset }}
				data-handle="se"
			/>
			{/* Edges */}
			<div
				className={`${handleClass} pointer-events-auto left-1/2 -translate-x-1/2 cursor-n-resize`}
				style={{ ...handleStyle, top: offset }}
				data-handle="n"
			/>
			<div
				className={`${handleClass} pointer-events-auto left-1/2 -translate-x-1/2 cursor-s-resize`}
				style={{ ...handleStyle, bottom: offset }}
				data-handle="s"
			/>
			<div
				className={`${handleClass} pointer-events-auto top-1/2 -translate-y-1/2 cursor-w-resize`}
				style={{ ...handleStyle, left: offset }}
				data-handle="w"
			/>
			<div
				className={`${handleClass} pointer-events-auto top-1/2 -translate-y-1/2 cursor-e-resize`}
				style={{ ...handleStyle, right: offset }}
				data-handle="e"
			/>
		</div>
	);
});
