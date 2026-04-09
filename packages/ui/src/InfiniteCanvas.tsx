import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { CanvasEngine, EntityId } from '@infinite-canvas/core';
import { Widget, WorldBounds } from '@infinite-canvas/core';
import { EngineProvider, ContainerRefProvider, useWidgetResolver } from './context.js';
import { WidgetSlot } from './WidgetSlot.js';
import { SelectionOverlaySlot } from './SelectionOverlaySlot.js';
import { WebGLWidgetLayer } from './webgl/WebGLWidgetLayer.js';
import { GridRenderer } from './webgl/GridRenderer.js';
import type { GridConfig } from './webgl/GridRenderer.js';

interface InfiniteCanvasProps {
	engine: CanvasEngine;
	/** Grid configuration. Pass `false` to disable the grid entirely. */
	grid?: Partial<GridConfig> | false;
	className?: string;
	style?: React.CSSProperties;
	children?: React.ReactNode;
}

export function InfiniteCanvas({ engine, grid, className, style, children }: InfiniteCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const webglCanvasRef = useRef<HTMLCanvasElement>(null);
	const gridRendererRef = useRef<GridRenderer | null>(null);
	const cameraLayerRef = useRef<HTMLDivElement>(null);
	const slotRefs = useRef(new Map<EntityId, HTMLDivElement>());
	const [visibleEntities, setVisibleEntities] = useState<EntityId[]>([]);

	// Register slot ref for batch updater
	const registerSlotRef = useCallback((entityId: EntityId, el: HTMLDivElement | null) => {
		if (el) {
			slotRefs.current.set(entityId, el);
		} else {
			slotRefs.current.delete(entityId);
		}
	}, []);

	// Initialize GridRenderer + set viewport size on mount/resize
	useLayoutEffect(() => {
		const container = containerRef.current;
		const canvas = webglCanvasRef.current;
		if (!container || !canvas) return;

		const gridEnabled = grid !== false;
		let gridInst: GridRenderer | null = null;
		if (gridEnabled) {
			gridInst = new GridRenderer(canvas);
			gridRendererRef.current = gridInst;
		}

		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio;
			engine.setViewport(rect.width, rect.height, dpr);
			if (gridInst) {
				canvas.style.width = `${rect.width}px`;
				canvas.style.height = `${rect.height}px`;
				gridInst.setSize(rect.width, rect.height, dpr);
			}
		};

		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(container);
		return () => {
			observer.disconnect();
			if (gridInst) {
				gridInst.dispose();
				gridRendererRef.current = null;
			}
		};
	}, [engine, grid]);

	// Apply grid config (user overrides + dark mode defaults) on every render
	useEffect(() => {
		const renderer = gridRendererRef.current;
		if (!renderer || grid === false) return;
		const isDark = document.documentElement.classList.contains('dark');
		renderer.setConfig({
			// Dark mode defaults, then user overrides on top
			dotColor: isDark ? [1, 1, 1] : [0, 0, 0],
			dotAlpha: isDark ? 0.12 : 0.18,
			...grid,
		});
		engine.markDirty();
	});

	// Wheel handler — pan/zoom (gesture channel, always active)
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				// Pinch zoom or ctrl+scroll
				const rect = container.getBoundingClientRect();
				engine.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, -e.deltaY * 0.01);
			} else {
				// Two-finger scroll pan
				engine.panBy(-e.deltaX, -e.deltaY);
			}
		};

		container.addEventListener('wheel', onWheel, { passive: false });
		return () => container.removeEventListener('wheel', onWheel);
	}, [engine]);

	// Touch gesture handler — iOS Freeform-style interactions
	// 1 finger on background → pan; 1 finger on entity → select/drag;
	// 2 fingers → pinch-to-zoom + pan; double-tap → zoom step / enter container
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		type TouchGesture =
			| { type: 'idle' }
			| { type: 'pending-pan'; x: number; y: number; time: number }
			| { type: 'panning'; lastX: number; lastY: number }
			| { type: 'pending-entity'; x: number; y: number; time: number }
			| { type: 'entity-dragging' }
			| { type: 'pinching'; lastDist: number; lastCx: number; lastCy: number };

		let gesture: TouchGesture = { type: 'idle' };
		let lastTapTime = 0;
		let lastTapX = 0;
		let lastTapY = 0;
		const DEAD_ZONE = 8;
		const DOUBLE_TAP_MS = 300;
		const DOUBLE_TAP_DIST = 30;

		function isOnWidget(target: EventTarget | null): boolean {
			let el = target as HTMLElement | null;
			while (el && el !== container) {
				if (el.hasAttribute('data-widget-slot')) return true;
				el = el.parentElement;
			}
			return false;
		}

		function isInteractive(target: EventTarget | null): boolean {
			const el = target as HTMLElement | null;
			if (!el) return false;
			const tag = el.tagName;
			return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT'
				|| el.isContentEditable || el.closest('button') !== null;
		}

		function getRect() {
			return container!.getBoundingClientRect();
		}

		function touchDist(t1: Touch, t2: Touch) {
			const dx = t1.clientX - t2.clientX;
			const dy = t1.clientY - t2.clientY;
			return Math.sqrt(dx * dx + dy * dy);
		}

		function touchCenter(t1: Touch, t2: Touch, rect: DOMRect) {
			return {
				x: (t1.clientX + t2.clientX) / 2 - rect.left,
				y: (t1.clientY + t2.clientY) / 2 - rect.top,
			};
		}

		function cancelEngineGesture() {
			if (gesture.type === 'pending-entity' || gesture.type === 'entity-dragging') {
				engine.handlePointerUp();
			}
		}

		const noMods = { shift: false, ctrl: false, alt: false, meta: false };

		function onTouchStart(e: TouchEvent) {
			const rect = getRect();
			const touches = e.touches;

			// --- 2+ fingers → pinch (override everything) ---
			if (touches.length >= 2) {
				e.preventDefault();
				cancelEngineGesture();
				const dist = touchDist(touches[0], touches[1]);
				const center = touchCenter(touches[0], touches[1], rect);
				gesture = { type: 'pinching', lastDist: dist, lastCx: center.x, lastCy: center.y };
				return;
			}

			// --- 1 finger ---
			const touch = touches[0];
			const x = touch.clientX - rect.left;
			const y = touch.clientY - rect.top;

			// Let interactive elements (buttons, inputs) handle their own touch
			if (isInteractive(e.target)) return;

			e.preventDefault();

			// Double-tap detection
			const now = Date.now();
			if (now - lastTapTime < DOUBLE_TAP_MS
				&& Math.abs(x - lastTapX) < DOUBLE_TAP_DIST
				&& Math.abs(y - lastTapY) < DOUBLE_TAP_DIST) {
				lastTapTime = 0;
				// Hit test to check for entity
				const directive = engine.handlePointerDown(x, y, 0, noMods);
				if (directive.action === 'passthrough-track-drag') {
					// Double-tap on entity → enter container
					const selected = engine.getSelectedEntities();
					engine.handlePointerUp();
					if (selected.length === 1) {
						engine.enterContainer(selected[0]);
					}
				} else {
					// Double-tap on empty → zoom step
					engine.handlePointerUp();
					const camera = engine.getCamera();
					const target = camera.zoom < 0.9 ? 1 : camera.zoom < 1.8 ? 2 : 1;
					engine.zoomAtPoint(x, y, (target - camera.zoom) / camera.zoom);
				}
				engine.markDirty();
				gesture = { type: 'idle' };
				return;
			}

			if (isOnWidget(e.target)) {
				// Touch on entity → delegate to engine
				engine.handlePointerDown(x, y, 0, noMods);
				gesture = { type: 'pending-entity', x, y, time: now };
			} else {
				// Touch on empty space → prepare to pan (don't tell engine yet)
				gesture = { type: 'pending-pan', x, y, time: now };
			}
		}

		function onTouchMove(e: TouchEvent) {
			e.preventDefault();
			const rect = getRect();
			const touches = e.touches;

			// --- Pinch ---
			if (gesture.type === 'pinching' && touches.length >= 2) {
				const dist = touchDist(touches[0], touches[1]);
				const center = touchCenter(touches[0], touches[1], rect);
				const scale = dist / gesture.lastDist;
				engine.zoomAtPoint(center.x, center.y, scale - 1);
				engine.panBy(center.x - gesture.lastCx, center.y - gesture.lastCy);
				gesture.lastDist = dist;
				gesture.lastCx = center.x;
				gesture.lastCy = center.y;
				return;
			}

			// Transition to pinch if second finger added
			if (touches.length >= 2) {
				cancelEngineGesture();
				const dist = touchDist(touches[0], touches[1]);
				const center = touchCenter(touches[0], touches[1], rect);
				gesture = { type: 'pinching', lastDist: dist, lastCx: center.x, lastCy: center.y };
				return;
			}

			if (touches.length < 1) return;
			const touch = touches[0];
			const x = touch.clientX - rect.left;
			const y = touch.clientY - rect.top;

			// Pending pan → check dead zone
			if (gesture.type === 'pending-pan') {
				if (Math.abs(x - gesture.x) > DEAD_ZONE || Math.abs(y - gesture.y) > DEAD_ZONE) {
					gesture = { type: 'panning', lastX: x, lastY: y };
				}
				return;
			}

			// Active panning
			if (gesture.type === 'panning') {
				engine.panBy(x - gesture.lastX, y - gesture.lastY);
				gesture.lastX = x;
				gesture.lastY = y;
				return;
			}

			// Entity drag → delegate to engine
			if (gesture.type === 'pending-entity' || gesture.type === 'entity-dragging') {
				engine.handlePointerMove(x, y, noMods);
				if (gesture.type === 'pending-entity') {
					if (Math.abs(x - gesture.x) > DEAD_ZONE || Math.abs(y - gesture.y) > DEAD_ZONE) {
						gesture = { type: 'entity-dragging' };
					}
				}
			}
		}

		function onTouchEnd(e: TouchEvent) {
			e.preventDefault();
			const remaining = e.touches.length;
			const rect = getRect();

			// Pinch → transition based on remaining fingers
			if (gesture.type === 'pinching') {
				if (remaining === 1) {
					const t = e.touches[0];
					gesture = { type: 'panning', lastX: t.clientX - rect.left, lastY: t.clientY - rect.top };
				} else if (remaining === 0) {
					gesture = { type: 'idle' };
				}
				return;
			}

			if (remaining > 0) return;

			// Tap on empty space → deselect
			if (gesture.type === 'pending-pan') {
				engine.handlePointerDown(gesture.x, gesture.y, 0, noMods);
				engine.handlePointerUp();
				engine.markDirty();
				lastTapTime = Date.now();
				lastTapX = gesture.x;
				lastTapY = gesture.y;
			}

			// Tap on entity (no drag) → selection already happened
			if (gesture.type === 'pending-entity') {
				engine.handlePointerUp();
				engine.markDirty();
				lastTapTime = Date.now();
				lastTapX = gesture.x;
				lastTapY = gesture.y;
			}

			// Entity drag end
			if (gesture.type === 'entity-dragging') {
				engine.handlePointerUp();
				engine.markDirty();
			}

			gesture = { type: 'idle' };
		}

		container.addEventListener('touchstart', onTouchStart, { passive: false });
		container.addEventListener('touchmove', onTouchMove, { passive: false });
		container.addEventListener('touchend', onTouchEnd, { passive: false });
		container.addEventListener('touchcancel', onTouchEnd, { passive: false });

		return () => {
			container.removeEventListener('touchstart', onTouchStart);
			container.removeEventListener('touchmove', onTouchMove);
			container.removeEventListener('touchend', onTouchEnd);
			container.removeEventListener('touchcancel', onTouchEnd);
		};
	}, [engine]);

	// Canvas background pointer — empty-space clicks
	const onBackgroundPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (e.target !== e.currentTarget) return; // ignore bubbled events from widgets
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;
			engine.handlePointerDown(e.clientX - rect.left, e.clientY - rect.top, e.button, {
				shift: e.shiftKey,
				ctrl: e.ctrlKey,
				alt: e.altKey,
				meta: e.metaKey,
			});
		},
		[engine],
	);

	const onBackgroundPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;
			engine.handlePointerMove(e.clientX - rect.left, e.clientY - rect.top, {
				shift: e.shiftKey,
				ctrl: e.ctrlKey,
				alt: e.altKey,
				meta: e.metaKey,
			});
		},
		[engine],
	);

	const onBackgroundPointerUp = useCallback(
		(_e: React.PointerEvent) => {
			engine.handlePointerUp();
		},
		[engine],
	);

	// rAF tick loop — flushes the engine when dirty, then applies updates.
	// This is THE render loop. Input handlers set engine dirty; this loop ticks.
	useEffect(() => {
		let rafId: number;
		let running = true;

		function loop() {
			if (!running) return;

			const didTick = engine.flushIfDirty();
			if (didTick) {
				const camera = engine.getCamera();
				const changes = engine.getFrameChanges();

				// 1. Update camera layer CSS transform (O(1) for pan/zoom)
				if (cameraLayerRef.current) {
					cameraLayerRef.current.style.transform =
						`scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
				}

				// 1b. Render WebGL dot grid
				if (gridRendererRef.current) {
					gridRendererRef.current.render(camera.x, camera.y, camera.zoom);
				}

				// 2. Fix #1: Use WorldBounds (world-space) not Transform2D (local/parent-relative)
				for (const entityId of changes.positionsChanged) {
					const el = slotRefs.current.get(entityId);
					if (!el) continue;
					const wb = engine.get(entityId, WorldBounds);
					if (!wb) continue;
					el.style.transform = `translate(${wb.worldX}px, ${wb.worldY}px)`;
					el.style.width = `${wb.worldWidth}px`;
					el.style.height = `${wb.worldHeight}px`;
				}

				// 3. Update visible entity list if entities entered/exited
				if (changes.entered.length > 0 || changes.exited.length > 0) {
					const visible = engine.getVisibleEntities();
					setVisibleEntities(visible.map((v) => v.entityId));
				}
			}

			rafId = requestAnimationFrame(loop);
		}

		// Initial tick on mount
		engine.tick();
		const visible = engine.getVisibleEntities();
		setVisibleEntities(visible.map((v) => v.entityId));

		// Set initial camera transform + grid
		const camera = engine.getCamera();
		if (cameraLayerRef.current) {
			cameraLayerRef.current.style.transform =
				`scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
		}
		// Initial WebGL grid render
		if (gridRendererRef.current) {
			gridRendererRef.current.render(camera.x, camera.y, camera.zoom);
		}

		// Set initial slot positions
		for (const v of visible) {
			const el = slotRefs.current.get(v.entityId);
			if (!el) continue;
			el.style.transform = `translate(${v.worldX}px, ${v.worldY}px)`;
			el.style.width = `${v.worldWidth}px`;
			el.style.height = `${v.worldHeight}px`;
		}

		// Start the loop
		rafId = requestAnimationFrame(loop);

		return () => {
			running = false;
			cancelAnimationFrame(rafId);
		};
	}, [engine]);

	// Fix #4: useLayoutEffect to set initial positions BEFORE browser paint
	// Prevents one-frame flash at (0,0) when new widgets enter the viewport
	useLayoutEffect(() => {
		for (const entityId of visibleEntities) {
			const el = slotRefs.current.get(entityId);
			if (!el) continue;
			const wb = engine.get(entityId, WorldBounds);
			if (!wb) continue;
			el.style.transform = `translate(${wb.worldX}px, ${wb.worldY}px)`;
			el.style.width = `${wb.worldWidth}px`;
			el.style.height = `${wb.worldHeight}px`;
		}
	}, [visibleEntities, engine]);

	// Split visible entities by surface
	const { domEntities, webglEntities } = useMemo(() => {
		const dom: EntityId[] = [];
		const webgl: EntityId[] = [];
		for (const id of visibleEntities) {
			const w = engine.get(id, Widget);
			if (w?.surface === 'webgl') {
				webgl.push(id);
			} else {
				dom.push(id);
			}
		}
		return { domEntities: dom, webglEntities: webgl };
	}, [visibleEntities, engine]);

	return (
		<EngineProvider value={engine}>
			<ContainerRefProvider value={containerRef}>
				<div
					ref={containerRef}
					className={`relative overflow-hidden ${className ?? ''}`}
					style={{
						...style,
						touchAction: 'none',
						backgroundColor: 'var(--canvas-bg, #fafafa)',
					}}
				>
					{/* WebGL layer — dot grid, selection overlays, connections */}
					<canvas
						ref={webglCanvasRef}
						className="absolute inset-0 pointer-events-none"
					/>

					{/* R3F layer — WebGL widgets (lazy, only when webgl entities exist) */}
					{webglEntities.length > 0 && (
						<WebGLWidgetBridge engine={engine} entities={webglEntities} />
					)}

					{/* Background — handles empty-space pointer events (deselect, marquee) */}
					<div
						className="absolute inset-0"
						onPointerDown={onBackgroundPointerDown}
						onPointerMove={onBackgroundPointerMove}
						onPointerUp={onBackgroundPointerUp}
					/>

					{/* Camera transform layer — DOM widgets + selection overlays for WebGL widgets */}
					<div
						ref={cameraLayerRef}
						className="absolute left-0 top-0 origin-top-left will-change-transform"
					>
						{domEntities.map((entityId) => (
							<WidgetSlot
								key={entityId}
								entityId={entityId}
								slotRef={registerSlotRef}
							/>
						))}
						{webglEntities.map((entityId) => (
							<SelectionOverlaySlot
								key={entityId}
								entityId={entityId}
								slotRef={registerSlotRef}
							/>
						))}
					</div>

					{/* Children: widget providers, toolbars, etc. */}
					{children}
				</div>
			</ContainerRefProvider>
		</EngineProvider>
	);
}

/** Bridge component — reads widget resolver from context and passes to WebGLWidgetLayer */
function WebGLWidgetBridge({ engine, entities }: { engine: CanvasEngine; entities: EntityId[] }) {
	const resolver = useWidgetResolver();
	const resolve = useCallback(
		(entityId: EntityId) => {
			if (!resolver) return null;
			const w = engine.get(entityId, Widget);
			return resolver(entityId, w?.type ?? '');
		},
		[resolver, engine],
	);

	if (!resolver) return null;

	return <WebGLWidgetLayer engine={engine} entities={entities} resolve={resolve} />;
}
