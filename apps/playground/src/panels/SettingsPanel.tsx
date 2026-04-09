import { useState } from 'react';
import type { CanvasEngine } from '@infinite-canvas/core';
import { ZoomConfigResource, BreakpointConfigResource } from '@infinite-canvas/core';

interface SettingsPanelProps {
	engine: CanvasEngine;
	onClose: () => void;
}

export function SettingsPanel({ engine, onClose }: SettingsPanelProps) {
	const zoomConfig = engine.world.getResource(ZoomConfigResource);
	const bpConfig = engine.world.getResource(BreakpointConfigResource);

	const [minZoom, setMinZoom] = useState(zoomConfig.min);
	const [maxZoom, setMaxZoom] = useState(zoomConfig.max);
	const [bpMicro, setBpMicro] = useState(bpConfig.micro);
	const [bpCompact, setBpCompact] = useState(bpConfig.compact);
	const [bpNormal, setBpNormal] = useState(bpConfig.normal);
	const [bpExpanded, setBpExpanded] = useState(bpConfig.expanded);

	const apply = () => {
		engine.world.setResource(ZoomConfigResource, { min: minZoom, max: maxZoom });
		engine.world.setResource(BreakpointConfigResource, {
			micro: bpMicro, compact: bpCompact, normal: bpNormal, expanded: bpExpanded,
		});
		engine.markDirty();
	};

	return (
		<div className="absolute bottom-14 left-4 z-50 w-64 rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px]">
			<div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
				<span className="font-semibold text-neutral-700">Settings</span>
				<button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600">x</button>
			</div>

			<div className="space-y-3 p-3">
				{/* Zoom limits */}
				<div>
					<div className="mb-1 text-neutral-400">Zoom Range</div>
					<div className="flex gap-2">
						<label className="flex flex-1 items-center gap-1">
							<span className="text-neutral-400">min</span>
							<input
								type="number"
								step="0.01"
								className="w-full rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-right"
								value={minZoom}
								onChange={(e) => setMinZoom(Number(e.target.value))}
								onBlur={apply}
							/>
						</label>
						<label className="flex flex-1 items-center gap-1">
							<span className="text-neutral-400">max</span>
							<input
								type="number"
								step="0.1"
								className="w-full rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-right"
								value={maxZoom}
								onChange={(e) => setMaxZoom(Number(e.target.value))}
								onBlur={apply}
							/>
						</label>
					</div>
				</div>

				{/* Breakpoint thresholds */}
				<div>
					<div className="mb-1 text-neutral-400">Breakpoint Thresholds (screen px)</div>
					<div className="grid grid-cols-2 gap-1.5">
						{([
							['micro', bpMicro, setBpMicro],
							['compact', bpCompact, setBpCompact],
							['normal', bpNormal, setBpNormal],
							['expanded', bpExpanded, setBpExpanded],
						] as const).map(([label, val, set]) => (
							<label key={label} className="flex items-center gap-1">
								<span className="w-14 text-neutral-400">{label}</span>
								<input
									type="number"
									className="w-full rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-right"
									value={val}
									onChange={(e) => (set as (v: number) => void)(Number(e.target.value))}
									onBlur={apply}
								/>
							</label>
						))}
					</div>
				</div>

				{/* Actions */}
				<div className="flex gap-2 border-t border-neutral-100 pt-2">
					<button
						type="button"
						className="flex-1 rounded bg-neutral-100 py-1 text-neutral-600 hover:bg-neutral-200"
						onClick={() => { engine.zoomToFit(); engine.markDirty(); }}
					>
						Zoom to Fit
					</button>
					<button
						type="button"
						className="flex-1 rounded bg-neutral-100 py-1 text-neutral-600 hover:bg-neutral-200"
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
			</div>
		</div>
	);
}
