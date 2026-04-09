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
	undoSize: number;
	redoSize: number;
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
		undoSize: 0,
		redoSize: 0,
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
				totalEntities: engine.world.entityCount,
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
				undoSize: engine.canUndo() ? 1 : 0, // simplified — count from engine
				redoSize: engine.canRedo() ? 1 : 0,
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
			<span className="text-neutral-400 dark:text-neutral-500">{label}</span>
			<span className="text-neutral-600 dark:text-neutral-300">{value}</span>
		</div>
	);

	return (
		<div className="absolute bottom-14 right-4 z-50 w-56 rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-300">
			<div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
				<span className="font-semibold text-neutral-700 dark:text-neutral-200">Inspector</span>
				<button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">x</button>
			</div>

			<div className="space-y-2 p-3">
				{/* ECS */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600">ECS</div>
					{row('entities', metrics.totalEntities)}
					{row('active', metrics.activeEntities)}
					{row('visible', metrics.visibleEntities)}
					{row('selected', metrics.selectedEntities)}
				</div>

				{/* Camera */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600">Camera</div>
					{row('x', metrics.cameraX.toFixed(1))}
					{row('y', metrics.cameraY.toFixed(1))}
					{row('zoom', metrics.cameraZoom.toFixed(3))}
				</div>

				{/* Navigation */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600">Navigation</div>
					{row('depth', metrics.navDepth)}
					{row('container', metrics.activeContainer !== null ? `e${metrics.activeContainer}` : 'root')}
				</div>

				{/* Undo/Redo */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600">History</div>
					{row('can undo', metrics.undoSize ? 'yes' : 'no')}
					{row('can redo', metrics.redoSize ? 'yes' : 'no')}
				</div>

				{/* Performance */}
				<div>
					<div className="mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600">Performance</div>
					{row('fps (tick)', metrics.fps)}
					{row('world tick', engine.world.currentTick)}
				</div>

				{/* Shortcuts */}
				<div className="border-t border-neutral-100 pt-2 text-[9px] text-neutral-300 space-y-0.5 dark:border-neutral-700 dark:text-neutral-600">
					<div>Cmd+Z undo / Cmd+Shift+Z redo</div>
					<div>Esc exit container / Del delete</div>
				</div>
			</div>
		</div>
	);
}
