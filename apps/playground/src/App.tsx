import {
	Children,
	Container,
	DEFAULT_GRID_CONFIG,
	Draggable,
	InfiniteCanvas,
	Parent,
	Resizable,
	Selectable,
	Transform2D,
	Widget,
	WidgetData,
	ZIndex,
	createLayoutEngine,
} from '@jamesyong42/infinite-canvas';
import type { EntityId, GridConfig, WidgetDef } from '@jamesyong42/infinite-canvas';
import { useEffect, useMemo, useState } from 'react';
import { InspectorPanel } from './panels/InspectorPanel.js';
import { NavigationBreadcrumbs } from './panels/NavigationBreadcrumbs.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { Debug3D } from './widgets/Debug3D.js';
import { DebugCard } from './widgets/DebugCard.js';
import { DebugContainer } from './widgets/DebugContainer.js';
import { DebugInteractive } from './widgets/DebugInteractive.js';

const widgets: WidgetDef[] = [
	{ type: 'debug-card', component: DebugCard, defaultSize: { width: 250, height: 180 } },
	{
		type: 'debug-interactive',
		component: DebugInteractive,
		defaultSize: { width: 280, height: 200 },
	},
	{
		type: 'debug-container',
		component: DebugContainer,
		defaultSize: { width: 400, height: 300 },
	},
	{
		type: 'debug-3d',
		surface: 'webgl',
		component: Debug3D,
		defaultSize: { width: 250, height: 250 },
	},
];

function createDemoScene() {
	const engine = createLayoutEngine({
		zoom: { min: 0.05, max: 8 },
	});

	// Create demo widgets
	engine.addWidget({
		type: 'debug-card',
		position: { x: 50, y: 50 },
		size: { width: 250, height: 180 },
		data: {
			title: 'Hello World',
			color: '#3b82f6',
			description: 'A simple card widget demonstrating breakpoints.',
		},
		zIndex: 1,
	});
	engine.addWidget({
		type: 'debug-card',
		position: { x: 350, y: 50 },
		size: { width: 200, height: 150 },
		data: { title: 'Another Card', color: '#ef4444' },
		zIndex: 2,
	});
	engine.addWidget({
		type: 'debug-card',
		position: { x: 600, y: 50 },
		size: { width: 300, height: 200 },
		data: {
			title: 'Wide Card',
			color: '#f59e0b',
			description: 'This one is wider to show expanded breakpoint.',
		},
		zIndex: 3,
	});
	engine.addWidget({
		type: 'debug-interactive',
		position: { x: 50, y: 280 },
		size: { width: 280, height: 200 },
		data: { title: 'Click Counter' },
		zIndex: 4,
	});
	engine.addWidget({
		type: 'debug-interactive',
		position: { x: 380, y: 280 },
		size: { width: 250, height: 180 },
		data: { title: 'Text Input', note: '' },
		zIndex: 5,
	});

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
	engine.addWidget({
		type: 'debug-card',
		position: { x: 700, y: 300 },
		size: { width: 220, height: 160 },
		data: { title: 'Far Away', color: '#06b6d4', description: 'Pan to find me!' },
		zIndex: 7,
	});
	engine.addWidget({
		type: 'debug-card',
		position: { x: -300, y: -200 },
		size: { width: 250, height: 180 },
		data: {
			title: 'Negative Space',
			color: '#84cc16',
			description: 'I live in negative coordinates.',
		},
		zIndex: 8,
	});

	// WebGL 3D widgets
	engine.addWidget({
		type: 'debug-3d',
		position: { x: 700, y: 530 },
		size: { width: 250, height: 250 },
		data: { title: '3D Cube', color: '#ec4899' },
		zIndex: 9,
		surface: 'webgl',
	});
	engine.addWidget({
		type: 'debug-3d',
		position: { x: 1000, y: 530 },
		size: { width: 200, height: 200 },
		data: { title: '3D Blue', color: '#3b82f6' },
		zIndex: 10,
		surface: 'webgl',
	});

	return engine;
}

export function App() {
	const engine = useMemo(() => createDemoScene(), []);
	const [showSettings, setShowSettings] = useState(false);
	const [showInspector, setShowInspector] = useState(false);
	const [dark, setDark] = useState(() => {
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('ic-dark-mode');
			if (saved !== null) return saved === 'true';
			return window.matchMedia('(prefers-color-scheme: dark)').matches;
		}
		return false;
	});

	const [gridConfig, setGridConfig] = useState<GridConfig>({ ...DEFAULT_GRID_CONFIG });

	useEffect(() => {
		document.documentElement.classList.toggle('dark', dark);
		localStorage.setItem('ic-dark-mode', String(dark));
		engine.markDirty();
	}, [dark, engine]);

	// Keyboard shortcuts
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;

			// Undo: Cmd/Ctrl+Z
			if (mod && !e.shiftKey && e.key === 'z') {
				e.preventDefault();
				engine.undo();
				engine.markDirty();
			}
			// Redo: Cmd/Ctrl+Shift+Z
			if (mod && e.shiftKey && e.key === 'z') {
				e.preventDefault();
				engine.redo();
				engine.markDirty();
			}
			// Exit container: Escape
			if (e.key === 'Escape') {
				if (engine.getNavigationDepth() > 0) {
					engine.exitContainer();
					engine.markDirty();
				}
			}
			// Delete selected: Backspace or Delete (skip when focus is on an input)
			if (e.key === 'Backspace' || e.key === 'Delete') {
				const el = document.activeElement;
				if (el?.closest('input, textarea, select, [contenteditable]')) return;
				const selected = engine.getSelectedEntities();
				for (const id of selected) {
					engine.destroyEntity(id);
				}
				if (selected.length > 0) engine.markDirty();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [engine]);

	return (
		<div className="h-screen w-screen">
			<InfiniteCanvas
				engine={engine}
				widgets={widgets}
				grid={gridConfig}
				className="h-full w-full"
			/>

			{/* Navigation breadcrumbs + back button (top-left) */}
			<NavigationBreadcrumbs engine={engine} />

			{/* Dark mode toggle */}
			<button
				type="button"
				onClick={() => setDark((d) => !d)}
				className="absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
				title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
			>
				{dark ? (
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Light mode</title>
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2" />
						<path d="M12 20v2" />
						<path d="m4.93 4.93 1.41 1.41" />
						<path d="m17.66 17.66 1.41 1.41" />
						<path d="M2 12h2" />
						<path d="M20 12h2" />
						<path d="m6.34 17.66-1.41 1.41" />
						<path d="m19.07 4.93-1.41 1.41" />
					</svg>
				) : (
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Dark mode</title>
						<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
					</svg>
				)}
			</button>

			{/* Floating buttons */}
			<button
				type="button"
				onClick={() => setShowSettings((s) => !s)}
				className={`absolute bottom-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors ${
					showSettings
						? 'bg-neutral-800 text-white dark:bg-white dark:text-neutral-800'
						: 'bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200'
				}`}
				title="Settings"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>Settings</title>
					<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			</button>

			<button
				type="button"
				onClick={() => setShowInspector((s) => !s)}
				className={`absolute bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors ${
					showInspector
						? 'bg-neutral-800 text-white dark:bg-white dark:text-neutral-800'
						: 'bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200'
				}`}
				title="Inspector"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>Inspector</title>
					<path d="M12 20h9" />
					<path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
				</svg>
			</button>

			{/* Panels */}
			{showSettings && (
				<SettingsPanel
					engine={engine}
					gridConfig={gridConfig}
					onGridChange={setGridConfig}
					onClose={() => setShowSettings(false)}
				/>
			)}
			{showInspector && <InspectorPanel engine={engine} onClose={() => setShowInspector(false)} />}
		</div>
	);
}
