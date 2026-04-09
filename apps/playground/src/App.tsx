import { useMemo } from 'react';
import {
	createCanvasEngine,
	Transform2D,
	Widget,
	WidgetData,
	ZIndex,
	Selectable,
	Draggable,
	Resizable,
	Container,
	Children,
	Parent,
} from '@infinite-canvas/core';
import type { EntityId } from '@infinite-canvas/core';
import { InfiniteCanvas } from '@infinite-canvas/react';
import { WidgetProvider, createWidgetRegistry } from '@infinite-canvas/react-widgets';
import { DebugCard } from './widgets/DebugCard.js';
import { DebugInteractive } from './widgets/DebugInteractive.js';
import { DebugContainer } from './widgets/DebugContainer.js';

function createDemoScene() {
	const engine = createCanvasEngine({
		zoom: { min: 0.05, max: 8 },
	});

	const registry = createWidgetRegistry([
		{ type: 'debug-card', component: DebugCard, defaultSize: { width: 250, height: 180 } },
		{ type: 'debug-interactive', component: DebugInteractive, defaultSize: { width: 280, height: 200 } },
		{ type: 'debug-container', component: DebugContainer, defaultSize: { width: 400, height: 300 } },
	]);

	// Helper to create a widget entity
	function addWidget(
		type: string,
		x: number,
		y: number,
		width: number,
		height: number,
		data: Record<string, any>,
		zIndex = 0,
	): EntityId {
		return engine.createEntity([
			[Transform2D, { x, y, width, height, rotation: 0 }],
			[Widget, { surface: 'dom', type }],
			[WidgetData, { data }],
			[ZIndex, { value: zIndex }],
			[Selectable],
			[Draggable],
			[Resizable],
		]);
	}

	// Create demo widgets
	addWidget('debug-card', 50, 50, 250, 180, {
		title: 'Hello World',
		color: '#3b82f6',
		description: 'A simple card widget demonstrating breakpoints.',
	}, 1);

	addWidget('debug-card', 350, 50, 200, 150, {
		title: 'Another Card',
		color: '#ef4444',
	}, 2);

	addWidget('debug-card', 600, 50, 300, 200, {
		title: 'Wide Card',
		color: '#f59e0b',
		description: 'This one is wider to show expanded breakpoint.',
	}, 3);

	addWidget('debug-interactive', 50, 280, 280, 200, {
		title: 'Click Counter',
	}, 4);

	addWidget('debug-interactive', 380, 280, 250, 180, {
		title: 'Text Input',
		note: '',
	}, 5);

	// Container with children
	const container = engine.createEntity([
		[Transform2D, { x: 50, y: 530, width: 500, height: 350, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'debug-container' }],
		[WidgetData, { data: { title: 'My Container' } }],
		[ZIndex, { value: 6 }],
		[Container, { enterable: true }],
		[Children, { ids: [] as EntityId[] }],
		[Selectable],
		[Draggable],
		[Resizable],
	]);

	// Create children inside the container
	const child1 = engine.createEntity([
		[Transform2D, { x: 30, y: 30, width: 200, height: 140, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'debug-card' }],
		[WidgetData, { data: { title: 'Child A', color: '#8b5cf6' } }],
		[Parent, { id: container }],
		[ZIndex, { value: 1 }],
		[Selectable],
		[Draggable],
		[Resizable],
	]);

	const child2 = engine.createEntity([
		[Transform2D, { x: 260, y: 30, width: 200, height: 140, rotation: 0 }],
		[Widget, { surface: 'dom', type: 'debug-interactive' }],
		[WidgetData, { data: { title: 'Child B', note: '' } }],
		[Parent, { id: container }],
		[ZIndex, { value: 2 }],
		[Selectable],
		[Draggable],
		[Resizable],
	]);

	// Update container's children list
	engine.set(container, Children, { ids: [child1, child2] });

	// More widgets scattered around
	addWidget('debug-card', 700, 300, 220, 160, {
		title: 'Far Away',
		color: '#06b6d4',
		description: 'Pan to find me!',
	}, 7);

	addWidget('debug-card', -300, -200, 250, 180, {
		title: 'Negative Space',
		color: '#84cc16',
		description: 'I live in negative coordinates.',
	}, 8);

	return { engine, registry };
}

export function App() {
	const { engine, registry } = useMemo(() => createDemoScene(), []);

	return (
		<div className="flex h-screen w-screen flex-col bg-gray-100">
			{/* Header */}
			<div className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
				<h1 className="text-sm font-bold text-gray-700">Infinite Canvas Playground</h1>
				<div className="flex gap-2 text-xs text-gray-400">
					<span>Scroll: pan</span>
					<span>Pinch/Ctrl+scroll: zoom</span>
					<span>Click: select</span>
					<span>Drag: move</span>
					<span>Double-click container: enter</span>
				</div>
				<div className="ml-auto flex gap-2">
					<button
						type="button"
						className="rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300"
						onClick={() => { engine.zoomToFit(); engine.tick(); }}
					>
						Fit All
					</button>
					<button
						type="button"
						className="rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300"
						onClick={() => {
							if (engine.getNavigationDepth() > 0) {
								engine.exitContainer();
								engine.tick();
							}
						}}
					>
						Back
					</button>
				</div>
			</div>

			{/* Canvas — WidgetProvider wraps InfiniteCanvas so context flows to WidgetSlots */}
			<WidgetProvider registry={registry}>
				<InfiniteCanvas engine={engine} className="flex-1" />
			</WidgetProvider>
		</div>
	);
}
