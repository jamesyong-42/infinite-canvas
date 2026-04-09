import { useState } from 'react';
import type { EntityId } from '@infinite-canvas/core';
import { useBreakpoint, useWidgetData, useIsSelected, useUpdateData } from '@infinite-canvas/react-widgets';
import { useComponent } from '@infinite-canvas/ui';
import { Transform2D } from '@infinite-canvas/core';

const COLOR = '#10b981';

export function DebugInteractive({ entityId }: { entityId: EntityId }) {
	const breakpoint = useBreakpoint(entityId);
	const data = useWidgetData(entityId);
	const isSelected = useIsSelected(entityId);
	const updateData = useUpdateData(entityId);
	const transform = useComponent(entityId, Transform2D);
	const [localCount, setLocalCount] = useState(0);

	const borderColor = isSelected ? '#059669' : COLOR;

	if (breakpoint === 'micro') {
		return (
			<div
				className="flex h-full w-full items-center justify-center font-mono text-[10px] font-bold"
				style={{ border: `2px solid ${COLOR}`, backgroundColor: `${COLOR}15`, color: COLOR }}
			>
				{localCount}
			</div>
		);
	}

	if (breakpoint === 'compact') {
		return (
			<div
				className="flex h-full w-full items-center gap-1 px-2 font-mono text-[10px]"
				style={{ border: `1.5px solid ${borderColor}`, backgroundColor: `${COLOR}08`, color: COLOR }}
			>
				<span className="truncate">{data.title ?? 'Interactive'}</span>
				<span className="ml-auto opacity-60">{localCount}</span>
			</div>
		);
	}

	return (
		<div
			className="flex h-full w-full flex-col font-mono text-[11px]"
			style={{ border: `1.5px solid ${borderColor}`, backgroundColor: `${COLOR}06` }}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-2 py-1"
				style={{ borderBottom: `1px solid ${COLOR}30`, backgroundColor: `${COLOR}10` }}
			>
				<span style={{ color: COLOR }} className="font-semibold truncate">
					{data.title ?? 'Interactive'}
				</span>
				<span className="text-[9px] text-neutral-400 dark:text-neutral-500">e{entityId}</span>
			</div>

			{/* Body */}
			<div className="flex-1 px-2 py-1.5 space-y-1">
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="rounded px-2 py-0.5 font-mono text-[10px] font-medium text-white transition-colors"
						style={{ backgroundColor: COLOR }}
						onMouseOver={(e) => { (e.target as HTMLElement).style.backgroundColor = '#059669'; }}
						onMouseOut={(e) => { (e.target as HTMLElement).style.backgroundColor = COLOR; }}
						onClick={(e) => {
							e.stopPropagation();
							setLocalCount((c) => c + 1);
						}}
					>
						click: {localCount}
					</button>
				</div>

				{(breakpoint === 'expanded' || breakpoint === 'detailed') && (
					<>
						<input
							type="text"
							className="w-full rounded border px-1.5 py-0.5 font-mono text-[10px] focus:outline-none"
							style={{ borderColor: `${COLOR}40`, backgroundColor: `${COLOR}05` }}
							placeholder="type here..."
							value={data.note ?? ''}
							onChange={(e) => updateData({ note: e.target.value })}
							onClick={(e) => e.stopPropagation()}
						/>
						<div className="text-neutral-400 space-y-0.5 dark:text-neutral-500">
							<div className="flex justify-between">
								<span>bp</span>
								<span style={{ color: COLOR }}>{breakpoint}</span>
							</div>
							{transform && (
								<div className="flex justify-between">
									<span>size</span>
									<span>{Math.round(transform.width)} x {Math.round(transform.height)}</span>
								</div>
							)}
							<div className="flex justify-between">
								<span>state</span>
								<span>clicks={localCount} selected={String(isSelected)}</span>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
