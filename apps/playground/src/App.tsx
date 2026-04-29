import type { GridConfig, OverlapGlowConfig } from '@jamesyong42/infinite-canvas';
import {
	createLayoutEngine,
	DEFAULT_GRID_CONFIG,
	DEFAULT_OVERLAP_GLOW_CONFIG,
	InfiniteCanvas,
} from '@jamesyong42/infinite-canvas';
import { EcsDevtools } from '@jamesyong42/infinite-canvas/devtools';
import { Environment } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';

export type ThemeColors = {
	dotLight: string;
	dotDark: string;
	bgLight: string;
	bgDark: string;
};

const DEFAULT_THEME_COLORS: ThemeColors = {
	dotLight: '#BFC4CC',
	dotDark: '#595E66',
	bgLight: '#FAFAFA',
	bgDark: '#171717',
};

export type OverlapGlowThemeColors = {
	glowLight: string;
	glowDark: string;
	rimLight: string;
	rimDark: string;
};

const DEFAULT_OVERLAP_GLOW_THEME_COLORS: OverlapGlowThemeColors = {
	glowLight: '#808080',
	glowDark: '#FFFFFF',
	rimLight: '#808080',
	rimDark: '#FFFFFF',
};

function hexToRgb01(hex: string): [number, number, number] {
	const s = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
	return [
		Number.parseInt(s.slice(0, 2), 16) / 255,
		Number.parseInt(s.slice(2, 4), 16) / 255,
		Number.parseInt(s.slice(4, 6), 16) / 255,
	];
}

import { InspectorPanel } from './panels/InspectorPanel.js';
import { NavigationBreadcrumbs } from './panels/NavigationBreadcrumbs.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { BatteryCard } from './widgets/BatteryCard.js';
import { CalendarCard } from './widgets/CalendarCard.js';
import { CardContainer } from './widgets/CardContainer.js';
import { ClockCard } from './widgets/ClockCard.js';
import { CrystalWidget } from './widgets/CrystalWidget.js';
import { DebugResizable } from './widgets/DebugResizable.js';
import { FitnessCard } from './widgets/FitnessCard.js';
import { FloatingCubeWidget } from './widgets/FloatingCubeWidget.js';
import { GoldKnotCard } from './widgets/GoldKnotCard.js';
import { MatteSphereCard } from './widgets/MatteSphereCard.js';
import { OrbitCubeCard } from './widgets/OrbitCubeCard.js';
import { PhotosCard } from './widgets/PhotosCard.js';
import { ShapesCard } from './widgets/ShapesCard.js';
import { StocksCard } from './widgets/StocksCard.js';
import { TodoListCard } from './widgets/TodoListCard.js';
import { TorusKnotCard } from './widgets/TorusKnotCard.js';
import { WeatherCard } from './widgets/WeatherCard.js';

function createDemoScene() {
	const domCards = [
		ClockCard,
		BatteryCard,
		CalendarCard,
		WeatherCard,
		StocksCard,
		FitnessCard,
		PhotosCard,
		TodoListCard,
	];
	const geomCards = [
		MatteSphereCard,
		CrystalWidget,
		TorusKnotCard,
		FloatingCubeWidget,
		GoldKnotCard,
		ShapesCard,
		OrbitCubeCard,
	];
	const engine = createLayoutEngine({
		zoom: { min: 0.25, max: 3 },
		widgets: [
			...domCards.map((c) => c.widget),
			...geomCards.map((c) => c.widget),
			DebugResizable.widget,
			CardContainer.widget,
		],
		archetypes: [
			...domCards.map((c) => c.archetype),
			...geomCards.map((c) => c.archetype),
			DebugResizable.archetype,
			CardContainer.archetype,
		],
	});

	// iOS-style cards — fixed preset sizes, non-resizable, lift-on-drag.
	// Grid pitch is 155px + 19px gap = 174px; aligned to the iOS widget grid.
	const GX = 50; // origin x
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

	// Middle column (one xl photo card):
	engine.spawn('photos-card', {
		at: { x: GX + PITCH * 2 + 19, y: GY },
		zIndex: 17,
	});

	// Right column — 3D / PBR cards. Two small side-by-side, two medium
	// stacked, one large at the bottom.
	const G3X = GX + PITCH * 2 + 19 + 329 + 19; // past the Photos column
	engine.spawn('matte-sphere-card', { at: { x: G3X, y: GY }, zIndex: 20 });
	engine.spawn('crystal-widget', { at: { x: G3X + PITCH, y: GY }, zIndex: 21 });
	engine.spawn('torus-knot-card', { at: { x: G3X, y: GY + PITCH }, zIndex: 22 });
	engine.spawn('floating-cube-widget', {
		at: { x: G3X, y: GY + PITCH * 2 },
		zIndex: 23,
	});
	engine.spawn('gold-knot-card', { at: { x: G3X, y: GY + PITCH * 3 }, zIndex: 24 });

	// RFC-005 resize regression surface — freeform resize, no card preset.
	// Parked to the right of the 3D column so it doesn't collide with the
	// iOS grid. Select it, hover each of the 8 handles, drag to verify.
	engine.spawn('debug-resizable', {
		at: { x: G3X + PITCH * 2 + 40, y: GY },
		size: { width: 260, height: 180 },
		zIndex: 30,
	});

	// RFC-004 § Phase 5 — two container demos. Drag any card on top of one
	// and release to consume it into the folder; double-click the folder to
	// descend into its sub-canvas. Escape (or the breadcrumb back button)
	// returns to root.
	engine.spawn('card-container', {
		at: { x: G3X + PITCH * 2 + 40, y: GY + 220 },
		data: { title: 'Widgets', accent: '#6366F1' },
		zIndex: 31,
	});
	engine.spawn('card-container', {
		at: { x: G3X + PITCH * 2 + 40, y: GY + 220 + 345 + 19 },
		data: { title: 'Saved', accent: '#EC4899' },
		zIndex: 32,
	});

	// RFC-006 in-widget interaction demo column. Both cards are "large"
	// (329×345). Drag them to verify engine drag/select still works while
	// pointer events drive their own internal behaviours.
	const G6X = G3X + PITCH * 2 + 40 + 329 + 30;
	// DOM widget: row click toggles items, native form interactives bypass
	// engine routing automatically (button / input / checkbox).
	engine.spawn('todo-list-card', { at: { x: G6X, y: GY }, zIndex: 40 });
	// R3F widget: pointer-driven physics, click cycles accent. event.point
	// arrives in widget-local coords via the EventRouter (RFC-006 § 4c).
	engine.spawn('shapes-card', {
		at: { x: G6X, y: GY + 345 + 19 },
		zIndex: 41,
	});

	// RFC-008 § Default coexistence — orbit-controlled cube. Drag the
	// cube to rotate it (mesh claims drag via setPointerCapture, engine
	// stays out); drag the card chrome around the cube to move the
	// widget on canvas; click the cube and it logs while the engine
	// also selects the widget.
	engine.spawn('orbit-cube-card', {
		at: { x: G6X, y: GY + (345 + 19) * 2 },
		zIndex: 42,
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
	const [themeColors, setThemeColors] = useState<ThemeColors>(DEFAULT_THEME_COLORS);
	const [overlapGlow, setOverlapGlow] = useState<OverlapGlowConfig>({
		...DEFAULT_OVERLAP_GLOW_CONFIG,
	});
	const [overlapGlowThemeColors, setOverlapGlowThemeColors] = useState<OverlapGlowThemeColors>(
		DEFAULT_OVERLAP_GLOW_THEME_COLORS,
	);
	const [zoom, setZoom] = useState(() => engine.getCamera().zoom);

	useEffect(() => {
		document.documentElement.classList.toggle('dark', dark);
		localStorage.setItem('ic-dark-mode', String(dark));
		engine.markDirty();
	}, [dark, engine]);

	// Drive the library's --canvas-bg var from user-controlled theme colors.
	useEffect(() => {
		const bg = dark ? themeColors.bgDark : themeColors.bgLight;
		document.documentElement.style.setProperty('--canvas-bg', bg);
	}, [dark, themeColors]);

	// Merge the theme-appropriate dot color into the grid config. Memoized
	// so InfiniteCanvas only re-applies the grid when a relevant input
	// actually changes, not on every parent render.
	const effectiveGrid = useMemo<GridConfig>(
		() => ({
			...gridConfig,
			dotColor: hexToRgb01(dark ? themeColors.dotDark : themeColors.dotLight),
		}),
		[gridConfig, dark, themeColors],
	);

	// Resolve light/dark glow + rim colors against the active theme so the
	// library only sees a single-color OverlapGlowConfig.
	const effectiveOverlapGlow = useMemo<OverlapGlowConfig>(
		() => ({
			...overlapGlow,
			glowColor: hexToRgb01(
				dark ? overlapGlowThemeColors.glowDark : overlapGlowThemeColors.glowLight,
			),
			rimColor: hexToRgb01(dark ? overlapGlowThemeColors.rimDark : overlapGlowThemeColors.rimLight),
		}),
		[overlapGlow, overlapGlowThemeColors, dark],
	);

	// Keep the zoom pill in sync with wheel / pinch / programmatic zoom.
	// `onFrame` only fires on dirty ticks so this doesn't flood React.
	useEffect(() => {
		return engine.onFrame(() => {
			setZoom(engine.getCamera().zoom);
		});
	}, [engine]);

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
				grid={effectiveGrid}
				overlapGlow={effectiveOverlapGlow}
				className="h-full w-full"
				// Canvas-level IBL — stays mounted across widget navigation, so
				// consuming an R3F card into a folder / exiting back to root
				// no longer kills lighting for metallic materials everywhere.
				r3fRoot={<Environment preset="apartment" />}
			/>

			{/* Navigation breadcrumbs + back button (top-left) */}
			<NavigationBreadcrumbs engine={engine} />

			{/* Zoom control pill (top-right, left of dark-mode toggle) */}
			<div className="absolute top-4 right-16 z-50 flex h-10 items-center overflow-hidden rounded-full bg-white shadow-lg dark:bg-neutral-800">
				<button
					type="button"
					onClick={() => engine.zoomTo(engine.getCamera().zoom * 0.8)}
					className="flex h-10 w-10 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
					title="Zoom out"
					aria-label="Zoom out"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Zoom out</title>
						<path d="M5 12h14" />
					</svg>
				</button>
				<button
					type="button"
					onClick={() => engine.zoomTo(1)}
					onDoubleClick={() => engine.zoomToFit()}
					className="flex h-10 w-14 items-center justify-center text-sm font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
					title="Click: reset to 100% · Double-click: zoom to fit"
					aria-label={`Current zoom: ${Math.round(zoom * 100)}%`}
				>
					{Math.round(zoom * 100)}%
				</button>
				<button
					type="button"
					onClick={() => engine.zoomTo(engine.getCamera().zoom * 1.25)}
					className="flex h-10 w-10 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
					title="Zoom in"
					aria-label="Zoom in"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<title>Zoom in</title>
						<path d="M12 5v14" />
						<path d="M5 12h14" />
					</svg>
				</button>
			</div>

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
					themeColors={themeColors}
					onThemeColorsChange={setThemeColors}
					overlapGlow={overlapGlow}
					onOverlapGlowChange={setOverlapGlow}
					overlapGlowThemeColors={overlapGlowThemeColors}
					onOverlapGlowThemeColorsChange={setOverlapGlowThemeColors}
					onClose={() => setShowSettings(false)}
				/>
			)}
			{showInspector && <InspectorPanel engine={engine} onClose={() => setShowInspector(false)} />}
			{showEcs && <EcsDevtools engine={engine} onClose={() => setShowEcs(false)} />}
		</div>
	);
}
