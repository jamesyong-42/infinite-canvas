import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import type { CanvasEngine, EntityId } from '@infinite-canvas/core';
import { Transform2D } from '@infinite-canvas/core';
import { EngineProvider } from './context.js';
import { WidgetSlot } from './WidgetSlot.js';

interface InfiniteCanvasProps {
	engine: CanvasEngine;
	className?: string;
	style?: React.CSSProperties;
	children?: React.ReactNode;
}

export function InfiniteCanvas({ engine, className, style, children }: InfiniteCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
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

	// Set viewport size on mount and resize
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			engine.setViewport(rect.width, rect.height, window.devicePixelRatio);
		};

		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(container);
		return () => observer.disconnect();
	}, [engine]);

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

				// 1b. Update dot grid to match camera
				if (containerRef.current) {
					const gridSpacing = 24;
					const size = gridSpacing * camera.zoom;
					const offsetX = (-camera.x * camera.zoom) % size;
					const offsetY = (-camera.y * camera.zoom) % size;
					const dotSize = Math.max(0.5, Math.min(1.5, camera.zoom));
					const opacity = Math.max(0, Math.min(1, camera.zoom * 0.8));
					containerRef.current.style.backgroundImage =
						`radial-gradient(circle, rgba(0,0,0,${opacity * 0.2}) ${dotSize}px, transparent ${dotSize}px)`;
					containerRef.current.style.backgroundSize = `${size}px ${size}px`;
					containerRef.current.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
				}

				// 2. Update only slots whose world position changed (O(changed) for drag)
				for (const entityId of changes.positionsChanged) {
					const el = slotRefs.current.get(entityId);
					if (!el) continue;
					const t = engine.get(entityId, Transform2D);
					if (!t) continue;
					el.style.transform = `translate(${t.x}px, ${t.y}px)`;
					el.style.width = `${t.width}px`;
					el.style.height = `${t.height}px`;
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
		if (containerRef.current) {
			const size = 24 * camera.zoom;
			containerRef.current.style.backgroundImage =
				`radial-gradient(circle, rgba(0,0,0,0.16) 1px, transparent 1px)`;
			containerRef.current.style.backgroundSize = `${size}px ${size}px`;
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

	// Initial position for newly mounted slots
	useEffect(() => {
		for (const entityId of visibleEntities) {
			const el = slotRefs.current.get(entityId);
			if (!el) continue;
			const t = engine.get(entityId, Transform2D);
			if (!t) continue;
			el.style.transform = `translate(${t.x}px, ${t.y}px)`;
			el.style.width = `${t.width}px`;
			el.style.height = `${t.height}px`;
		}
	}, [visibleEntities, engine]);

	return (
		<EngineProvider value={engine}>
			<div
				ref={containerRef}
				className={`relative overflow-hidden ${className ?? ''}`}
				style={{
					...style,
					touchAction: 'none',
					backgroundColor: '#fafafa',
				}}
				onPointerDown={onBackgroundPointerDown}
				onPointerMove={onBackgroundPointerMove}
				onPointerUp={onBackgroundPointerUp}
			>
				{/* Camera transform layer — world-space positioning */}
				<div
					ref={cameraLayerRef}
					className="absolute left-0 top-0 origin-top-left will-change-transform"
				>
					{visibleEntities.map((entityId) => (
						<WidgetSlot
							key={entityId}
							entityId={entityId}
							slotRef={registerSlotRef}
						/>
					))}
				</div>

				{/* Children: widget providers, R3F layer, toolbars, etc. */}
				{children}
			</div>
		</EngineProvider>
	);
}
