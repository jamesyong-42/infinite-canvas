import type { GridConfig, LayoutEngine } from '@jamesyong42/infinite-canvas';
import {
	BreakpointConfigResource,
	Draggable,
	Resizable,
	Selectable,
	Transform2D,
	Widget,
	WidgetData,
	ZIndex,
	ZoomConfigResource,
} from '@jamesyong42/infinite-canvas';
import { useState } from 'react';

interface SettingsPanelProps {
	engine: LayoutEngine;
	gridConfig: GridConfig;
	onGridChange: (config: GridConfig) => void;
	onClose: () => void;
}

const inputCls =
	'w-full rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-right dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200';
const labelCls = 'text-neutral-400 dark:text-neutral-500';
const sectionCls = 'mb-1 text-neutral-400 dark:text-neutral-500';
const borderCls = 'border-t border-neutral-100 pt-2 dark:border-neutral-700';
const btnCls =
	'flex-1 rounded bg-neutral-100 py-1 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700';

export function SettingsPanel({ engine, gridConfig, onGridChange, onClose }: SettingsPanelProps) {
	const zoomConfig = engine.world.getResource(ZoomConfigResource);
	const bpConfig = engine.world.getResource(BreakpointConfigResource);

	const [minZoom, setMinZoom] = useState(zoomConfig.min);
	const [maxZoom, setMaxZoom] = useState(zoomConfig.max);
	const [bpMicro, setBpMicro] = useState(bpConfig.micro);
	const [bpCompact, setBpCompact] = useState(bpConfig.compact);
	const [bpNormal, setBpNormal] = useState(bpConfig.normal);
	const [bpExpanded, setBpExpanded] = useState(bpConfig.expanded);

	const applyEngine = () => {
		engine.world.setResource(ZoomConfigResource, { min: minZoom, max: maxZoom });
		engine.world.setResource(BreakpointConfigResource, {
			micro: bpMicro,
			compact: bpCompact,
			normal: bpNormal,
			expanded: bpExpanded,
		});
		engine.markDirty();
	};

	// Helper to update a grid field
	function setGrid<K extends keyof GridConfig>(key: K, value: GridConfig[K]) {
		onGridChange({ ...gridConfig, [key]: value });
	}

	// Helper to update one element of a tuple field
	function setGridTuple<K extends keyof GridConfig>(key: K, index: number, value: number) {
		const arr = [...(gridConfig[key] as number[])];
		arr[index] = value;
		onGridChange({ ...gridConfig, [key]: arr });
	}

	return (
		<div className="absolute bottom-14 left-4 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-300">
			<div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
				<span className="font-semibold text-neutral-700 dark:text-neutral-200">Settings</span>
				<button
					type="button"
					onClick={onClose}
					className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
				>
					x
				</button>
			</div>

			<div className="space-y-3 p-3">
				{/* Zoom limits */}
				<div>
					<div className={sectionCls}>Zoom Range</div>
					<div className="flex gap-2">
						<label className="flex flex-1 items-center gap-1">
							<span className={labelCls}>min</span>
							<input
								type="number"
								step="0.01"
								className={inputCls}
								value={minZoom}
								onChange={(e) => setMinZoom(Number(e.target.value))}
								onBlur={applyEngine}
							/>
						</label>
						<label className="flex flex-1 items-center gap-1">
							<span className={labelCls}>max</span>
							<input
								type="number"
								step="0.1"
								className={inputCls}
								value={maxZoom}
								onChange={(e) => setMaxZoom(Number(e.target.value))}
								onBlur={applyEngine}
							/>
						</label>
					</div>
				</div>

				{/* Breakpoint thresholds */}
				<div>
					<div className={sectionCls}>Breakpoint Thresholds (screen px)</div>
					<div className="grid grid-cols-2 gap-1.5">
						{(
							[
								['micro', bpMicro, setBpMicro],
								['compact', bpCompact, setBpCompact],
								['normal', bpNormal, setBpNormal],
								['expanded', bpExpanded, setBpExpanded],
							] as const
						).map(([label, val, set]) => (
							<label key={label} className="flex items-center gap-1">
								<span className={`w-14 ${labelCls}`}>{label}</span>
								<input
									type="number"
									className={inputCls}
									value={val}
									onChange={(e) => (set as (v: number) => void)(Number(e.target.value))}
									onBlur={applyEngine}
								/>
							</label>
						))}
					</div>
				</div>

				{/* Grid: Spacings */}
				<div className={borderCls}>
					<div className={sectionCls}>Grid Spacings (world px)</div>
					<div className="flex gap-1.5">
						{(['fine', 'medium', 'coarse'] as const).map((label, i) => (
							<label key={label} className="flex flex-1 flex-col items-center gap-0.5">
								<span className={labelCls}>{label}</span>
								<input
									type="number"
									step="1"
									className={inputCls}
									value={gridConfig.spacings[i]}
									onChange={(e) => setGridTuple('spacings', i, Number(e.target.value))}
								/>
							</label>
						))}
					</div>
				</div>

				{/* Grid: Dot Appearance */}
				<div>
					<div className={sectionCls}>Dot Appearance</div>
					<div className="grid grid-cols-2 gap-1.5">
						<label className="flex items-center gap-1">
							<span className={`w-10 ${labelCls}`}>alpha</span>
							<input
								type="number"
								step="0.01"
								min="0"
								max="1"
								className={inputCls}
								value={gridConfig.dotAlpha}
								onChange={(e) => setGrid('dotAlpha', Number(e.target.value))}
							/>
						</label>
						<label className="flex items-center gap-1">
							<span className={`w-10 ${labelCls}`}>r min</span>
							<input
								type="number"
								step="0.1"
								className={inputCls}
								value={gridConfig.dotRadius[0]}
								onChange={(e) => setGridTuple('dotRadius', 0, Number(e.target.value))}
							/>
						</label>
						<label className="flex items-center gap-1">
							<span className={`w-10 ${labelCls}`}>r max</span>
							<input
								type="number"
								step="0.1"
								className={inputCls}
								value={gridConfig.dotRadius[1]}
								onChange={(e) => setGridTuple('dotRadius', 1, Number(e.target.value))}
							/>
						</label>
					</div>
				</div>

				{/* Grid: Fade Curve */}
				<div>
					<div className={sectionCls}>Fade Curve (CSS px)</div>
					<div className="grid grid-cols-2 gap-1.5">
						<label className="flex items-center gap-1">
							<span className={`w-12 ${labelCls}`}>in start</span>
							<input
								type="number"
								step="1"
								className={inputCls}
								value={gridConfig.fadeIn[0]}
								onChange={(e) => setGridTuple('fadeIn', 0, Number(e.target.value))}
							/>
						</label>
						<label className="flex items-center gap-1">
							<span className={`w-12 ${labelCls}`}>in end</span>
							<input
								type="number"
								step="1"
								className={inputCls}
								value={gridConfig.fadeIn[1]}
								onChange={(e) => setGridTuple('fadeIn', 1, Number(e.target.value))}
							/>
						</label>
						<label className="flex items-center gap-1">
							<span className={`w-12 ${labelCls}`}>out start</span>
							<input
								type="number"
								step="10"
								className={inputCls}
								value={gridConfig.fadeOut[0]}
								onChange={(e) => setGridTuple('fadeOut', 0, Number(e.target.value))}
							/>
						</label>
						<label className="flex items-center gap-1">
							<span className={`w-12 ${labelCls}`}>out end</span>
							<input
								type="number"
								step="10"
								className={inputCls}
								value={gridConfig.fadeOut[1]}
								onChange={(e) => setGridTuple('fadeOut', 1, Number(e.target.value))}
							/>
						</label>
					</div>
				</div>

				{/* Grid: Level Weights */}
				<div>
					<div className={sectionCls}>Level Weight</div>
					<div className="flex gap-2">
						<label className="flex flex-1 items-center gap-1">
							<span className={labelCls}>base</span>
							<input
								type="number"
								step="0.1"
								className={inputCls}
								value={gridConfig.levelWeight[0]}
								onChange={(e) => setGridTuple('levelWeight', 0, Number(e.target.value))}
							/>
						</label>
						<label className="flex flex-1 items-center gap-1">
							<span className={labelCls}>step</span>
							<input
								type="number"
								step="0.1"
								className={inputCls}
								value={gridConfig.levelWeight[1]}
								onChange={(e) => setGridTuple('levelWeight', 1, Number(e.target.value))}
							/>
						</label>
					</div>
				</div>

				{/* Actions */}
				<div className={`flex gap-2 ${borderCls}`}>
					<button
						type="button"
						className={btnCls}
						onClick={() => {
							engine.zoomToFit();
							engine.markDirty();
						}}
					>
						Zoom to Fit
					</button>
					<button
						type="button"
						className={btnCls}
						onClick={() => {
							if (engine.getNavigationDepth() > 0) {
								engine.exitContainer();
								engine.markDirty();
							}
						}}
					>
						Exit Layer
					</button>
				</div>

				{/* Stress Test */}
				<div className={borderCls}>
					<div className={sectionCls}>Stress Test</div>
					<div className="flex gap-2">
						{[50, 200, 500].map((count) => (
							<button
								key={count}
								type="button"
								className="flex-1 rounded bg-orange-50 py-1 text-orange-600 hover:bg-orange-100 dark:bg-orange-950 dark:text-orange-400 dark:hover:bg-orange-900"
								onClick={() => {
									const colors = [
										'#3b82f6',
										'#ef4444',
										'#f59e0b',
										'#10b981',
										'#8b5cf6',
										'#ec4899',
										'#06b6d4',
									];
									const types = ['debug-card', 'debug-interactive'];
									const cols = Math.ceil(Math.sqrt(count));
									for (let i = 0; i < count; i++) {
										const col = i % cols;
										const row = Math.floor(i / cols);
										engine.createEntity([
											[
												Transform2D,
												{
													x: col * 270 + Math.random() * 20 - 10,
													y: row * 200 + Math.random() * 20 - 10,
													width: 220 + Math.random() * 60,
													height: 150 + Math.random() * 40,
													rotation: 0,
												},
											],
											[Widget, { surface: 'dom', type: types[i % types.length] }],
											[
												WidgetData,
												{
													data: {
														title: `Stress ${i}`,
														color: colors[i % colors.length],
														note: '',
													},
												},
											],
											[ZIndex, { value: i }],
											[Selectable],
											[Draggable],
											[Resizable],
										]);
									}
									engine.zoomToFit();
									engine.markDirty();
								}}
							>
								+{count}
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
