import type { Archetype, DomWidget, EntityId } from '@jamesyong42/infinite-canvas';
import {
	Children,
	Container,
	Transform2D,
	useBreakpoint,
	useChildren,
	useComponent,
	useIsSelected,
	useWidgetData,
} from '@jamesyong42/infinite-canvas';
import { z } from 'zod';

const COLOR = '#8b5cf6';

const schema = z.object({
	title: z.string().default('Container'),
});

export type DebugContainerData = z.infer<typeof schema>;

function DebugContainerView({ entityId }: { entityId: EntityId }) {
	const breakpoint = useBreakpoint(entityId);
	const data = useWidgetData<DebugContainerData>(entityId);
	const isSelected = useIsSelected(entityId);
	const children = useChildren(entityId);
	const transform = useComponent(entityId, Transform2D);

	const borderColor = isSelected ? '#7c3aed' : COLOR;

	if (breakpoint === 'micro') {
		return (
			<div
				className="flex h-full w-full items-center justify-center font-mono text-[10px] font-bold"
				style={{ border: `2px dashed ${COLOR}`, backgroundColor: `${COLOR}10`, color: COLOR }}
			>
				{children.length}
			</div>
		);
	}

	if (breakpoint === 'compact') {
		return (
			<div
				className="flex h-full w-full items-center gap-1 px-2 font-mono text-[10px]"
				style={{
					border: `1.5px dashed ${borderColor}`,
					backgroundColor: `${COLOR}06`,
					color: COLOR,
				}}
			>
				<span className="truncate">{data.title ?? 'Container'}</span>
				<span className="ml-auto opacity-60">[{children.length}]</span>
			</div>
		);
	}

	return (
		<div
			className="flex h-full w-full flex-col font-mono text-[11px]"
			style={{ border: `1.5px dashed ${borderColor}`, backgroundColor: `${COLOR}04` }}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-2 py-1"
				style={{ borderBottom: `1px dashed ${COLOR}25`, backgroundColor: `${COLOR}08` }}
			>
				<span style={{ color: COLOR }} className="font-semibold truncate">
					{data.title ?? 'Container'}
				</span>
				<span className="text-[9px] text-neutral-400 dark:text-neutral-500">
					e{entityId} [{children.length}]
				</span>
			</div>

			{/* Body */}
			<div className="flex-1 px-2 py-1.5 text-neutral-500 space-y-0.5 dark:text-neutral-400">
				<div className="flex justify-between">
					<span className="text-neutral-400">bp</span>
					<span style={{ color: COLOR }}>{breakpoint}</span>
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
				<div className="flex justify-between">
					<span className="text-neutral-400">children</span>
					<span>{children.map((c) => `e${c}`).join(', ') || 'none'}</span>
				</div>

				{(breakpoint === 'expanded' || breakpoint === 'detailed') && (
					<div
						className="mt-1 pt-1 text-[10px]"
						style={{ borderTop: `1px dashed ${COLOR}20`, color: `${COLOR}80` }}
					>
						double-click to enter
					</div>
				)}
			</div>
		</div>
	);
}

export const DebugContainer: DomWidget<DebugContainerData> = {
	type: 'debug-container',
	schema,
	defaultData: { title: 'Container' },
	defaultSize: { width: 400, height: 300 },
	component: DebugContainerView,
};

/**
 * Container archetype — bundles the view with Container + Children components
 * so `engine.spawn('debug-container', ...)` creates an enterable container
 * with no extra setup in app code.
 */
export const DebugContainerArchetype: Archetype = {
	id: 'debug-container',
	widget: 'debug-container',
	components: [
		[Container, { enterable: true }],
		[Children, { ids: [] as EntityId[] }],
	],
};
