# RFC-008: Input Manager — Adapters, Recognizers, Router

- **Status**: Draft v5
- **Author**: James Yong
- **Date**: 2026-04-28
- **Area**: Interaction / Input / Engine API / R3F Layer / DOM Widget Layer
- **Related**: RFC-001 (ECS Hitbox — `pickAt`), RFC-002 (R3F compositor, `Surface` type), RFC-005 (resize handles are engine-rendered chrome), RFC-006 (R3F `EventRouter`), RFC-007 (`TouchEventBus`)
- **Supersedes**: `PointerEventBus` (RFC-006), `TouchEventBus` (RFC-007), the inline wheel `useEffect`, the `PointerDirective` enum, and the R3F `EventRouter`'s role as a parallel native listener (it becomes a pure dispatch target invoked by the InputManager)

---

## Summary

The InputManager has three components: **adapters** (turn native events into normalised `InputEvent`s), **recognizers** (independent observers that emit higher-level synthetic gesture events), and **routers** (deliver events to widget surfaces — DOM and R3F). One pipeline. Everything else (engine state machine, R3F EventRouter's old role, the wheel handler, the directive enum) collapses into handlers registered on the manager.

**Key change from v4**: R3F's event manager no longer registers its own native listeners on the canvas container. There is exactly one native-listener owner per event source — PointerAdapter for pointer events, WheelAdapter for wheel. When the InputManager dispatches an event over an R3F widget, the **R3FRouter** invokes R3F's mesh-dispatch machinery for that widget's scene. R3F's bubble, click synthesis, hover diff are still R3F's machinery, just driven by us.

DOM widget events reach React handlers via the natural DOM bubble path before the native event arrives at the canvas container. No router needed for DOM — the platform handles it.

The engine's interaction state machine is preserved verbatim. `pickAt` becomes the manager's hit-test service. No new author-facing API — widgets use native React/R3F handlers and native DOM mechanisms (`setPointerCapture`, `stopPropagation`).

This RFC tightens every interface, so Phase 1 has a precise contract to build against.

---

## Motivation

| Symptom | Root cause |
|---|---|
| In-widget drag (slider thumb, custom handle) requires manual `stopPropagation` + manual `setPointerCapture` per widget. | Pattern works but isn't documented. |
| Scrollable widget content (overflow scroll inside a widget) is impossible — wheel pans/zooms unconditionally. | Wheel handler is global; no opt-out path. |
| Three `stopPropagation` idioms (DOM React, R3F synthetic, R3F nativeEvent). | Each layer has its own bubble; halting one doesn't halt the others. |
| `pickAt` invoked from three places (engine state machine, R3F `EventRouter`, `TouchEventBus`). | No single hit-test owner. |
| Two `setGesturing` debouncers. | Wheel and TouchEventBus each own their own. |
| `PointerDirective` enum routes capture decisions from engine to bus. | Engine can't call `setPointerCapture`, returns enum; capture timing splits across two files. |
| Empty-space tap on touch takes a different path than mouse. | TouchEventBus synthesises `handlePointerDown`/`Up` because `preventDefault` blocked synthesised pointer events. |
| Two parallel native listeners on the canvas container (`PointerEventBus` via React JSX + R3F `eventSource`). | Each surface registers independently; coordinating them requires either `nativeEvent.stopPropagation` discipline or the InputManager from this RFC. |
| Future wrapper widgets, kinetic scrolling, action mapping have no clean place to land. | Architecture admits them only by extending an already-fragmented routing layer. |

### What this RFC is not

- Not a rewrite of the engine state machine — only its invocation moves.
- Not a new author-facing API — widgets use React/R3F handlers and native DOM mechanisms.
- Not a rewrite of R3F's mesh-dispatch internals — R3F's bubble, hover diff, click synthesis stay; we just invoke them from our pipeline instead of letting R3F's own native listener fire.
- Not action mapping — admitted by the recognizer pattern, deferred to a follow-up.
- Not first-class multi-pointer simultaneous interaction — model admits it; not validated in v1.

---

## Model

### Two layers, default coexistence

**Inside a widget** is a normal React tree (DOM widgets) or R3F scene (R3F widgets). Authors write `<button onClick>`, `<mesh onClick>` as in any normal React/R3F app.

**Outside the widget** is the InputManager. Adapters listen for native events at the canvas container, normalise to `InputEvent`s, and dispatch. Routers deliver events to the appropriate widget surface. Recognizers observe the dispatched stream and emit synthetic gestures. Engine handlers register at the manager for the events they care about.

The widget and the engine **coexist by default**. A click on a widget's `<button>` fires the button's `onClick` AND triggers the InputManager's `tap` recognizer (which the engine uses to update selection). Both happen, both correct, no coordination needed.

The widget claims exclusive ownership of a gesture using **native DOM mechanisms**:

| Widget wants to | Mechanism |
|---|---|
| Own a drag (slider thumb, custom handle, OrbitControls) | `element.setPointerCapture(pointerId)` on `pointerdown`. The browser routes subsequent move/up events directly to the captured element, bypassing the canvas container. PointerAdapter never sees them. Engine never drags. |
| Own wheel scrolling (overflow scroll content) | `e.stopPropagation()` on `wheel`. Bubble halts before the wheel event reaches the canvas container. WheelAdapter never sees the event. Engine doesn't pan/zoom. |

This is the platform's native model. We don't add anything. Authors who already know DOM know how to claim gestures.

### Hover and drag are independent gestures

A widget that has `onPointerOver` everywhere on its surface can still be dragged by the engine — hover and drag are independent. If a widget wants to be undraggable (e.g., a 3D scene with full-surface OrbitControls), it claims drag on its full surface via `setPointerCapture` in its `onPointerDown`. Author's design choice — same as Electron's `-webkit-app-region: drag` placement.

### Recognizers are independent observers

Following iOS `UIGestureRecognizer`, Hammer.js, use-gesture, React Native PanResponder: each recognizer is independent. It observes the dispatched event stream, runs its own state machine, and emits synthetic events when it recognises a gesture. Conflicts resolve via pairwise relationships, not global priority.

| Recognizer | Behaviour | Pairwise relationships |
|---|---|---|
| **TapRecognizer** | Per-pointerId `down` → quick `up` within tap-window and dead-zone → emits `tap`. | Cancels its pending tap on observed `drag-start` or `pinch-start` for the tracked pointerId. |
| **DragRecognizer** | Per-pointerId `down` → `move` past dead zone → emits `drag-start` then `drag-update`s. On `up`/`cancel` after dragging → emits `drag-end`. Single-finger only (mouse / pen primary, or touch pointer 1). | None outbound. |
| **PinchRecognizer** | Counts active touch-source pointer IDs. On 2nd active touch pointer: dispatches synthetic `cancel` for any tracked single-finger drag; emits `pinch-start`. Tracks centroid + scale through `pinch-update`. On either finger up: emits `pinch-end`. | Cancels `DragRecognizer` (entity drag). Coexists with `PanRecognizer` (empty-space pan + pinch run simultaneously, like iOS Maps). |
| **PanRecognizer** | For empty-space single-finger touch (`engine.pickAt(world) === null` at down-time). Emits `pan-update` deltas. | None outbound. |
| **DoubleTapRecognizer** | Observes `tap` emissions; emits `double-tap` if two taps land within window + dead-zone. | None. |
| **HoverRecognizer** | Observes `move`; tracks last leaf-target via `engine.pickAt`. On change, emits `hover-leave` then `hover-enter`. | Always runs; never cancelled. |

Adding a new gesture (long-press, swipe, rotation) is a new recognizer with declared relationships to existing ones.

### Resize handles use existing selection chrome

Engine selection chrome (RFC-005) renders resize handles as DOM elements with their own React handlers, z-indexed above widgets via `pointer-events: auto` on hot-zones. Native CSS hit-testing routes pointer events to the handle before reaching the widget below. The handle handler:

```typescript
onPointerDown={(e) => {
  e.stopPropagation();
  e.currentTarget.setPointerCapture(e.pointerId);
  engine.beginResize(entityId, handle, world);
}}
```

`stopPropagation` halts the React bubble; `setPointerCapture` ensures move/up keep flowing to the handle. PointerAdapter on the canvas container never sees the event. This is today's RFC-005 mechanism. No InputManager-side handling needed.

---

## Architecture

### One pipeline, three surfaces

```
┌──────────────────────────────────────────────────────────────────┐
│ Native events on canvas container (PointerAdapter, WheelAdapter)  │
│   ↓                                                              │
│ InputManager.dispatch(event)                                      │
│   ├─ for 'down'/'move'/'up'/'cancel':                             │
│   │   1. engine.pickAt(event.world) → entityId | null              │
│   │   2. if entity & surface=webgl: r3fRouter.route(event, entity)  │
│   │   3. (DOM widget case: React already dispatched on bubble path) │
│   ├─ engine handlers run                                           │
│   └─ recognizers observe; may emit synthetic events                 │
└──────────────────────────────────────────────────────────────────┘
```

R3F's `<Canvas events={eventManager}>` uses a custom EventManager whose `connect` is a no-op. R3F never registers native listeners. The InputManager invokes the EventManager's `handlers` directly when routing.

### Module layout

```
src/react/input/                           ← new directory
  types.ts                                 ← all type/interface definitions (one file, single source of truth)
  InputManager.ts                          ← class implementing InputManager interface
  adapters/
    PointerAdapter.ts                      ← class implementing Adapter; pointer events
    WheelAdapter.ts                        ← class implementing Adapter; wheel events
  recognizers/
    TapRecognizer.ts                       ← class implementing Recognizer
    DoubleTapRecognizer.ts                 ← class implementing Recognizer
    DragRecognizer.ts                      ← class implementing Recognizer
    PinchRecognizer.ts                     ← class implementing Recognizer
    PanRecognizer.ts                       ← class implementing Recognizer
    HoverRecognizer.ts                     ← class implementing Recognizer
  routers/
    R3FRouter.ts                           ← class implementing WidgetSurfaceRouter; invokes R3F dispatch
  r3f/
    createR3FEventManager.ts               ← R3F EventManager factory; connect: no-op
  constants.ts                             ← timing windows, dead zones, debounce intervals

src/react/
  PointerEventBus.ts                       ← DELETED in Phase 3
  TouchEventBus.ts                         ← DELETED in Phase 2
  InfiniteCanvas.tsx                       ← simplified

src/r3f/compositor/
  EventRouter.ts                           ← REPLACED by createR3FEventManager + R3FRouter

src/ecs/engine/
  interaction.ts                           ← state machine PRESERVED. Public API split:
                                              handlePointerDown/Move/Up/Cancel  [DELETED]
                                              beginDrag(entity, world)
                                              updateDrag(entity, world)
                                              endDrag(entity, opts)
                                              beginResize(entity, handle, world)
                                              updateResize(entity, world)
                                              endResize(entity, opts)
                                              beginMarquee(world)
                                              updateMarquee(world)
                                              endMarquee()
                                              isMarqueeActive()                 [new]
                                              getDraggingEntity()               [new]
                                              selectEntity(entity, additive)   [unchanged]
                                              clearSelection()                  [unchanged]
                                              pickAt(x, y)                      [unchanged]
                                              setHoveredEntity(entity | null)  [unchanged]
                                              setGesturing(active)              [unchanged]
  LayoutEngine.ts                          ← installs handlers on InputManager at construction
  types.ts                                 ← PointerDirective enum REMOVED
```

---

## Interface definitions

All types and interfaces live in `src/react/input/types.ts`. This section is a precise contract for Phase 1.

### Core value types

```typescript
// types.ts

export interface Point { x: number; y: number }
export interface AABB  { x: number; y: number; width: number; height: number }

export interface Modifiers {
  shift: boolean;
  ctrl:  boolean;
  alt:   boolean;
  meta:  boolean;
}

export type InputEventType =
  // Raw, emitted by adapters
  | 'down' | 'move' | 'up' | 'cancel'
  | 'wheel'
  // Synthetic, emitted by recognizers
  | 'tap' | 'double-tap'
  | 'drag-start' | 'drag-update' | 'drag-end'
  | 'pinch-start' | 'pinch-update' | 'pinch-end'
  | 'pan-update'
  | 'hover-enter' | 'hover-leave';

export type InputSource = 'mouse' | 'pen' | 'touch' | 'wheel' | 'synthetic';

/** `null` for events with no associated button (move, wheel) or pen-air-tap. */
export type Button = 0 | 1 | 2 | null;

export type GestureDetail =
  | { kind: 'drag';  phase: 'start' | 'update' | 'end'; total: Point; delta: Point }
  | { kind: 'pinch'; phase: 'start' | 'update' | 'end'; scale: number; center: Point }
  | { kind: 'pan';   delta: Point }
  | { kind: 'tap';   count: 1 | 2 }
  | { kind: 'hover'; entityId: EntityId | null };

/**
 * Normalised input event. Immutable from a handler's perspective.
 *
 * Halting and ownership are NOT methods on this type — they're DOM primitives:
 *   - `setPointerCapture(event.pointerId)` on a DOM element to claim the gesture.
 *   - `event.native.stopPropagation()` on the underlying native event to halt
 *     bubble before reaching adapter listeners.
 */
export interface InputEvent {
  readonly type: InputEventType;
  readonly source: InputSource;

  /** Stable per pointer for the lifetime of the press (mouse, pen, finger). */
  readonly pointerId: number;
  /** True for the first finger / left mouse button / primary pen tip. */
  readonly primary: boolean;

  /** Canvas-container relative pixels. */
  readonly screen: Readonly<Point>;
  /** Post-camera transform; world coordinates in the engine's coordinate space. */
  readonly world:  Readonly<Point>;
  /** Movement since previous event of same pointerId. Defined for 'move', 'drag-update', 'pan-update', 'wheel'. */
  readonly delta?: Readonly<Point>;

  /** Defined for 'wheel' events only. `pinch` true when ctrl/meta held (trackpad pinch). */
  readonly wheelDelta?: { dx: number; dy: number; pinch: boolean };

  /** Defined for 'down', 'up' events. */
  readonly button?: Button;

  readonly modifiers: Readonly<Modifiers>;
  /** ms since epoch (event.timeStamp on native, Date.now for synthetic). */
  readonly timestamp: number;

  /** Defined on synthetic recognizer-emitted events. */
  readonly gesture?: GestureDetail;

  /** Underlying native event. Adapters fill; routers may pass it forward; handlers should rarely read directly. */
  readonly native?: Event;
}
```

### Adapter

```typescript
// types.ts

export interface Adapter {
  /**
   * Register native event listeners on `container`. Each listener calls
   * `manager.dispatch(...)` with a normalised InputEvent.
   * Returns a detacher.
   */
  attach(container: HTMLElement, manager: InputManager): () => void;
}
```

### Recognizer

```typescript
// types.ts

export interface Recognizer {
  /**
   * Called by InputManager.dispatch after handlers have run.
   * Recognizers track per-pointerId state and may call manager.dispatch
   * with synthetic events (which then re-enter dispatch normally).
   */
  observe(event: InputEvent, manager: InputManager): void;

  /**
   * Optional cleanup if InputManager is being disposed mid-gesture.
   * Default: no-op.
   */
  reset?(): void;
}
```

### Router

```typescript
// types.ts

export interface WidgetSurfaceRouter {
  /** The surface this router handles. */
  readonly surface: Surface;  // 'dom' | 'webgl' from RFC-002

  /**
   * Deliver `event` to the widget identified by `entityId`. The router
   * is responsible for invoking the surface-specific dispatch (e.g., for
   * R3F: pre-configure the raycaster, invoke R3F's mesh dispatch).
   *
   * Routers are invoked by InputManager.dispatch BEFORE engine handlers,
   * so that widget mesh handlers (which may setPointerCapture) can claim
   * a gesture before the engine reacts.
   */
  route(event: InputEvent, entityId: EntityId): void;
}
```

### InputManager

```typescript
// types.ts

export type Handler = (event: InputEvent) => void;

export interface InputManager {
  /** Mount adapters on the container; returns a teardown function. */
  attach(): () => void;

  /** Register an engine-level handler at the manager root. */
  on(type: InputEventType, handler: Handler): () => void;

  /** Register a recognizer. */
  addRecognizer(r: Recognizer): () => void;

  /**
   * Register a router for a specific widget surface. Only one router per surface.
   * Re-registering replaces the previous.
   */
  setRouter(router: WidgetSurfaceRouter): () => void;

  /**
   * Entry point. Adapters and recognizers call this. Order:
   *   1. If raw 'down'/'move'/'up'/'cancel' AND world coords hit an entity
   *      AND that entity's surface has a router → router.route(event, entityId).
   *   2. Fire all registered handlers for event.type.
   *   3. Recognizers observe.
   *
   * try/catch around each handler/recognizer/router — one bad handler
   * doesn't break the pipeline.
   */
  dispatch(event: InputEvent): void;

  /** Hit-test service exposed to recognizers and engine handlers. */
  pickAt(world: Point): EntityId | null;

  /** Single source for engine.setGesturing(true) + debounced false. */
  notifyGesturing(): void;

  /** Read engine reference (for handlers that need it). */
  readonly engine: LayoutEngine;
}
```

### R3F integration: `createR3FEventManager`

R3F's `<Canvas>` accepts an `events` prop of type `EventManagerFactory`. Today's `EventRouter.ts` (RFC-006) supplies one that registers native listeners via `eventSource={containerRef}`. v5 supplies a factory whose `connect` is a no-op:

```typescript
// src/react/input/r3f/createR3FEventManager.ts

import type { EventManager } from '@react-three/fiber';

/**
 * Returns an R3F EventManagerFactory that does NOT register native listeners.
 * Used together with R3FRouter, which invokes the manager's handlers directly
 * when InputManager dispatches an event over an R3F widget.
 */
export function createR3FEventManager(): EventManagerFactory {
  return (state) => {
    const manager: EventManager<HTMLElement> = {
      enabled: true,
      connected: false,
      handlers: undefined as any,  // populated by R3F internally on first event setup
      // No-ops: R3F never attaches listeners. R3FRouter calls manager.handlers.* directly.
      connect: () => { /* no-op */ },
      disconnect: () => { /* no-op */ },
      // compute and filter still active — R3F's dispatch uses them internally.
      compute: defaultR3FCompute,
      filter: undefined,
    };
    return manager;
  };
}
```

The exact R3F internals here need a Phase 1 spike to confirm `handlers` shape and call signature; if R3F's API doesn't expose `handlers` cleanly, the fallback is to register a no-op listener and call it ourselves with a synthesised native event.

### `R3FRouter`

```typescript
// src/react/input/routers/R3FRouter.ts

export class R3FRouter implements WidgetSurfaceRouter {
  readonly surface: Surface = 'webgl';

  constructor(
    private widgetRegistry: WidgetRegistry,   // RFC-006 — exposes per-widget scene + camera
    private r3fEventManager: EventManager<HTMLElement>,
  ) {}

  route(event: InputEvent, entityId: EntityId): void {
    if (!event.native) return;  // synthetic events bypass R3F dispatch
    const widget = this.widgetRegistry.get(entityId);
    if (!widget) return;

    // Pre-configure R3F's compute to target this widget's scene + camera.
    // (Same logic as today's EventRouter.compute, just driven from us.)
    // Then invoke the appropriate handler on R3F's event manager.
    const handlerName = mapToR3FHandlerName(event.type);  // 'onPointerDown' | 'onPointerMove' | etc.
    const handler = this.r3fEventManager.handlers?.[handlerName];
    if (handler) handler(event.native as PointerEvent);
  }
}
```

The `mapToR3FHandlerName` helper translates `'down' → 'onPointerDown'` etc. R3F's handler runs its raycast (using our scene-aware compute) and dispatches to mesh handlers via R3F's existing bubble. If a mesh handler calls `e.stopPropagation()`, R3F's bubble halts internally — the engine's handlers (which run after the router in the dispatch loop) still fire because they listen on the InputManager, not R3F's bubble. **Coexistence: R3F handles widget-internal logic; engine handles canvas-level logic.**

For widget exclusive ownership: the mesh handler calls `e.target.setPointerCapture(e.pointerId)` on its own canvas element. From that point, browser routes pointer events directly to the captured element — neither PointerAdapter nor anyone else on the canvas container sees the events.

### Constants

```typescript
// src/react/input/constants.ts

export const DEAD_ZONE_MOUSE_PX = 4;
export const DEAD_ZONE_TOUCH_PX = 8;

export const TAP_WINDOW_MS = 250;
export const DOUBLE_TAP_WINDOW_MS = 300;
export const DOUBLE_TAP_DIST_PX = 30;

export const GESTURING_IDLE_MS = 200;

export const ZOOM_TARGETS = [1, 2];          // double-tap zoom targets
export const ZOOM_LOW_THRESHOLD  = 0.9;
export const ZOOM_HIGH_THRESHOLD = 1.8;

export const WHEEL_ZOOM_FACTOR = 0.01;
```

All timing windows and dead zones are constants in this module; recognizers and engine handlers import from here. Replaces today's per-file constant duplication.

### Engine API additions

```typescript
// LayoutEngine type additions (in src/ecs/engine/types.ts)

interface LayoutEngine {
  // Drag — replaces handlePointerDown/Move/Up/Cancel for the drag case
  beginDrag(entity: EntityId, world: Point): void;
  updateDrag(entity: EntityId, world: Point): void;
  endDrag(entity: EntityId, opts: { cancelled: boolean }): void;
  getDraggingEntity(): EntityId | null;

  // Resize — replaces the resize branch
  beginResize(entity: EntityId, handle: ResizeHandlePos, world: Point): void;
  updateResize(entity: EntityId, world: Point): void;
  endResize(entity: EntityId, opts: { cancelled: boolean }): void;

  // Marquee — replaces the marquee branch
  beginMarquee(world: Point): void;
  updateMarquee(world: Point): void;
  endMarquee(): void;
  isMarqueeActive(): boolean;

  // Unchanged from today
  selectEntity(entity: EntityId, additive: boolean): void;
  clearSelection(): void;
  pickAt(screenX: number, screenY: number): EntityId | null;
  setHoveredEntity(entity: EntityId | null): void;
  setGesturing(active: boolean): void;

  // Removed
  // handlePointerDown/Move/Up/Cancel → DELETED
  // PointerDirective enum → DELETED
}
```

Each new method is a named entry point with a clear precondition. `beginDrag` requires the entity is `Draggable`; `beginResize` requires the entity is `Resizable`; `beginMarquee` has no precondition. End methods take a `cancelled` flag — true means "fly-back / abort," false means "commit."

### Engine handler registration

```typescript
// LayoutEngine constructor:
function installEngineHandlers(
  manager: InputManager,
  engine: LayoutEngine,
  container: HTMLElement,
): void {

  // Camera — wheel
  manager.on('wheel', (e) => {
    const w = e.wheelDelta!;
    if (w.pinch) engine.zoomAtPoint(e.screen.x, e.screen.y, -w.dy * WHEEL_ZOOM_FACTOR);
    else         engine.panBy(-w.dx, -w.dy);
    manager.notifyGesturing();
  });

  // Camera — pinch (synchronous with pan when both fingers active over empty space)
  manager.on('pinch-update', (e) => {
    const g = e.gesture as Extract<GestureDetail, { kind: 'pinch' }>;
    engine.zoomAtPoint(g.center.x, g.center.y, g.scale - 1);
    manager.notifyGesturing();
  });

  // Camera — empty-space single-finger pan
  manager.on('pan-update', (e) => {
    const g = e.gesture as Extract<GestureDetail, { kind: 'pan' }>;
    engine.panBy(g.delta.x, g.delta.y);
    manager.notifyGesturing();
  });

  // Selection — stationary tap
  manager.on('tap', (e) => {
    const g = e.gesture as Extract<GestureDetail, { kind: 'tap' }>;
    if (g.count !== 1) return;
    const entity = engine.pickAt(e.screen.x, e.screen.y);
    if (entity !== null) engine.selectEntity(entity, e.modifiers.shift);
    else engine.clearSelection();
  });

  // Engine drag start — DragRecognizer past dead zone
  manager.on('drag-start', (e) => {
    const entity = engine.pickAt(e.screen.x, e.screen.y);
    if (entity === null) {
      engine.beginMarquee(e.world);
    } else {
      engine.beginDrag(entity, e.world);
    }
    container.setPointerCapture(e.pointerId);
  });

  manager.on('drag-update', (e) => {
    if (engine.isMarqueeActive()) engine.updateMarquee(e.world);
    else if (engine.getDraggingEntity() !== null) engine.updateDrag(engine.getDraggingEntity()!, e.world);
  });

  manager.on('drag-end', (e) => {
    if (engine.isMarqueeActive()) engine.endMarquee();
    else if (engine.getDraggingEntity() !== null) engine.endDrag(engine.getDraggingEntity()!, { cancelled: false });
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
  });

  manager.on('cancel', (e) => {
    if (engine.isMarqueeActive()) engine.endMarquee();
    else if (engine.getDraggingEntity() !== null) engine.endDrag(engine.getDraggingEntity()!, { cancelled: true });
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
  });

  // Hover chrome
  manager.on('hover-enter', (e) => {
    const g = e.gesture as Extract<GestureDetail, { kind: 'hover' }>;
    engine.setHoveredEntity(g.entityId);
  });
  manager.on('hover-leave', () => engine.setHoveredEntity(null));

  // Double-tap → enter container or zoom
  manager.on('double-tap', (e) => {
    const entity = engine.pickAt(e.screen.x, e.screen.y);
    if (entity !== null) {
      engine.enterContainer(entity);
    } else {
      const camera = engine.getCamera();
      const target = camera.zoom < ZOOM_LOW_THRESHOLD ? ZOOM_TARGETS[0]
                   : camera.zoom < ZOOM_HIGH_THRESHOLD ? ZOOM_TARGETS[1]
                   : ZOOM_TARGETS[0];
      engine.zoomAtPoint(e.screen.x, e.screen.y, (target - camera.zoom) / camera.zoom);
    }
  });

  // Resize handles register their own DOM listeners in the existing selection
  // chrome layer (RFC-005). No registration here.
}
```

### Widget authoring

No new API. Three patterns documented:

```tsx
// Coexistence — default behaviour, no special code
function TodoListItem({ item, onToggle }) {
  return <li onClick={() => onToggle(item.id)}>{item.text}</li>;
  // Click toggles. Engine's TapRecognizer fires; widget gets selected.
  // Both happen. Selection chrome appears. Todo toggles.
}

// In-widget drag — claim via setPointerCapture
function SliderHandle({ onChange }) {
  return (
    <div
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(/* compute from e */);
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
    />
  );
}

// Scrollable widget content — claim wheel via stopPropagation
function ScrollableWidget() {
  return (
    <div onWheel={(e) => { e.stopPropagation(); scrollContent(e.deltaY); }}>
      ...
    </div>
  );
}

// R3F orbit-controlled widget
function R3FOrbitWidget() {
  return (
    <mesh
      onPointerDown={(e) => e.target.setPointerCapture?.(e.pointerId)}
      onPointerMove={(e) => { /* orbit logic */ }}
      onPointerUp={(e) => { /* release */ }}
    />
  );
}
```

---

## Migration

Three phases, each independently mergeable.

### Phase 1 — InputManager skeleton + R3F EventManager spike

- New `src/react/input/`: `types.ts`, `constants.ts`, `InputManager.ts`, `adapters/PointerAdapter.ts`.
- One consumer: a single `down` handler at the manager that delegates to existing `PointerEventBus.onPointerDown`. PointerEventBus, TouchEventBus, wheel useEffect all still active.
- **R3F spike**: validate `createR3FEventManager` works — confirm R3F's `EventManager.handlers` is callable from outside R3F's own listener path. If R3F's API doesn't expose this cleanly, document the fallback (parallel listeners with `nativeEvent.cancelBubble` coordination).
- Tests: dispatch with no handlers, dispatch with handlers, recognizer observation runs after handlers, surface-specific routing via mock router.

**Acceptance**:
- InputManager mounts, dispatches, all existing tests pass.
- R3F spike confirms invokability of R3F handlers from external code, OR documents the fallback.

### Phase 2 — Recognizers + Replace TouchEventBus + wheel useEffect

- `WheelAdapter`.
- All six recognizers: `Tap`, `DoubleTap`, `Drag`, `Pinch`, `Pan`, `Hover`.
- Engine handlers for `wheel`, `pinch-update`, `pan-update`, `tap` (clear-selection branch only — entity-tap stays in PointerEventBus until Phase 3), `double-tap`, `hover-enter`, `hover-leave`.
- Single `setGesturing` debouncer via `InputManager.notifyGesturing`.
- Delete `TouchEventBus.ts` and the inline wheel `useEffect`.
- New playground example: scrollable widget content via `e.stopPropagation()` on wheel.

**Acceptance**:
- All RFC-007 mobile + desktop gesture criteria hold.
- Scrollable widget example works on desktop and mobile.
- Single `setGesturing` debouncer.

### Phase 3 — R3FRouter + Replace PointerEventBus + delete PointerDirective

- `R3FRouter` and `createR3FEventManager` (replacing today's `EventRouter.ts`).
- Engine handlers for `drag-start` / `drag-update` / `drag-end` / `cancel` / `tap` (entity-select branch).
- Engine API split as listed in Module Layout.
- Delete `PointerDirective` enum.
- Delete `PointerEventBus.ts`. Remove canvas container's `onPointer*` JSX props.
- New playground example: in-widget drag (slider thumb) via `setPointerCapture`.
- Update authoring guide.
- Bump package to 2.0 (breaking engine API change).

**Acceptance**:
- `PointerEventBus.ts`, `EventRouter.ts` (RFC-006 file) deleted.
- `PointerDirective` enum removed.
- Engine API split shipped.
- All existing interaction tests pass via the new flow.
- Two new playground examples (slider thumb, scrollable widget).
- DOM widget React handlers and R3F mesh handlers unchanged in any existing widget.
- Manual QA on iOS Safari 16+ for drag and pinch.

---

## Decisions

1. **No `consume()` API on InputEvent.** Halt is via DOM `stopPropagation`; ownership is via `setPointerCapture`. Both are platform primitives.
2. **No internal capture map.** `setPointerCapture` is the capture mechanism, used by widgets and by the engine drag handler alike.
3. **No target tree.** InputManager has handlers at one location.
4. **No directive enum.** Engine handlers commit by calling `container.setPointerCapture` directly.
5. **Default coexistence.** Widget and engine both react to events. `setPointerCapture` or `stopPropagation` claims exclusivity when needed.
6. **Recognizers are independent observers** with pairwise relationships (iOS `UIGestureRecognizer` model). No central priority.
7. **One pipeline; one native listener per source.** R3F's event manager does NOT register native listeners (`connect: no-op`). R3FRouter invokes R3F's mesh dispatch from the InputManager's pipeline.
8. **Routers per surface.** Currently DOM (no router needed; React's natural bubble) and WebGL/R3F. Future surfaces register routers.
9. **Resize handles use existing selection chrome** (RFC-005); no InputManager registration.
10. **Engine API split**: `beginDrag` / `updateDrag` / `endDrag` and pairs. Cancel via `{ cancelled: true }` flag on the end methods.
11. **No TouchAdapter.** PointerAdapter handles all pointer events including touch (browser-synthesised). PinchRecognizer counts active touch-source pointer IDs. Matches Hammer.js / use-gesture.
12. **Pinch + entity drag are mutually exclusive** — PinchRecognizer dispatches synthetic `cancel` for tracked drag pointers before emitting `pinch-start`. **Pinch + empty-space pan are simultaneous** — both recognizers run, both engine handlers fire, like iOS Maps.
13. **Hover and drag are independent.** Widgets that handle hover everywhere are still draggable by default; explicit `setPointerCapture` to claim the surface for own drag.
14. **Single `setGesturing` debouncer** at the InputManager.
15. **Adapter `preventDefault` discipline**: wheel always; pointer events never; contextmenu always. (`touch-action: none` CSS suppresses browser touch defaults.)
16. **No object pooling for InputEvent.** Modern V8/JSC GC handles input-event allocation rates trivially; matches Hammer.js / use-gesture.
17. **Modern browsers only.**

---

## Alternatives considered

### Alt A — Thin coordinator over existing buses

Keep PointerEventBus, TouchEventBus, EventRouter, wheel useEffect; add coordinator. Doesn't solve directive enum, duplicated debouncers, scrollable content support, empty-space tap synthesis, parallel listeners. **Rejected.**

### Alt B — InputTarget tree with capture/bubble walks (the v1 draft)

Build a parallel target tree spanning canvas root → entities → sub-zones. Reinvents what React/R3F provide for free. **Rejected.**

### Alt C — Default consume (the v2 framing)

Inverts DOM semantics. **Rejected.**

### Alt D — Replace R3F's mesh-dispatch internals

Mesh handlers register as InputTargets in our system; reimplement R3F's bubble, hover diff, click synthesis. 5× the migration cost. **Rejected.**

### Alt E — Bevy-style "input as resources"

Discrete events don't map cleanly to polled state. **Rejected.**

### Alt F — No recognizer layer

Reinvents gesture math everywhere. **Rejected.**

### Alt G — Separate TouchAdapter

Required only if pointer-event synthesis from touch is unreliable. With `touch-action: none` on the canvas container, modern browsers synthesise reliably. **Rejected** in favour of single PointerAdapter.

### Alt H — Object pooling for InputEvent

Saves ~1000 allocations/sec; modern GC handles it. Hammer.js, use-gesture don't pool. **Rejected.**

### Alt I — Two parallel listeners (PointerAdapter + R3F's own)

The v4 architecture. PointerAdapter and R3F's listener both fire on every event; coordination via idempotent engine semantics + native `setPointerCapture`. Works, but two pipelines is a worse mental model than one. **Rejected** in favour of pure-router architecture (option 1 from the v5 brainstorm), with v4's parallel-listeners pattern reserved as a fallback if the Phase 1 R3F spike reveals R3F's API doesn't allow external invocation.

---

## Open questions

1. **R3F spike — RESOLVED 2026-04-28.** Pure-router architecture confirmed feasible. `@react-three/fiber@9.5.0` `EventManager.handlers` is `{ onClick, onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel, onLostPointerCapture, onContextMenu, onDoubleClick, onWheel }` — each value a function `(nativeEvent: DomEvent) => void` produced by R3F's internal `handlePointer(name)` factory. `connect`/`disconnect` are typed optional (`?:`) so overriding both to no-ops is type-clean. The existing `EventRouter.ts` already wraps `createPointerEvents` and overrides `compute` + `filter` for per-widget raycasting; v5's `R3FRouter` keeps those overrides and adds `connect`/`disconnect` no-ops, then invokes `manager.handlers.onPointerDown(event.native)` etc. from the InputManager dispatch loop. R3F's bubble, click synthesis, hover diff, `onPointerMissed` fan-out are all preserved. The fallback (parallel-listener architecture) is no longer needed.

2. **iOS Safari 16+ manual QA**: drag past viewport, multi-touch pinch upgrade during drag, in-widget setPointerCapture. Phase 3 verification matrix.

3. **PinchRecognizer end → single-finger handoff**: when 2nd finger lifts, the remaining pointer continues normally via PointerAdapter. PinchRecognizer emits `pinch-end`; remaining finger's events arrive at DragRecognizer with no prior `down` (cleared on pinch-start cancel). Lean: user must lift and re-place to start a new gesture (matches iOS — pinch-end leaves you at-rest). Phase 2 user test confirms UX.

---

## Risks

- **Phase 3 breaks engine's public API**: `engine.handlePointerDown` exported. Plan: bump to 2.0 with Phase 3.
- **Phase 1 R3F spike**: if R3F's EventManager API doesn't allow external invocation cleanly, fall back to parallel-listener architecture (the v4 design). Spec amended to document this fallback path explicitly during Phase 1.
- **Widget code that relied on tracking-state-per-pointerdown**: today, every pointerdown calls `engine.handlePointerDown`. After Phase 3, only `tap` or `drag-start` trigger engine state. Validate against playground before Phase 3 lands.

---

## Revision notes

**v5** — 2026-04-28. Pure-router architecture: one pipeline, R3F's event manager no longer registers native listeners. PointerAdapter is the only pointer-event listener on the canvas container; `R3FRouter` invokes R3F's mesh dispatch from the InputManager's dispatch loop. All interfaces tightened with explicit type signatures (Adapter, Recognizer, WidgetSurfaceRouter, InputManager, InputEvent, GestureDetail). Constants centralised. Phase 1 spike validates R3F's external-invocation API; v4's parallel-listeners pattern is the documented fallback if the spike reveals incompatibility.

**v4** — 2026-04-28. Dropped TouchAdapter (PointerAdapter covers touch via browser synthesis); EventRouter "preserved as-is" via parallel-listener architecture; pinch+drag and pinch+pan relationships clarified.

**v3** — 2026-04-28. Substantial simplification: dropped target tree, capture map, consume API, directive enum from the model.

**v2** — 2026-04-28. Two-layer model with default-bubble, explicit `stopPropagation`. Removed target tree.

**v1** — 2026-04-26. Initial draft with InputTarget tree + sub-zones + capture/bubble walks. Structurally correct but heavier than necessary.

Open items deferred to future RFCs: action mapping (recognizer pattern admits it), wrapper-widget spatial parents (wrapper widget is just another widget), kinetic / momentum scrolling on pan, simultaneous multi-pointer drag (model admits via per-pointerId state; not validated in v1).
