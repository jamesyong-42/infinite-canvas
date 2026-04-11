import type { LayoutEngine, ProfilerStats } from '@jamesyong42/infinite-canvas';
import { Active, Selected } from '@jamesyong42/infinite-canvas';
import { useEffect, useState } from 'react';

interface InspectorPanelProps {
	engine: LayoutEngine;
	onClose: () => void;
}

interface Metrics {
	totalEntities: number;
	activeEntities: number;
	visibleEntities: number;
	selectedEntities: number;
	cameraX: number;
	cameraY: number;
	cameraZoom: number;
	navDepth: number;
	activeContainer: number | null;
	canUndo: boolean;
	canRedo: boolean;
	profilerEnabled: boolean;
	stats: ProfilerStats | null;
}

const sectionCls =
	'mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600';

export function InspectorPanel({ engine, onClose }: InspectorPanelProps) {
	const [metrics, setMetrics] = useState<Metrics>({
		totalEntities: 0,
		activeEntities: 0,
		visibleEntities: 0,
		selectedEntities: 0,
		cameraX: 0,
		cameraY: 0,
		cameraZoom: 1,
		navDepth: 0,
		activeContainer: null,
		canUndo: false,
		canRedo: false,
		profilerEnabled: false,
		stats: null,
	});

	useEffect(() => {
		const interval = setInterval(() => {
			const camera = engine.getCamera();
			const p = engine.profiler;
			setMetrics({
				totalEntities: engine.world.entityCount,
				activeEntities: engine.world.queryTagged(Active).length,
				visibleEntities: engine.getVisibleEntities().length,
				selectedEntities: engine.world.queryTagged(Selected).length,
				cameraX: camera.x,
				cameraY: camera.y,
				cameraZoom: camera.zoom,
				navDepth: engine.getNavigationDepth(),
				activeContainer: engine.getActiveContainer(),
				canUndo: engine.canUndo(),
				canRedo: engine.canRedo(),
				profilerEnabled: p.isEnabled(),
				stats: p.isEnabled() ? p.getStats() : null,
			});
		}, 200);

		return () => clearInterval(interval);
	}, [engine]);

	const row = (label: string, value: string | number) => (
		<div className="flex justify-between">
			<span className="text-neutral-400 dark:text-neutral-500">{label}</span>
			<span className="text-neutral-600 dark:text-neutral-300">{value}</span>
		</div>
	);

	const ms = (v: number) => (v < 0.01 ? '<0.01' : v.toFixed(2));
	const stats = metrics.stats;

	return (
		<div className="absolute bottom-14 right-4 z-50 w-64 max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-300">
			<div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
				<span className="font-semibold text-neutral-700 dark:text-neutral-200">Inspector</span>
				<button
					type="button"
					onClick={onClose}
					className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
				>
					x
				</button>
			</div>

			<div className="space-y-2 p-3">
				{/* ECS */}
				<div>
					<div className={sectionCls}>ECS</div>
					{row('entities', metrics.totalEntities)}
					{row('active', metrics.activeEntities)}
					{row('visible', metrics.visibleEntities)}
					{row('selected', metrics.selectedEntities)}
				</div>

				{/* Camera */}
				<div>
					<div className={sectionCls}>Camera</div>
					{row('x', metrics.cameraX.toFixed(1))}
					{row('y', metrics.cameraY.toFixed(1))}
					{row('zoom', metrics.cameraZoom.toFixed(3))}
				</div>

				{/* Navigation */}
				<div>
					<div className={sectionCls}>Navigation</div>
					{row('depth', metrics.navDepth)}
					{row(
						'container',
						metrics.activeContainer !== null ? `e${metrics.activeContainer}` : 'root',
					)}
				</div>

				{/* History */}
				<div>
					<div className={sectionCls}>History</div>
					{row('can undo', metrics.canUndo ? 'yes' : 'no')}
					{row('can redo', metrics.canRedo ? 'yes' : 'no')}
				</div>

				{/* Profiler toggle */}
				<div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
					<div className="flex items-center justify-between">
						<div className={sectionCls}>Performance</div>
						<button
							type="button"
							className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
								metrics.profilerEnabled
									? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
									: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
							}`}
							onClick={() => {
								const p = engine.profiler;
								p.setEnabled(!p.isEnabled());
								engine.markDirty();
							}}
						>
							{metrics.profilerEnabled ? 'ON' : 'OFF'}
						</button>
					</div>
					{row('world tick', engine.world.currentTick)}
				</div>

				{/* Profiler stats */}
				{stats && stats.sampleCount > 0 && (
					<>
						{/* Frame budget bar */}
						<div>
							<div className="flex justify-between mb-1">
								<span className="text-neutral-400 dark:text-neutral-500">budget (16.67ms)</span>
								<span
									className={`font-medium ${
										stats.budgetUsed < 50
											? 'text-green-600 dark:text-green-400'
											: stats.budgetUsed < 80
												? 'text-amber-600 dark:text-amber-400'
												: 'text-red-600 dark:text-red-400'
									}`}
								>
									{stats.budgetUsed.toFixed(1)}%
								</span>
							</div>
							<div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
								<div
									className={`h-full rounded-full transition-all ${
										stats.budgetUsed < 50
											? 'bg-green-500'
											: stats.budgetUsed < 80
												? 'bg-amber-500'
												: 'bg-red-500'
									}`}
									style={{ width: `${Math.min(100, stats.budgetUsed)}%` }}
								/>
							</div>
						</div>

						{/* Frame time */}
						<div>
							<div className={sectionCls}>Frame Time (ms)</div>
							{row('fps', stats.fps)}
							{row('avg', ms(stats.frameTime.avg))}
							{row('p50', ms(stats.frameTime.p50))}
							{row('p95', ms(stats.frameTime.p95))}
							{row('p99', ms(stats.frameTime.p99))}
							{row('max', ms(stats.frameTime.max))}
						</div>

						{/* Per-system timing */}
						{Object.keys(stats.systemAvg).length > 0 && (
							<div>
								<div className={sectionCls}>Systems (ms)</div>
								<div className="space-y-0.5">
									{Object.entries(stats.systemAvg)
										.sort((a, b) => b[1] - a[1])
										.map(([name, avg]) => (
											<div key={name} className="flex justify-between">
												<span className="text-neutral-400 dark:text-neutral-500 truncate mr-2">
													{name}
												</span>
												<span className="text-neutral-600 dark:text-neutral-300 shrink-0">
													{ms(avg)}{' '}
													<span className="text-neutral-300 dark:text-neutral-600">
														p95:{ms(stats.systemP95[name])}
													</span>
												</span>
											</div>
										))}
								</div>
							</div>
						)}

						{/* Samples */}
						{row('samples', stats.sampleCount)}
					</>
				)}

				{/* Shortcuts */}
				<div className="border-t border-neutral-100 pt-2 text-[9px] text-neutral-300 space-y-0.5 dark:border-neutral-700 dark:text-neutral-600">
					<div>Cmd+Z undo / Cmd+Shift+Z redo</div>
					<div>Esc exit container / Del delete</div>
				</div>
			</div>
		</div>
	);
}
