import { useEffect, useState } from 'react';
import type { CanvasEngine } from '@infinite-canvas/core';
import { Selected, Active, Visible } from '@infinite-canvas/core';

interface InspectorPanelProps {
	engine: CanvasEngine;
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
	fps: number;
	tickTime: number;
}

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
		fps: 0,
		tickTime: 0,
	});

	useEffect(() => {
		let frameCount = 0;
		let lastFpsTime = performance.now();
		let lastFps = 0;

		const interval = setInterval(() => {
			const now = performance.now();
			const elapsed = now - lastFpsTime;
			if (elapsed > 0) {
				lastFps = Math.round((frameCount / elapsed) * 1000);
				frameCount = 0;
				lastFpsTime = now;
			}

			const camera = engine.getCamera();
			setMetrics({
				totalEntities: engine.world.query().length,
				activeEntities: engine.world.queryTagged(Active).length,
				visibleEntities: engine.getVisibleEntities().length,
				selectedEntities: engine.world.queryTagged(Selected).length,
				cameraX: camera.x,
				cameraY: camera.y,
				cameraZoom: camera.zoom,
				navDepth: engine.getNavigationDepth(),
				activeContainer: engine.getActiveContainer(),
				fps: lastFps,
				tickTime: 0,
			});
		}, 200);

		const unsub = engine.onFrame(() => {
			frameCount++;
		});

		return () => {
			clearInterval(interval);
			unsub();
		};
	}, [engine]);

	const row = (label: string, value: string | number) => (
		<div className="flex justify-between">
			<span className="text-neutral-400">{label}</span>
			<span className="text-neutral-600">{value}</span>
		</div>
	);

	return (
		<div className="absolute bottom-14 right-4 z-50 w-56 rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px]">
			<div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
				<span className="font-semibold text-neutral-700">Inspector</span>
				<button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600">x</button>
			</div>

			<div className="space-y-2 p-3">
				{/* ECS */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">ECS</div>
					{row('entities', metrics.totalEntities)}
					{row('active', metrics.activeEntities)}
					{row('visible', metrics.visibleEntities)}
					{row('selected', metrics.selectedEntities)}
				</div>

				{/* Camera */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">Camera</div>
					{row('x', metrics.cameraX.toFixed(1))}
					{row('y', metrics.cameraY.toFixed(1))}
					{row('zoom', metrics.cameraZoom.toFixed(3))}
				</div>

				{/* Navigation */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">Navigation</div>
					{row('depth', metrics.navDepth)}
					{row('container', metrics.activeContainer !== null ? `e${metrics.activeContainer}` : 'root')}
				</div>

				{/* Performance */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">Performance</div>
					{row('fps (tick)', metrics.fps)}
					{row('world tick', engine.world.currentTick)}
				</div>
			</div>
		</div>
	);
}
