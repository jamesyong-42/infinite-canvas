import type { EntityId } from '@jamesyong42/reactive-ecs';
import React, {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Layer, SelectionFrame, Transform2D, Widget, ZIndex } from '../ecs/components.js';
import type { LayoutEngine } from '../ecs/engine/index.js';
import { DEAD_ZONE_TOUCH_PX } from '../ecs/interaction-constants.js';
import { CursorResource, NavigationStackResource } from '../ecs/resources.js';
import { R3FManager } from '../r3f/R3FManager.js';
import type { GridConfig } from '../webgl/renderers/GridRenderer.js';
import type { SelectionBounds, SelectionConfig } from '../webgl/renderers/SelectionRenderer.js';
import type { SnapGuideConfig } from '../webgl/renderers/SnapGuideRenderer.js';
import { WebGLManager } from '../webgl/WebGLManager.js';
import { ContainerRefProvider } from './context/container-ref-context.js';
import { EngineProvider } from './context/engine-context.js';
import { useWidgetResolver } from './context/widget-resolver-context.js';
import { SelectionOverlaySlot } from './overlays/SelectionOverlaySlot.js';
import { PointerEventBus } from './PointerEventBus.js';
import {
	applyOverlapGlowShaderUniforms,
	applyOverlapGlowVars,
	mergeOverlapGlow,
	type OverlapGlowConfig,
} from './widgets/overlap-glow.js';
import { WidgetProvider } from './widgets/WidgetProvider.js';
import { WidgetSlot } from './widgets/WidgetSlot.js';

/** Imperative handle exposed via `ref` on InfiniteCanvas for programmatic control. */
export interface InfiniteCanvasHandle {
	panTo(worldX: number, worldY: number): void;
	zoomTo(zoom: number): void;
	zoomToFit(padding?: number): void;
	undo(): void;
	redo(): void;
	getEngine(): LayoutEngine;
}

interface InfiniteCanvasProps {
	/**
	 * The LayoutEngine instance powering this canvas. Create with `createLayoutEngine()`.
	 */
	engine: LayoutEngine;
	/** Grid configuration. Pass `false` to disable the grid entirely. */
	grid?: Partial<GridConfig> | false;
	/**
	 * Drag-over glow configuration — controls every visual parameter of
	 * the highlight applied to a card while another card is being dragged
	 * over it. Drives both the DOM `CardChrome` (via CSS custom
	 * properties on the canvas container) and the R3F compositor shader
	 * (via shared uniforms) so the look stays in sync across widget
	 * surfaces.
	 */
	overlapGlow?: Partial<OverlapGlowConfig>;
	/** Selection highlight style configuration. */
	selection?: Partial<SelectionConfig>;
	/** Snap guide overlay style (color, line width, alpha). */
	snapGuides?: Partial<SnapGuideConfig>;
	onSelectionChange?: (entityIds: EntityId[]) => void;
	onCameraChange?: (camera: { x: number; y: number; zoom: number }) => void;
	onNavigationChange?: (depth: number, containerId: EntityId | null) => void;
	className?: string;
	style?: React.CSSProperties;
	children?: React.ReactNode;
	/**
	 * R3F nodes mounted at the root of the internal `<Canvas>`, as siblings
	 * of the widget compositor. Use this for canvas-level Three.js state
	 * that must survive widget lifecycle — drei's `<Environment>` is the
	 * canonical case: mounting it in a widget ties global IBL to that
	 * widget's `Active` state, so consuming it into a folder or
	 * navigating away kills lighting for every other widget. A root-level
	 * `<Environment>` stays mounted as long as the canvas itself is, and
	 * the compositor propagates its texture to every per-widget scene.
	 */
	r3fRoot?: React.ReactNode;
}

export const InfiniteCanvas = React.forwardRef<InfiniteCanvasHandle, InfiniteCanvasProps>(
	function InfiniteCanvas(
		{
			engine,
			grid,
			overlapGlow,
			selection,
			snapGuides,
			onSelectionChange,
			onCameraChange,
			onNavigationChange,
			className,
			style,
			children,
			r3fRoot,
		},
		ref,
	) {
		const containerRef = useRef<HTMLDivElement>(null);
		// R3F's `<Canvas eventSource={ref}>` resolves `ref.current` once at
		// canvas-init time. Mounting R3FBridge before the container ref is
		// populated would leave R3F unable to attach its native pointer
		// listeners. This flag flips true after the first commit, when the
		// container's ref is guaranteed to be assigned.
		const [containerMounted, setContainerMounted] = useState(false);
		useLayoutEffect(() => {
			setContainerMounted(true);
		}, []);

		// Keep latest callback refs to avoid stale closures in the rAF loop
		const onSelectionChangeRef = useRef(onSelectionChange);
		const onCameraChangeRef = useRef(onCameraChange);
		const onNavigationChangeRef = useRef(onNavigationChange);
		useEffect(() => {
			onSelectionChangeRef.current = onSelectionChange;
		}, [onSelectionChange]);
		useEffect(() => {
			onCameraChangeRef.current = onCameraChange;
		}, [onCameraChange]);
		useEffect(() => {
			onNavigationChangeRef.current = onNavigationChange;
		}, [onNavigationChange]);

		// Latest renderer-style refs so the WebGLManager can be constructed
		// with the user's initial config on first mount, without taking
		// `selection` / `snapGuides` as deps of the mount effect (which
		// would tear down + rebuild the GL context on every prop change).
		// Runtime updates still flow through the dedicated useEffect below.
		const selectionRef = useRef(selection);
		const snapGuidesRef = useRef(snapGuides);
		useEffect(() => {
			selectionRef.current = selection;
		}, [selection]);
		useEffect(() => {
			snapGuidesRef.current = snapGuides;
		}, [snapGuides]);

		useImperativeHandle(
			ref,
			() => ({
				panTo: (x, y) => {
					engine.panTo(x, y);
					engine.markDirty();
				},
				zoomTo: (zoom) => {
					engine.zoomTo(zoom);
					engine.markDirty();
				},
				zoomToFit: (padding) => {
					engine.zoomToFit(undefined, padding);
					engine.markDirty();
				},
				undo: () => {
					engine.undo();
					engine.markDirty();
				},
				redo: () => {
					engine.redo();
					engine.markDirty();
				},
				getEngine: () => engine,
			}),
			[engine],
		);

		const webglCanvasRef = useRef<HTMLCanvasElement>(null);
		const webglManagerRef = useRef<WebGLManager | null>(null);
		// One transform ref per layer container — all driven by the same
		// camera transform so they pan / zoom in lockstep. RFC-003.
		const backgroundLayerRef = useRef<HTMLDivElement>(null);
		const baseLayerRef = useRef<HTMLDivElement>(null);
		const overlayLayerRef = useRef<HTMLDivElement>(null);
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

		// Initialise WebGLManager + viewport on mount/resize.
		useLayoutEffect(() => {
			const container = containerRef.current;
			const canvas = webglCanvasRef.current;
			if (!container || !canvas) return;

			const manager = new WebGLManager(canvas, {
				grid,
				selection: selectionRef.current,
				snapGuides: snapGuidesRef.current,
			});
			webglManagerRef.current = manager;

			const updateSize = () => {
				const rect = container.getBoundingClientRect();
				const dpr = window.devicePixelRatio;
				engine.setViewport(rect.width, rect.height, dpr);
				canvas.style.width = `${rect.width}px`;
				canvas.style.height = `${rect.height}px`;
				manager.setSize(rect.width, rect.height, dpr);
			};

			updateSize();
			const observer = new ResizeObserver(updateSize);
			observer.observe(container);
			return () => {
				observer.disconnect();
				manager.dispose();
				webglManagerRef.current = null;
			};
		}, [engine, grid]);

		// Apply grid + selection config on every render
		useEffect(() => {
			const manager = webglManagerRef.current;
			if (!manager) return;
			if (grid !== false) {
				const isDark = document.documentElement.classList.contains('dark');
				manager.setGridConfig({
					// Soft neutral gray — matches Apple Freeform / FigJam look.
					// Dark-mode value is slightly desaturated to read well on
					// near-black backgrounds without blooming.
					dotColor: isDark ? [0.35, 0.37, 0.4] : [0.75, 0.77, 0.8],
					dotAlpha: 1.0,
					...grid,
				});
			}
			if (selection) {
				manager.setSelectionConfig(selection);
			}
			if (snapGuides) {
				manager.setSnapGuideConfig(snapGuides);
			}
			engine.markDirty();
		}, [engine, grid, selection, snapGuides]);

		// Apply overlap-glow config: write CSS vars on the canvas container
		// (DOM `CardChrome` reads them), and push the same values into the
		// shared shader uniforms (R3F `CompositionMaterial` reads them).
		// Both paths see the change without re-mounting anything.
		useEffect(() => {
			const merged = mergeOverlapGlow(overlapGlow);
			const container = containerRef.current;
			if (container) applyOverlapGlowVars(container, merged);
			applyOverlapGlowShaderUniforms(merged);
			engine.markDirty();
		}, [engine, overlapGlow]);

		// Wheel handler — pan/zoom (always active)
		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			let wheelGestureTimer: ReturnType<typeof setTimeout> | null = null;
			const WHEEL_GESTURE_IDLE_MS = 200;
			const onWheel = (e: WheelEvent) => {
				e.preventDefault();
				if (e.ctrlKey || e.metaKey) {
					const rect = container.getBoundingClientRect();
					engine.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, -e.deltaY * 0.01);
				} else {
					engine.panBy(-e.deltaX, -e.deltaY);
				}
				// Wheel events are discrete; debounce them into a continuous
				// "gesturing" window so render layers can defer expensive work
				// (zoom-band repaints, etc.) until the user stops scrolling.
				engine.setGesturing(true);
				if (wheelGestureTimer !== null) clearTimeout(wheelGestureTimer);
				wheelGestureTimer = setTimeout(() => {
					engine.setGesturing(false);
					wheelGestureTimer = null;
				}, WHEEL_GESTURE_IDLE_MS);
			};

			container.addEventListener('wheel', onWheel, { passive: false });
			return () => {
				container.removeEventListener('wheel', onWheel);
				if (wheelGestureTimer !== null) clearTimeout(wheelGestureTimer);
				engine.setGesturing(false);
			};
		}, [engine]);

		// Touch gesture handler — iOS Freeform-style interactions
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

				if (touches.length >= 2) {
					e.preventDefault();
					cancelEngineGesture();
					const dist = touchDist(touches[0], touches[1]);
					const center = touchCenter(touches[0], touches[1], rect);
					gesture = { type: 'pinching', lastDist: dist, lastCx: center.x, lastCy: center.y };
					return;
				}

				const touch = touches[0];
				const x = touch.clientX - rect.left;
				const y = touch.clientY - rect.top;

				if (isInteractive(e.target)) return;

				e.preventDefault();

				const now = Date.now();
				if (
					now - lastTapTime < DOUBLE_TAP_MS &&
					Math.abs(x - lastTapX) < DOUBLE_TAP_DIST &&
					Math.abs(y - lastTapY) < DOUBLE_TAP_DIST
				) {
					lastTapTime = 0;
					const directive = engine.handlePointerDown(x, y, 0, noMods);
					try {
						if (directive.action === 'passthrough-track-drag') {
							const selected = engine.getSelectedEntities();
							if (selected.length === 1) {
								engine.enterContainer(selected[0]);
							}
						} else {
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
					engine.handlePointerDown(x, y, 0, noMods);
					gesture = { type: 'pending-entity', x, y, time: now };
				} else {
					gesture = { type: 'pending-pan', x, y, time: now };
				}
			}

			function onTouchMove(e: TouchEvent) {
				e.preventDefault();
				const rect = getRect();
				const touches = e.touches;

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

				if (gesture.type === 'pending-pan') {
					if (
						Math.abs(x - gesture.x) > DEAD_ZONE_TOUCH_PX ||
						Math.abs(y - gesture.y) > DEAD_ZONE_TOUCH_PX
					) {
						gesture = { type: 'panning', lastX: x, lastY: y };
					}
					return;
				}

				if (gesture.type === 'panning') {
					engine.panBy(x - gesture.lastX, y - gesture.lastY);
					gesture.lastX = x;
					gesture.lastY = y;
					return;
				}

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

				if (gesture.type === 'pinching') {
					if (remaining === 1) {
						const t = e.touches[0];
						gesture = {
							type: 'panning',
							lastX: t.clientX - rect.left,
							lastY: t.clientY - rect.top,
						};
					} else if (remaining === 0) {
						gesture = { type: 'idle' };
					}
					return;
				}

				if (remaining > 0) return;

				if (gesture.type === 'pending-pan') {
					engine.handlePointerDown(gesture.x, gesture.y, 0, noMods);
					engine.handlePointerUp();
					engine.markDirty();
					lastTapTime = Date.now();
					lastTapX = gesture.x;
					lastTapY = gesture.y;
				}

				if (gesture.type === 'pending-entity') {
					engine.handlePointerUp();
					engine.markDirty();
					lastTapTime = Date.now();
					lastTapX = gesture.x;
					lastTapY = gesture.y;
				}

				if (gesture.type === 'entity-dragging') {
					engine.handlePointerUp();
					engine.markDirty();
				}

				gesture = { type: 'idle' };
			}

			function onTouchCancel(_e: TouchEvent) {
				gesture = { type: 'idle' };
				engine.handlePointerCancel();
			}

			// View-manipulation gestures (pinch / two-finger pan) toggle the
			// engine's gesturing flag so render layers can defer expensive
			// work. Sync after each touch event — setGesturing is idempotent.
			//
			// `false` is debounced with the same idle window as the wheel
			// handler so rapid pinch cycles don't trigger a band-repaint
			// storm between gestures. `true` is set immediately so the
			// deferral takes effect on the very first frame of a new gesture.
			let touchGestureClearTimer: ReturnType<typeof setTimeout> | null = null;
			const TOUCH_GESTURE_IDLE_MS = 200;
			function syncGesturing() {
				const isView = gesture.type === 'pinching' || gesture.type === 'panning';
				if (isView) {
					if (touchGestureClearTimer !== null) {
						clearTimeout(touchGestureClearTimer);
						touchGestureClearTimer = null;
					}
					engine.setGesturing(true);
				} else if (touchGestureClearTimer === null) {
					touchGestureClearTimer = setTimeout(() => {
						engine.setGesturing(false);
						touchGestureClearTimer = null;
					}, TOUCH_GESTURE_IDLE_MS);
				}
			}
			function wrap<T extends (e: TouchEvent) => void>(fn: T): T {
				// try/finally guarantees syncGesturing fires even if the
				// inner handler throws — without it, a thrown handler would
				// leave the gesturing flag stuck on its previous value.
				return ((e: TouchEvent) => {
					try {
						fn(e);
					} finally {
						syncGesturing();
					}
				}) as T;
			}

			const touchStart = wrap(onTouchStart);
			const touchMove = wrap(onTouchMove);
			const touchEnd = wrap(onTouchEnd);
			const touchCancel = wrap(onTouchCancel);

			container.addEventListener('touchstart', touchStart, { passive: false });
			container.addEventListener('touchmove', touchMove, { passive: false });
			container.addEventListener('touchend', touchEnd, { passive: false });
			container.addEventListener('touchcancel', touchCancel, { passive: true });

			return () => {
				container.removeEventListener('touchstart', touchStart);
				container.removeEventListener('touchmove', touchMove);
				container.removeEventListener('touchend', touchEnd);
				container.removeEventListener('touchcancel', touchCancel);
				if (touchGestureClearTimer !== null) {
					clearTimeout(touchGestureClearTimer);
					touchGestureClearTimer = null;
				}
				engine.setGesturing(false);
			};
		}, [engine]);

		// All canvas-container engine pointer-routing flows through the bus
		// (RFC-006). Slot-level pointer handlers still call the engine in
		// Phase 1 — the bus only sees events that bubble up unstopped, so
		// behaviour matches today's container handlers exactly.
		const pointerBus = useMemo(
			() => new PointerEventBus(engine, () => containerRef.current),
			[engine],
		);

		// rAF tick loop — flushes the engine when dirty, then applies updates.
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
					const transform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
					if (backgroundLayerRef.current) backgroundLayerRef.current.style.transform = transform;
					if (baseLayerRef.current) baseLayerRef.current.style.transform = transform;
					if (overlayLayerRef.current) overlayLayerRef.current.style.transform = transform;

					// RFC-001 Phase 7: apply derived cursor to root container.
					const cursor = engine.world.getResource(CursorResource).cursor;
					if (containerRef.current && containerRef.current.style.cursor !== cursor) {
						containerRef.current.style.cursor = cursor;
					}

					// 1b. Drive WebGL layer via the manager — grid + selection + profiler.
					const manager = webglManagerRef.current;
					if (manager) {
						const selectedIds = engine.getSelectedEntities();
						const selBounds: SelectionBounds[] = [];
						for (const id of selectedIds) {
							// Widgets that render their own chrome (e.g. cards) opt out
							// of the engine-drawn frame by lacking the SelectionFrame tag.
							if (!engine.has(id, SelectionFrame)) continue;
							const t = engine.get(id, Transform2D);
							if (t)
								selBounds.push({
									x: t.x,
									y: t.y,
									width: t.width,
									height: t.height,
								});
						}
						const hovId = engine.getHoveredEntity();
						let hovBounds: SelectionBounds | null = null;
						if (hovId !== null && engine.has(hovId, SelectionFrame)) {
							const t = engine.get(hovId, Transform2D);
							if (t)
								hovBounds = {
									x: t.x,
									y: t.y,
									width: t.width,
									height: t.height,
								};
						}

						manager.render({
							camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
							selection: {
								bounds: selBounds,
								hovered: hovBounds,
							},
							snap: {
								guides: engine.getSnapGuides(),
								spacings: engine.getEqualSpacing(),
								visible: engine.getSnapGuidesVisible(),
							},
							profiler: engine.profiler,
							domPositionsUpdated: changes.positionsChanged.length,
						});
					}

					// 2. Push frame-local Transform2D changes into each slot's style.
					//    (Post-RFC-004 Phase 0b there's no `WorldBounds` shadow —
					//    Transform2D is already in the current frame's coord system.)
					for (const entityId of changes.positionsChanged) {
						const el = slotRefs.current.get(entityId);
						if (!el) continue;
						const t = engine.get(entityId, Transform2D);
						if (!t) continue;
						el.style.transform = `translate(${t.x}px, ${t.y}px)`;
						el.style.width = `${t.width}px`;
						el.style.height = `${t.height}px`;
					}

					// 2b. Push ZIndex changes to CSS z-index so drag-bumped R3F
					//     cards lift above their siblings. DOM cards also pick
					//     this up — the Layer re-bucket alone isn't enough when
					//     two cards share a layer; ZIndex is the tiebreak. R3F
					//     cards skip the Layer-promote path (RFC-003) so ZIndex
					//     is their only lift signal on the CSS chrome.
					for (const entityId of changes.zIndicesChanged) {
						const el = slotRefs.current.get(entityId);
						if (!el) continue;
						const z = engine.get(entityId, ZIndex);
						el.style.zIndex = z ? String(z.value) : '';
					}

					// 3. Update visible entity list if entities entered/exited,
					// or any visible entity's Layer component changed (re-bucket
					// trigger for RFC-003 dragPromoteSystem).
					if (changes.entered.length > 0 || changes.exited.length > 0 || changes.layersChanged) {
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

			// Set initial camera transform
			const camera = engine.getCamera();
			const initTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
			if (backgroundLayerRef.current) backgroundLayerRef.current.style.transform = initTransform;
			if (baseLayerRef.current) baseLayerRef.current.style.transform = initTransform;
			if (overlayLayerRef.current) overlayLayerRef.current.style.transform = initTransform;

			// Initial WebGL render
			const manager = webglManagerRef.current;
			if (manager) {
				manager.render({
					camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
					selection: { bounds: [], hovered: null },
					snap: { guides: [], spacings: [], visible: false },
				});
			}

			// Set initial slot positions
			for (const v of visible) {
				const el = slotRefs.current.get(v.entityId);
				if (!el) continue;
				el.style.transform = `translate(${v.x}px, ${v.y}px)`;
				el.style.width = `${v.width}px`;
				el.style.height = `${v.height}px`;
				el.style.zIndex = String(v.zIndex);
			}

			rafId = requestAnimationFrame(loop);

			return () => {
				running = false;
				cancelAnimationFrame(rafId);
			};
		}, [engine]);

		// Fix #4: useLayoutEffect to set initial positions BEFORE browser paint
		useLayoutEffect(() => {
			for (const entityId of visibleEntities) {
				const el = slotRefs.current.get(entityId);
				if (!el) continue;
				const t = engine.get(entityId, Transform2D);
				if (!t) continue;
				el.style.transform = `translate(${t.x}px, ${t.y}px)`;
				el.style.width = `${t.width}px`;
				el.style.height = `${t.height}px`;
				const z = engine.get(entityId, ZIndex);
				if (z) el.style.zIndex = String(z.value);
			}
		}, [visibleEntities, engine]);

		// Split visible entities by surface AND by layer (RFC-003).
		// DOM widgets bucket directly into their target layer container.
		// R3F widgets always render through the R3F canvas; their
		// SelectionOverlaySlot (chrome + interaction surface) buckets into
		// the layer container matching their Layer.name.
		//
		// Re-bucket runs when visibleEntities ref changes — driven by the
		// rAF loop, which now calls setVisibleEntities on entered/exited
		// OR FrameChanges.layersChanged. The latter fires whenever any
		// entity's Layer component value changed during the tick (RFC-003
		// dragPromoteSystem flip / restore).
		const { backgroundDom, baseDom, overlayDom, webglEntities } = useMemo(() => {
			const background: EntityId[] = [];
			const base: EntityId[] = [];
			const overlay: EntityId[] = [];
			const webgl: EntityId[] = [];
			for (const id of visibleEntities) {
				const w = engine.get(id, Widget);
				if (w?.surface === 'webgl') webgl.push(id);
				const layerName = engine.get(id, Layer)?.name ?? 'base';
				const bucket =
					layerName === 'background' ? background : layerName === 'overlay' ? overlay : base;
				bucket.push(id);
			}
			return {
				backgroundDom: background,
				baseDom: base,
				overlayDom: overlay,
				webglEntities: webgl,
			};
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
				onPointerDown={pointerBus.onPointerDown}
				onPointerMove={pointerBus.onPointerMove}
				onPointerUp={pointerBus.onPointerUp}
				onPointerLeave={pointerBus.onPointerLeave}
				onDoubleClick={pointerBus.onDoubleClick}
			>
				{/* Vanilla WebGL layer — dot grid + selection overlays (driven by WebGLManager) */}
				<canvas ref={webglCanvasRef} className="absolute inset-0 pointer-events-none" />

				{/* Background — purely visual; pointer handlers live on the container. */}
				<div className="absolute inset-0 pointer-events-none" />

				{/* RFC-003 layer stack:
				    'background' + 'base' beneath the R3F canvas (zIndex < 1)
				    R3F canvas at zIndex 1
				    'overlay' above the R3F canvas (zIndex 2)
				    All three DOM containers share the same camera transform
				    so they pan / zoom in lockstep. */}
				<LayerContainer layerRef={backgroundLayerRef}>
					{bucketSlots(backgroundDom, engine, registerSlotRef)}
				</LayerContainer>
				<LayerContainer layerRef={baseLayerRef}>
					{bucketSlots(baseDom, engine, registerSlotRef)}
				</LayerContainer>

				{/* R3F layer — 3D widgets (lazy, only when webgl entities exist).
				    Gated on `containerMounted` so R3F's `eventSource` ref is
				    populated by the time `<Canvas>` resolves it. */}
				{containerMounted && webglEntities.length > 0 && (
					<R3FBridge engine={engine} entities={webglEntities} r3fRoot={r3fRoot} />
				)}

				<LayerContainer layerRef={overlayLayerRef} zIndex={2}>
					{bucketSlots(overlayDom, engine, registerSlotRef)}
				</LayerContainer>

				{/* Children: toolbars, panels, etc. */}
				{children}
			</div>
		);

		return (
			<EngineProvider value={engine}>
				<ContainerRefProvider value={containerRef}>
					<WidgetProvider engine={engine}>{canvasContent}</WidgetProvider>
				</ContainerRefProvider>
			</EngineProvider>
		);
	},
);

/** Bridge component — reads widget resolver from context and passes to R3FManager. */
function R3FBridge({
	engine,
	entities,
	r3fRoot,
}: {
	engine: LayoutEngine;
	entities: EntityId[];
	r3fRoot?: React.ReactNode;
}) {
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

	return <R3FManager engine={engine} entities={entities} resolve={resolve} r3fRoot={r3fRoot} />;
}

/**
 * One DOM container for a render layer (RFC-003). Each container holds
 * the WidgetSlot / SelectionOverlaySlot elements for the entities
 * bucketed into its layer; the container's CSS transform is driven by
 * the rAF loop so all layers pan / zoom in lockstep.
 *
 * `zIndex` is applied via a one-shot effect (not via React's `style`
 * prop) so it doesn't fight the rAF loop's direct `style.transform`
 * writes — and so it doesn't depend on Tailwind's content scanner
 * picking up the class from inside the library bundle (which it
 * doesn't, since the library lives in node_modules of the consumer).
 */
function LayerContainer({
	layerRef,
	zIndex,
	children,
}: {
	layerRef: React.RefObject<HTMLDivElement | null>;
	zIndex?: number;
	children: React.ReactNode;
}) {
	useEffect(() => {
		if (zIndex !== undefined && layerRef.current) {
			layerRef.current.style.zIndex = String(zIndex);
		}
	}, [layerRef, zIndex]);
	return (
		<div ref={layerRef} className="absolute left-0 top-0 origin-top-left will-change-transform">
			{children}
		</div>
	);
}

/**
 * Renders the right slot per entity in a layer container — DOM widgets
 * get a `WidgetSlot`, R3F widgets get a `SelectionOverlaySlot` (chrome
 * + interaction surface; the actual 3D content renders through the R3F
 * canvas). Pure helper so the JSX in the main component stays compact.
 */
function bucketSlots(
	entities: EntityId[],
	engine: LayoutEngine,
	registerSlotRef: (entityId: EntityId, el: HTMLDivElement | null) => void,
): React.ReactNode[] {
	return entities.map((entityId) => {
		const w = engine.get(entityId, Widget);
		return w?.surface === 'webgl' ? (
			<SelectionOverlaySlot key={entityId} entityId={entityId} slotRef={registerSlotRef} />
		) : (
			<WidgetSlot key={entityId} entityId={entityId} slotRef={registerSlotRef} />
		);
	});
}
