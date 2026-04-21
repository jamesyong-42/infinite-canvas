import type { GridConfig } from '@jamesyong42/infinite-canvas';
import {
	Children,
	createLayoutEngine,
	DEFAULT_GRID_CONFIG,
	InfiniteCanvas,
} from '@jamesyong42/infinite-canvas';
import { EcsDevtools } from '@jamesyong42/infinite-canvas/devtools';
import { useEffect, useMemo, useState } from 'react';
import { InspectorPanel } from './panels/InspectorPanel.js';
import { NavigationBreadcrumbs } from './panels/NavigationBreadcrumbs.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { BatteryCard } from './widgets/BatteryCard.js';
import { CalendarCard } from './widgets/CalendarCard.js';
import { ClockCard } from './widgets/ClockCard.js';
import { Debug3D } from './widgets/Debug3D.js';
import { DebugCard } from './widgets/DebugCard.js';
import { DebugContainer, DebugContainerArchetype } from './widgets/DebugContainer.js';
import { DebugInteractive } from './widgets/DebugInteractive.js';
import { FitnessCard } from './widgets/FitnessCard.js';
import { PhotosCard } from './widgets/PhotosCard.js';
import { StocksCard } from './widgets/StocksCard.js';
import { WeatherCard } from './widgets/WeatherCard.js';

function createDemoScene() {
	const cards = [
		ClockCard,
		BatteryCard,
		CalendarCard,
		WeatherCard,
		StocksCard,
		FitnessCard,
		PhotosCard,
	];
	const engine = createLayoutEngine({
		zoom: { min: 0.05, max: 8 },
		widgets: [DebugCard, DebugInteractive, DebugContainer, Debug3D, ...cards.map((c) => c.widget)],
		archetypes: [DebugContainerArchetype, ...cards.map((c) => c.archetype)],
	});

	engine.spawn('debug-card', {
		at: { x: 50, y: 50 },
		data: {
			title: 'Hello World',
			color: '#3b82f6',
			description: 'A simple card widget demonstrating breakpoints.',
		},
		zIndex: 1,
	});
	engine.spawn('debug-card', {
		at: { x: 350, y: 50 },
		size: { width: 200, height: 150 },
		data: { title: 'Another Card', color: '#ef4444' },
		zIndex: 2,
	});
	engine.spawn('debug-card', {
		at: { x: 600, y: 50 },
		size: { width: 300, height: 200 },
		data: {
			title: 'Wide Card',
			color: '#f59e0b',
			description: 'This one is wider to show expanded breakpoint.',
		},
		zIndex: 3,
	});
	engine.spawn('debug-interactive', {
		at: { x: 50, y: 280 },
		data: { title: 'Click Counter' },
		zIndex: 4,
	});
	engine.spawn('debug-interactive', {
		at: { x: 380, y: 280 },
		size: { width: 250, height: 180 },
		data: { title: 'Text Input' },
		zIndex: 5,
	});

	// Enterable container — archetype bundles Container + Children.
	const container = engine.spawn('debug-container', {
		at: { x: 50, y: 530 },
		size: { width: 500, height: 350 },
		data: { title: 'My Container' },
		zIndex: 6,
	});

	const child1 = engine.spawn('debug-card', {
		at: { x: 30, y: 30 },
		size: { width: 200, height: 140 },
		data: { title: 'Child A', color: '#8b5cf6' },
		zIndex: 1,
		parent: container,
	});
	const child2 = engine.spawn('debug-interactive', {
		at: { x: 260, y: 30 },
		size: { width: 200, height: 140 },
		data: { title: 'Child B' },
		zIndex: 2,
		parent: container,
	});
	engine.set(container, Children, { ids: [child1, child2] });

	engine.spawn('debug-card', {
		at: { x: 700, y: 300 },
		size: { width: 220, height: 160 },
		data: { title: 'Far Away', color: '#06b6d4', description: 'Pan to find me!' },
		zIndex: 7,
	});
	engine.spawn('debug-card', {
		at: { x: -300, y: -200 },
		data: {
			title: 'Negative Space',
			color: '#84cc16',
			description: 'I live in negative coordinates.',
		},
		zIndex: 8,
	});

	engine.spawn('debug-3d', {
		at: { x: 700, y: 530 },
		data: { title: '3D Cube', color: '#ec4899' },
		zIndex: 9,
	});
	engine.spawn('debug-3d', {
		at: { x: 1000, y: 530 },
		size: { width: 200, height: 200 },
		data: { title: '3D Blue', color: '#3b82f6' },
		zIndex: 10,
	});

	// iOS-style cards — fixed preset sizes, non-resizable, lift-on-drag.
	// Grid pitch is 155px + 19px gap = 174px; aligned to the iOS widget grid.
	const GX = 950; // origin x
	const GY = 50; // origin y
	const PITCH = 174;

	// Left column (2 small-wide slots = 329px):
	engine.spawn('clock-card', { at: { x: GX, y: GY }, zIndex: 11 });
	engine.spawn('battery-card', { at: { x: GX + PITCH, y: GY }, zIndex: 12 });
	engine.spawn('calendar-card', {
		at: { x: GX, y: GY + PITCH },
		data: {
			dateIso: null,
			nextEvent: 'Design review',
			nextEventTime: '3:30 PM',
		},
		zIndex: 13,
	});
	engine.spawn('weather-card', {
		at: { x: GX, y: GY + PITCH * 2 },
		data: { location: 'Cupertino', temp: 72, high: 78, low: 60, condition: 'sunny' },
		zIndex: 14,
	});
	engine.spawn('stocks-card', { at: { x: GX, y: GY + PITCH * 3 }, zIndex: 15 });
	engine.spawn('fitness-card', { at: { x: GX, y: GY + PITCH * 4 }, zIndex: 16 });

	// Right column (one xl photo card):
	engine.spawn('photos-card', {
		at: { x: GX + PITCH * 2 + 19, y: GY },
		zIndex: 17,
	});

	return engine;
}

export function App() {
	const engine = useMemo(() => createDemoScene(), []);
	const [showSettings, setShowSettings] = useState(false);
	const [showInspector, setShowInspector] = useState(false);
	const [showEcs, setShowEcs] = useState(false);
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
			<InfiniteCanvas engine={engine} grid={gridConfig} className="h-full w-full" />

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
				onClick={() => setShowEcs((s) => !s)}
				className={`absolute bottom-4 right-16 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors ${
					showEcs
						? 'bg-neutral-800 text-white dark:bg-white dark:text-neutral-800'
						: 'bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200'
				}`}
				title="ECS Editor"
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
					<title>ECS Editor</title>
					<rect x="3" y="3" width="7" height="7" rx="1" />
					<rect x="14" y="3" width="7" height="7" rx="1" />
					<rect x="3" y="14" width="7" height="7" rx="1" />
					<rect x="14" y="14" width="7" height="7" rx="1" />
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
			{showEcs && <EcsDevtools engine={engine} onClose={() => setShowEcs(false)} />}
		</div>
	);
}
