import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Vector2 } from 'three';
import { Widget, WorldBounds } from '../components.js';
import type { EntityId } from '../ecs/types.js';
import type { LayoutEngine } from '../engine.js';
import { DEAD_ZONE_TOUCH_PX } from '../interaction-constants.js';
import { CursorResource, NavigationStackResource } from '../resources.js';
import { SelectionOverlaySlot } from './SelectionOverlaySlot.js';
import { WidgetProvider } from './WidgetProvider.js';
import { WidgetSlot } from './WidgetSlot.js';
import { ContainerRefProvider, EngineProvider, useWidgetResolver } from './context.js';
import { createWidgetRegistry } from './registry.js';
import type { WidgetDef } from './registry.js';
import { GridRenderer } from './webgl/GridRenderer.js';
import type { GridConfig } from './webgl/GridRenderer.js';
import { SelectionRenderer } from './webgl/SelectionRenderer.js';
import type { SelectionBounds, SelectionConfig } from './webgl/SelectionRenderer.js';
import { WebGLWidgetLayer } from './webgl/WebGLWidgetLayer.js';

/** Imperative handle exposed via `ref` on InfiniteCanvas for programmatic control. */
export interface InfiniteCanvasHandle {
	/** Moves the camera to the specified world coordinates. */
	panTo(worldX: number, worldY: number): void;
	/** Sets the zoom level directly. */
	zoomTo(zoom: number): void;
	/** Adjusts camera to fit all entities in the viewport. */
	zoomToFit(padding?: number): void;
	/** Undoes the last command or command group. */
	undo(): void;
	/** Redoes the last undone command. */
	redo(): void;
	/** Returns the underlying LayoutEngine instance. */
	getEngine(): LayoutEngine;
}

/** Props for the InfiniteCanvas component. */
interface InfiniteCanvasProps {
	/** The LayoutEngine instance powering this canvas. Create with `createLayoutEngine()`. */
	engine: LayoutEngine;
	/** Widget definitions. When provided, a WidgetProvider is created internally. */
	widgets?: WidgetDef[];
	/** Grid configuration. Pass `false` to disable the grid entirely. */
	grid?: Partial<GridConfig> | false;
	/** Selection highlight style configuration. */
	selection?: Partial<SelectionConfig>;
	/** Called when the set of selected entities changes. */
	onSelectionChange?: (entityIds: EntityId[]) => void;
	/** Called when the camera (pan/zoom) changes. */
	onCameraChange?: (camera: { x: number; y: number; zoom: number }) => void;
	/** Called when navigation depth changes (entering/exiting containers). */
	onNavigationChange?: (depth: number, containerId: EntityId | null) => void;
	/** CSS class name applied to the root container div. */
	className?: string;
	/** Inline styles applied to the root container div. */
	style?: React.CSSProperties;
	/** Overlay children (toolbars, panels) rendered on top of the canvas. */
	children?: React.ReactNode;
}

export const InfiniteCanvas = React.forwardRef<InfiniteCanvasHandle, InfiniteCanvasProps>(function InfiniteCanvas({
	engine,
	widgets,
	grid,
	selection,
	onSelectionChange,
	onCameraChange,
	onNavigationChange,
	className,
	style,
	children,
}, ref) {
	const containerRef = useRef<HTMLDivElement>(null);

	// Keep latest callback refs to avoid stale closures in the rAF loop
	const onSelectionChangeRef = useRef(onSelectionChange);
	const onCameraChangeRef = useRef(onCameraChange);
	const onNavigationChangeRef = useRef(onNavigationChange);
	useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
	useEffect(() => { onCameraChangeRef.current = onCameraChange; }, [onCameraChange]);
	useEffect(() => { onNavigationChangeRef.current = onNavigationChange; }, [onNavigationChange]);

	// Imperative handle
	useImperativeHandle(ref, () => ({
		panTo: (x, y) => { engine.panTo(x, y); engine.markDirty(); },
		zoomTo: (zoom) => { engine.zoomTo(zoom); engine.markDirty(); },
		zoomToFit: (padding) => { engine.zoomToFit(undefined, padding); engine.markDirty(); },
		undo: () => { engine.undo(); engine.markDirty(); },
		redo: () => { engine.redo(); engine.markDirty(); },
		getEngine: () => engine,
	}), [engine]);

	// When widgets prop is provided, create an internal registry.
	// Use a stable key derived from widget types so inline array literals
	// don't cause registry recreation on every render.
	const widgetKey = widgets?.map((w) => w.type).join('\0');
	const internalRegistry = useMemo(
		() => (widgets ? createWidgetRegistry(widgets) : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[widgetKey],
	);
	const webglCanvasRef = useRef<HTMLCanvasElement>(null);
	const gridRendererRef = useRef<GridRenderer | null>(null);
	const selectionRendererRef = useRef<SelectionRenderer | null>(null);
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

		// SelectionRenderer shares the WebGLRenderer from GridRenderer
		const selInst = new SelectionRenderer();
		selectionRendererRef.current = selInst;

		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio;
			engine.setViewport(rect.width, rect.height, dpr);
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
			if (gridInst) {
				gridInst.setSize(rect.width, rect.height, dpr);
			}
			selInst.setSize(new Vector2(rect.width * dpr, rect.height * dpr), dpr);
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
			selInst.dispose();
			selectionRendererRef.current = null;
		};
	}, [engine, grid]);

	// Apply grid + selection config on every render
	useEffect(() => {
		const gridR = gridRendererRef.current;
		if (gridR && grid !== false) {
			const isDark = document.documentElement.classList.contains('dark');
			gridR.setConfig({
				dotColor: isDark ? [1, 1, 1] : [0, 0, 0],
				dotAlpha: isDark ? 0.12 : 0.18,
				...grid,
			});
		}
		const selR = selectionRendererRef.current;
		if (selR && selection) {
			selR.setConfig(selection);
		}
		engine.markDirty();
	}, [engine, grid, selection]);

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
			return (
				tag === 'INPUT' ||
				tag === 'TEXTAREA' ||
				tag === 'BUTTON' ||
				tag === 'SELECT' ||
				el.isContentEditable ||
				el.closest('button') !== null
			);
		}

		function getRect() {
			return container?.getBoundingClientRect() ?? new DOMRect();
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
			if (
				now - lastTapTime < DOUBLE_TAP_MS &&
				Math.abs(x - lastTapX) < DOUBLE_TAP_DIST &&
				Math.abs(y - lastTapY) < DOUBLE_TAP_DIST
			) {
				lastTapTime = 0;
				// Hit test to check for entity
				const directive = engine.handlePointerDown(x, y, 0, noMods);
				try {
					if (directive.action === 'passthrough-track-drag') {
						// Double-tap on entity → enter container
						const selected = engine.getSelectedEntities();
						if (selected.length === 1) {
							engine.enterContainer(selected[0]);
						}
					} else {
						// Double-tap on empty → zoom step
						const camera = engine.getCamera();
						const target = camera.zoom < 0.9 ? 1 : camera.zoom < 1.8 ? 2 : 1;
						engine.zoomAtPoint(x, y, (target - camera.zoom) / camera.zoom);
					}
				} finally {
					engine.handlePointerUp();
					engine.markDirty();
				}
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
				if (
					Math.abs(x - gesture.x) > DEAD_ZONE_TOUCH_PX ||
					Math.abs(y - gesture.y) > DEAD_ZONE_TOUCH_PX
				) {
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
					if (
						Math.abs(x - gesture.x) > DEAD_ZONE_TOUCH_PX ||
						Math.abs(y - gesture.y) > DEAD_ZONE_TOUCH_PX
					) {
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

		function onTouchCancel(_e: TouchEvent) {
			// Reset gesture state unconditionally — the browser cancelled the touch.
			// Unlike onTouchEnd we don't inspect e.touches (which may be empty).
			gesture = { type: 'idle' };
			engine.handlePointerCancel();
		}

		container.addEventListener('touchstart', onTouchStart, { passive: false });
		container.addEventListener('touchmove', onTouchMove, { passive: false });
		container.addEventListener('touchend', onTouchEnd, { passive: false });
		container.addEventListener('touchcancel', onTouchCancel, { passive: true });

		return () => {
			container.removeEventListener('touchstart', onTouchStart);
			container.removeEventListener('touchmove', onTouchMove);
			container.removeEventListener('touchend', onTouchEnd);
			container.removeEventListener('touchcancel', onTouchCancel);
		};
	}, [engine]);

	// Canvas-level pointer handlers — attached to the root container div so
	// pointer events in the "outside handle strip" (handle hit zone that
	// extends beyond a widget slot's DOM bounds) reach the engine. Widget
	// slots still have their own handlers and stopPropagation, so events
	// inside widgets never reach these fallbacks.
	const onCanvasPointerDown = useCallback(
		(e: React.PointerEvent) => {
			const target = e.target as HTMLElement | null;
			// Respect interactive form elements inside widget children.
			if (target?.closest('button, input, textarea, select, [contenteditable]')) return;
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const directive = engine.handlePointerDown(
				e.clientX - rect.left,
				e.clientY - rect.top,
				e.button,
				{
					shift: e.shiftKey,
					ctrl: e.ctrlKey,
					alt: e.altKey,
					meta: e.metaKey,
				},
			);
			// Capture on the container so subsequent moves route here even when
			// the pointer leaves the viewport. Widget slot already captures for
			// events that reach it first; this is for empty-space / outside-strip
			// events that bypass widget slots.
			if (directive.action === 'capture-resize' || directive.action === 'passthrough-track-drag') {
				containerRef.current?.setPointerCapture(e.pointerId);
			}
			if (directive.action === 'capture-resize') e.preventDefault();
		},
		[engine],
	);

	const onCanvasPointerMove = useCallback(
		(e: React.PointerEvent) => {
			// Skip if a widget slot is handling this pointer — avoids double
			// handlePointerMove when the event bubbles from a captured widget.
			const target = e.target as HTMLElement;
			if (target.closest?.('[data-widget-slot]') && target !== containerRef.current) {
				return;
			}
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

	const onCanvasPointerUp = useCallback(
		(e: React.PointerEvent) => {
			if (containerRef.current?.hasPointerCapture(e.pointerId)) {
				containerRef.current.releasePointerCapture(e.pointerId);
			}
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
					cameraLayerRef.current.style.transform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
				}

				// RFC-001 Phase 7: apply derived cursor to root container.
				// Equality guard avoids redundant DOM writes in devtools diffs.
				const cursor = engine.world.getResource(CursorResource).cursor;
				if (containerRef.current && containerRef.current.style.cursor !== cursor) {
					containerRef.current.style.cursor = cursor;
				}

				// 1b. Render WebGL dot grid + selection
				if (gridRendererRef.current) {
					gridRendererRef.current.render(camera.x, camera.y, camera.zoom);
				}
				if (selectionRendererRef.current && gridRendererRef.current) {
					const selected = engine.getSelectedEntities();
					const selBounds: SelectionBounds[] = [];
					for (const id of selected) {
						const wb = engine.get(id, WorldBounds);
						if (wb)
							selBounds.push({
								x: wb.worldX,
								y: wb.worldY,
								width: wb.worldWidth,
								height: wb.worldHeight,
							});
					}
					const hovId = engine.getHoveredEntity();
					let hovBounds: SelectionBounds | null = null;
					if (hovId !== null) {
						const wb = engine.get(hovId, WorldBounds);
						if (wb)
							hovBounds = {
								x: wb.worldX,
								y: wb.worldY,
								width: wb.worldWidth,
								height: wb.worldHeight,
							};
					}
					selectionRendererRef.current.render(
						gridRendererRef.current.getWebGLRenderer(),
						camera.x,
						camera.y,
						camera.zoom,
						selBounds,
						hovBounds,
						engine.getSnapGuides(),
						engine.getEqualSpacing(),
					);
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

				// 4. Fire event callbacks
				if (changes.selectionChanged && onSelectionChangeRef.current) {
					onSelectionChangeRef.current(engine.getSelectedEntities());
				}
				if (changes.cameraChanged && onCameraChangeRef.current) {
					onCameraChangeRef.current({ x: camera.x, y: camera.y, zoom: camera.zoom });
				}
				if (changes.navigationChanged && onNavigationChangeRef.current) {
					const navStack = engine.world.getResource(NavigationStackResource);
					const depth = navStack.frames.length - 1;
					const containerId = navStack.frames[navStack.frames.length - 1].containerId;
					onNavigationChangeRef.current(depth, containerId);
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
			cameraLayerRef.current.style.transform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
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

	const canvasContent = (
		<div
			ref={containerRef}
			className={`relative overflow-hidden ${className ?? ''}`}
			style={{
				...style,
				touchAction: 'none',
				backgroundColor: 'var(--canvas-bg, #fafafa)',
			}}
			onPointerDown={onCanvasPointerDown}
			onPointerMove={onCanvasPointerMove}
			onPointerUp={onCanvasPointerUp}
		>
			{/* WebGL layer — dot grid, selection overlays, connections */}
			<canvas ref={webglCanvasRef} className="absolute inset-0 pointer-events-none" />

			{/* R3F layer — WebGL widgets (lazy, only when webgl entities exist) */}
			{webglEntities.length > 0 && <WebGLWidgetBridge engine={engine} entities={webglEntities} />}

			{/* Background — purely visual; pointer handlers live on the container.
			    Kept as a div so the paint order (canvas, background, camera layer)
			    is stable and future background visuals have a dedicated layer. */}
			<div className="absolute inset-0 pointer-events-none" />

			{/* Camera transform layer — DOM widgets + selection overlays for WebGL widgets */}
			<div
				ref={cameraLayerRef}
				className="absolute left-0 top-0 origin-top-left will-change-transform"
			>
				{domEntities.map((entityId) => (
					<WidgetSlot key={entityId} entityId={entityId} slotRef={registerSlotRef} />
				))}
				{webglEntities.map((entityId) => (
					<SelectionOverlaySlot key={entityId} entityId={entityId} slotRef={registerSlotRef} />
				))}
			</div>

			{/* Children: toolbars, panels, etc. */}
			{children}
		</div>
	);

	return (
		<EngineProvider value={engine}>
			<ContainerRefProvider value={containerRef}>
				{internalRegistry ? (
					<WidgetProvider registry={internalRegistry}>{canvasContent}</WidgetProvider>
				) : (
					canvasContent
				)}
			</ContainerRefProvider>
		</EngineProvider>
	);
});

/** Bridge component — reads widget resolver from context and passes to WebGLWidgetLayer */
function WebGLWidgetBridge({ engine, entities }: { engine: LayoutEngine; entities: EntityId[] }) {
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
