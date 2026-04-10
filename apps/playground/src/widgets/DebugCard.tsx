import type { EntityId } from '@jamesyong42/infinite-canvas';
import {
	Transform2D,
	useBreakpoint,
	useComponent,
	useIsSelected,
	useWidgetData,
} from '@jamesyong42/infinite-canvas';

export function DebugCard({ entityId }: { entityId: EntityId }) {
	const breakpoint = useBreakpoint(entityId);
	const data = useWidgetData(entityId);
	const isSelected = useIsSelected(entityId);
	const transform = useComponent(entityId, Transform2D);

	const color = data.color ?? '#3b82f6';
	const borderColor = isSelected ? '#2563eb' : color;

	if (breakpoint === 'micro') {
		return (
			<div
				className="h-full w-full"
				style={{ border: `2px solid ${color}`, backgroundColor: `${color}20` }}
			/>
		);
	}

	if (breakpoint === 'compact') {
		return (
			<div
				className="flex h-full w-full items-center px-2 font-mono text-[10px]"
				style={{
					border: `1.5px solid ${borderColor}`,
					backgroundColor: `${color}08`,
					color: color,
				}}
			>
				<span className="truncate">{data.title ?? `e${entityId}`}</span>
			</div>
		);
	}

	return (
		<div
			className="flex h-full w-full flex-col font-mono text-[11px]"
			style={{
				border: `1.5px solid ${borderColor}`,
				backgroundColor: `${color}06`,
			}}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-2 py-1"
				style={{
					borderBottom: `1px solid ${color}30`,
					backgroundColor: `${color}10`,
				}}
			>
				<span style={{ color }} className="font-semibold truncate">
					{data.title ?? 'Card'}
				</span>
				<span className="text-[9px] text-neutral-400 dark:text-neutral-500">e{entityId}</span>
			</div>

			{/* Body */}
			<div className="flex-1 px-2 py-1.5 text-neutral-500 space-y-0.5 dark:text-neutral-400">
				<div className="flex justify-between">
					<span className="text-neutral-400">bp</span>
					<span style={{ color }}>{breakpoint}</span>
				</div>
				{transform && (
					<>
						<div className="flex justify-between">
							<span className="text-neutral-400">pos</span>
							<span>
								{Math.round(transform.x)}, {Math.round(transform.y)}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-neutral-400">size</span>
							<span>
								{Math.round(transform.width)} x {Math.round(transform.height)}
							</span>
						</div>
					</>
				)}
				{breakpoint === 'expanded' || breakpoint === 'detailed' ? (
					<>
						<div className="flex justify-between">
							<span className="text-neutral-400">selected</span>
							<span>{isSelected ? 'true' : 'false'}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-neutral-400">type</span>
							<span>debug-card</span>
						</div>
						{data.description && (
							<div
								className="mt-1 pt-1 text-neutral-400"
								style={{ borderTop: `1px dashed ${color}20` }}
							>
								{data.description}
							</div>
						)}
					</>
				) : null}
			</div>
		</div>
	);
}
