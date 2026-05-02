# RFC-009: Two-Layer Input Pipeline + ECS State Machine

- **Status**: Draft v2
- **Author**: James Yong
- **Date**: 2026-05-01
- **Area**: Interaction / Input / Engine API / ECS Components & Resources / R3F Layer / DOM Widget Layer
- **Related**: RFC-001 (ECS Hitbox — `pickAt`), RFC-005 (engine-rendered resize handles), RFC-008 (Input Manager — adapters/recognizers/router), `docs/diagrams/input-pipeline.md` (smell list 5.1–5.9)
- **Supersedes**: The runtime pipeline introduced by RFC-008 — `InputManager`, the recognizer registry (`HoverRecognizer`, `TapRecognizer`, `DoubleTapRecognizer`, `DragRecognizer`, `PinchRecognizer`, `PanRecognizer`), `installEngineHandlers`, `R3FRouter`'s `internal.capturedMap` probe, and the engine's `pickAt`/`hitTest` API split. Adapters survive but are repurposed as raw-event sources only.

---

## Summary

RFC-008 v6 unified the four native channels into one dispatcher (smell 5.1). What remains is the bigger problem: the post-dispatch pipeline has no top-level coordination. Six independent recognizers each maintain per-pointer state, observe events in parallel, and resolve conflicts through synthetic-event choreography. The engine has its own state machine that reacts to recognizer output. Hit-tests run 3–4 times per pointermove because no module owns the answer. Hover state has been written from up to three places at different times in different code revisions.

RFC-009 redesigns the post-dispatch pipeline around two ideas:

1. **Two-layer input pipeline.** A bottom layer (`RawInputPipeline`) normalizes platform events into a typed `RawInputEvent` stream. An upper layer (`GesturePipeline`) consumes that stream and emits abstract gestures (`hover`, `pan`, `pinch`, `tap`, `double-tap`, `drag`, `context-menu`). Every gesture event is enriched with `surface` and `surfaceHandled` *once* before any consumer sees it. Adapters know nothing about widgets; gestures know nothing about platform events.

2. **ECS state machine via the state pattern.** Five top-level states (`idle`, `marquee-selecting`, `marquee-selected`, `widget-selected`, `widget-dragging`) each become a system in the ECS. Only the system matching the current state runs in any tick. State systems consume gesture events and may transition state by writing a resource. Camera operations (pan/pinch on canvas, wheel) live in a separate state-independent system because they apply in every state.

The gesture pipeline replaces every recognizer file. The state systems replace `installEngineHandlers`. The R3F `internal.capturedMap` probe is replaced by automatic detection: a slot-equality test for DOM widgets and a raycast-result test for R3F widgets — widget authors write plain React/R3F with no framework hooks or claim-API calls. The result: one hit-test per gesture event, one hover writer, no recognizer-ordering footguns, no R3F private-state probes.

Net delta: roughly **−1700 LOC, +900 LOC**. Behavioural parity with v6 plus the corrections enumerated in §13.

---

## Motivation

### Smells addressed

| RFC-008 smell (`docs/diagrams/input-pipeline.md` §5) | Root cause | RFC-009 resolution |
|---|---|---|
| 5.1 Four parallel native channels | (already fixed in v6) | — |
| 5.2 R3F-only claim probes private state | Capture detected post-hoc | Automatic: slot-equality test (DOM) / raycast-result test (R3F); no widget-side framework calls |
| 5.3 `pickAt` runs 3–4× per pointermove | Each layer hit-tests independently | Single hit-test in the enrichment step; gesture context freezes hit at gesture-start |
| 5.4 Hover state written from 3 places | Move handler + recognizer + pointerleave race | One writer: the `idle` state system on `hover` events |
| 5.5 Recognizer ordering matters but is undocumented | Six independent observers with implicit choreography | One coherent `GesturePipeline` module; no recognizer registry |
| 5.6 `pickAt` and `hitTest` are the same function with two return shapes | Historical | Single `engine.hit(): HitResult \| null` |
| 5.7 Default coexistence has more failure modes than successes | Click side-channel + asymmetric capture | (5.1 fixed in v6); `surfaceHandled` makes coexistence first-class |
| 5.8 `InputEvent` is a loose optional bag | Not discriminated | `RawInputEvent` and `GestureEvent` are discriminated unions on `kind` |
| 5.9 `manager.on(type, handler)` loses type narrowing | Generic handler signature | Typed `pipeline.on<K>(kind, handler)` returns `GestureEventOf<K>` |

### Other wins

- **State systems read like English.** A new contributor can open `widget-selected.ts` and see every transition in the file without grepping six other files.
- **Adding a state = adding a system.** No central transition table to edit; the ECS scheduler picks the running state by resource.
- **Camera always responsive.** Pan/pinch/wheel work in every state because they're a separate system, not gated by FSM transitions.
- **Two distinct meanings of "the user is doing X" stop conflating.** Today's engine `inputState.mode` mixes "drag in flight" with "selection chrome should render" with "fly-back animation running." Each becomes a separate explicit concept.

### What this RFC is *not*

- Not a rewrite of the engine's effect API. `engine.beginDrag` / `engine.updateMarquee` / `engine.beginResize` etc. stay. Their *callers* move from `installEngineHandlers` callbacks to state-system transitions.
- Not multi-pointer simultaneous independent gestures. Pinch is a multi-pointer gesture with one shared center; "stylus on widget A while mouse drags widget B" is not supported.
- Not action-mapping (keyboard shortcuts, command palette). Future RFC.
- Not focus management. The current canvas-focus model survives unchanged.
- Not a new author-facing API for widgets. Widgets keep using React/R3F handlers as today; the framework infers ownership from event target / raycast result, not from any claim API.

---

## Architecture overview

```
┌────────────────────────────────────────────────────────────┐
│ Layer 1 — RawInputPipeline                                 │
│   PointerAdapter, WheelAdapter, ClickAdapter               │
│   emits: RawInputEvent (discriminated by `kind`)            │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│ Layer 2 — GesturePipeline                                  │
│   consumes RawInputEvent, emits GestureEvent                │
│   gestures: hover, pan, pinch, tap, double-tap, drag,       │
│             context-menu                                    │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│ Hit-test enrichment                                         │
│   one engine.hit() call per gesture event                   │
│   enriches with: surface, surfaceHandled, hit               │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│ Layer 3a — State systems (ECS, only the active one runs)    │
│   idleSystem, marqueeSelectingSystem, marqueeSelectedSystem,│
│   widgetSelectedSystem, widgetDraggingSystem                │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│ Layer 3b — Camera system (ECS, runs in every state)         │
│   handles: pan(surface=canvas), pinch(surface=canvas),      │
│            wheel                                            │
└────────────────────────────────────────────────────────────┘
                          ↓
                  engine.* effects
                  (beginDrag, panBy, zoomAtPoint, ...)
```

### File layout

```
src/input/
  raw/                              ← Layer 1
    PointerAdapter.ts                normalize pointer events
    WheelAdapter.ts                  normalize wheel events
    ClickAdapter.ts                  normalize click/dblclick/contextmenu
    types.ts                         RawInputEvent discriminated union

  gesture/                          ← Layer 2
    GesturePipeline.ts               single coherent recognizer module
    enrich.ts                        hit-test enrichment
    types.ts                         GestureEvent discriminated union

  index.ts                           public API: createInputPipeline()

src/ecs/
  resources.ts                      + InputStateResource, PointerStateResource
  components.ts                     + Hovered tag (Selectable already exists)
  systems/
    state/                          ← Layer 3a
      idle.ts
      marquee-selecting.ts
      marquee-selected.ts
      widget-selected.ts
      widget-dragging.ts
      scheduler.ts                  picks the active state system per tick
    camera.ts                       ← Layer 3b (state-independent)
    hover.ts                        owns the Hovered tag, reacts to PointerStateResource
    cursor.ts                       reads Hovered + InputStateResource → CursorResource
```

The `src/react/input/` directory created by RFC-008 is fully replaced. Adapters move to `src/input/raw/` and lose their tight coupling to `InputManager`.

---

## Layer 1 — RawInputPipeline

A thin, surface-agnostic layer. Job: turn DOM events into a typed, normalized stream. Nothing else.

### Type

```ts
export type RawInputEvent =
  | RawDown
  | RawMove
  | RawUp
  | RawCancel
  | RawLeave
  | RawWheel
  | RawClick
  | RawDblClick
  | RawContextMenu;

interface RawCommon {
  readonly screen: Readonly<Point>;        // canvas-container relative px
  readonly world:  Readonly<Point>;        // post-camera world coords
  readonly modifiers: Readonly<Modifiers>; // shift/ctrl/alt/meta — sourced directly
                                           // from PointerEvent / MouseEvent / WheelEvent
  readonly timestamp: number;
  readonly native: Event;                  // underlying DOM event
}

interface RawPointerCommon extends RawCommon {
  readonly pointerId: number;
  readonly primary: boolean;
  readonly source: 'mouse' | 'pen' | 'touch';
}

export interface RawDown        extends RawPointerCommon { kind: 'down'; button: Button; }
export interface RawMove        extends RawPointerCommon { kind: 'move'; delta: Readonly<Point>; }
export interface RawUp          extends RawPointerCommon { kind: 'up';   button: Button; }
export interface RawCancel      extends RawPointerCommon { kind: 'cancel'; }
export interface RawLeave       extends RawPointerCommon { kind: 'leave'; }
export interface RawWheel       extends RawCommon       { kind: 'wheel'; delta: { dx: number; dy: number }; pinch: boolean; }
export interface RawClick       extends RawCommon       { kind: 'click';       button: Button; pointerId: number; }
export interface RawDblClick    extends RawCommon       { kind: 'dblclick';    pointerId: number; }
export interface RawContextMenu extends RawCommon       { kind: 'contextmenu'; pointerId: number; }
```

Discriminated by `kind`. `screen`/`world`/`modifiers` are present on every variant; per-kind fields are type-safe.

Keyboard events are intentionally not modeled in v2 — modifier state (shift/ctrl/alt/meta) arrives natively on every pointer / wheel / click event. Keyboard-driven actions (delete key, undo, escape, etc.) are deferred to a future RFC. No `KeyAdapter` is needed to make the input pipeline work.

### Adapters

Three adapters, each owns the listeners for its DOM event family. Each one accepts an `(event: RawInputEvent) => void` sink. They all mount on the canvas-container `<div>`.

```ts
interface RawAdapter {
  attach(container: HTMLElement, sink: (e: RawInputEvent) => void): () => void;
}

class PointerAdapter implements RawAdapter { /* down/move/up/cancel/leave */ }
class WheelAdapter   implements RawAdapter { /* wheel (passive: false; preventDefault) */ }
class ClickAdapter   implements RawAdapter { /* click/dblclick/contextmenu */ }
```

Adapters do **not** call `engine.pickAt`, do **not** know about widgets, do **not** see the gesture pipeline. They emit raw events and stop.

### Native-interactive skip

The `NATIVE_INTERACTIVE_SELECTOR` skip survives. It applies at the adapter layer (the lowest possible point), before the raw event is emitted. A `pointerdown` on a `<button>` inside a DOM widget is suppressed at `PointerAdapter`, never reaches the GesturePipeline. Same rule for `click`/`dblclick` in `ClickAdapter`. `contextmenu` always fires `preventDefault` (canvas isn't a place for the browser context menu) but skips dispatch on native interactive.

---

## Layer 2 — GesturePipeline

One stateful module. Consumes `RawInputEvent`, emits `GestureEvent`. Replaces every recognizer file.

### Type

```ts
export type GestureEvent =
  | HoverGesture
  | PanGesture
  | PinchGesture
  | DragGesture
  | TapGesture
  | DoubleTapGesture
  | ContextMenuGesture;

interface GestureCommon {
  readonly screen: Readonly<Point>;
  readonly world:  Readonly<Point>;
  readonly modifiers: Readonly<Modifiers>;
  readonly timestamp: number;

  /** Populated by the enrichment step before any consumer sees it. */
  readonly surface: Surface;          // 'canvas' | 'widget' | 'chrome'
  readonly surfaceHandled: boolean;   // widget rendered something at the event's target (DOM)
                                      // or raycast hit a mesh inside the widget's scene (R3F)
  readonly hit: Hit | null;           // entityId + role; frozen at gesture-start, repeated on update/end
}

export interface HoverGesture        extends GestureCommon { kind: 'hover'; phase: 'enter' | 'move' | 'leave'; pointerId: number; }
export interface DragGesture         extends GestureCommon { kind: 'drag'; phase: 'start' | 'update' | 'end' | 'cancel'; pointerId: number; delta: Point; total: Point; button: Button; }
export interface PanGesture          extends GestureCommon { kind: 'pan'; phase: 'start' | 'update' | 'end'; pointerIds: readonly number[]; center: Point; delta: Point; }
export interface PinchGesture        extends GestureCommon { kind: 'pinch'; phase: 'start' | 'update' | 'end'; pointerIds: readonly [number, number]; center: Point; scale: number; }
export interface TapGesture          extends GestureCommon { kind: 'tap'; pointerId: number; button: Button; }
export interface DoubleTapGesture    extends GestureCommon { kind: 'double-tap'; pointerId: number; }
export interface ContextMenuGesture  extends GestureCommon { kind: 'context-menu'; pointerId: number; }
```

Wheel is **not** a gesture. Wheel is a low-level camera signal handled by the camera system directly. Treating it as a gesture would force the surface concept onto whole-canvas operations that don't have a meaningful target.

### Internal state

```ts
class GesturePipeline {
  // per-pointer down position + time, used for tap/dead-zone/long-press
  private readonly tracking = new Map<number, {
    downAt: Point;
    downTime: number;
    button: Button;
    handled: boolean;        // frozen at gesture-start; mirrors the slot/raycast detection result
  }>();

  // Set of pointers currently producing 'drag' events.
  private readonly dragging = new Set<number>();

  // Two-pointer gesture (pinch/pan) bookkeeping.
  private pinch: { ptrs: [number, number]; lastCenter: Point; lastDist: number } | null = null;

  // Last hovered entity, per pointer.
  private readonly lastHover = new Map<number, EntityId | null>();

  // Last tap (for double-tap detection).
  private lastTap: { time: number; screen: Point; pointerId: number } | null = null;

  consume(raw: RawInputEvent): readonly GestureEvent[] { /* … */ }
}
```

### Recognition rules (informal)

- **`down`** → start tracking pointer; if it's the second active pointer for `dragging`/`tracking`, transition to pinch (cancel any in-flight drag for the first pointer with `phase: 'cancel'`).
- **`move`** while tracking, past dead-zone → emit `drag` with `phase: 'start'` if first move, else `'update'`. Single-pointer.
- **`move`** while two pointers tracked → emit `pinch` (always — distance change drives `scale`) and `pan` (center delta drives camera pan in case of two-finger pan; downstream camera system handles both).
- **`move`** with no down → emit `hover` with `phase: 'move'`. Hover-enter/leave fired on entity transition (handled at enrichment time — see §6).
- **`up`** within `TAP_WINDOW_MS` and dead-zone → emit `tap`. If a second tap arrives within `DOUBLE_TAP_WINDOW_MS`, emit `double-tap` instead of the second `tap`.
- **`up`** during drag → emit `drag` with `phase: 'end'`.
- **`cancel`** → emit `drag` with `phase: 'cancel'` for any in-flight drag; clear all tracking for that pointer.
- **`leave`** → emit `hover` with `phase: 'leave'` for the pointer.
- **`contextmenu`** → emit `context-menu`.

`DoubleTapRecognizer`, `LongPressRecognizer`, etc. are **methods on `GesturePipeline`**, not separate registered observers. Pairwise relationships (drag-cancels-tap, pinch-cancels-drag) are explicit in the consume function, not implicit through synthetic-event choreography.

### Detecting widget-handled events (replaces R3F internal probe)

Widget authors write plain React / R3F. They register `onPointerDown`, `onClick`, etc. on the elements they care about. They never call any framework API to "claim" a gesture. The framework detects ownership automatically by observing the event target.

#### DOM widgets — slot-equality test

The framework owns `WidgetSlot` (the wrapper div around every DOM widget's rendered content). When a raw event reaches the canvas-container adapter at bubble phase, the framework checks `e.target`:

- `e.target === widgetSlot` — the event hit the wrapper itself (empty area inside the widget's bounding box where the widget rendered nothing). Widget didn't claim. `surfaceHandled = false`.
- `e.target` is any descendant of the slot — the user pointed at something the widget rendered. Widget owns the gesture. `surfaceHandled = true`.

```ts
// Pseudocode in the enrichment step
function isHandledByDomWidget(rawNative: Event, slotElement: HTMLElement): boolean {
  return rawNative.target !== slotElement;
}
```

A small `slotRefs: Map<EntityId, HTMLDivElement>` (the same registry `InfiniteCanvas.tsx` already maintains for transform updates) is the lookup.

#### R3F widgets — raycast-result test

R3F shares a single `<canvas>` element across all webgl widgets, so `e.target` is always the canvas; the slot-equality test doesn't apply.

For R3F, the right signal is whether R3F's raycaster (run inside `compute`) intersected any mesh inside the widget's scene. If yes, the user pointed at something the widget rendered (a mesh). If no, the cursor was within the widget's screen-space bounding rect (so `engine.hit()` resolved it) but missed every mesh — the widget didn't claim.

```ts
// Inside the modified createR3FEventManager, after R3F's raycast runs:
const meshIntersected = state.internal.intersections.some(
  (i) => isDescendantOf(i.object, widget.scene),
);
r3fHandledEvents.set(rawNativeEvent, meshIntersected);

// In the enrichment step:
function isHandledByR3FWidget(rawNative: Event): boolean {
  return r3fHandledEvents.get(rawNative) ?? false;
}
```

The `r3fHandledEvents` is a `WeakMap<Event, boolean>` populated per-event during R3F's dispatch. Because R3F's dispatch runs synchronously inside `router.route(...)` (called from the GesturePipeline's enrichment for webgl-surface gestures), the result is available when enrichment writes `surfaceHandled`.

#### Unified call site

```ts
function detectSurfaceHandled(raw: RawInputEvent, hit: Hit | null): boolean {
  if (!hit) return false;
  const widget = engine.get(hit.entityId, Widget);
  if (widget?.surface === 'webgl') {
    return r3fHandledEvents.get(raw.native) ?? false;
  }
  // dom (or default)
  const slot = slotRefs.get(hit.entityId);
  return slot != null && raw.native.target !== slot;
}
```

#### What widget authors write

The same plain React/R3F code they write today. **No `setPointerCapture` call. No framework hook. No `handle()` method.**

```tsx
// DOM widget
function MyShape() {
  return (
    <div onPointerDown={(e) => /* widget logic */}>
      <button onClick={...}>Action</button>
    </div>
  );
}
```

```tsx
// R3F widget — the orbit cube post-RFC-009
function OrbitCubeScene({ data }) {
  return (
    <mesh
      onPointerDown={(e) => {
        e.stopPropagation();
        // ... orbit logic ...
        // No setPointerCapture call. Framework detects mesh-was-hit
        // automatically via the raycast result.
      }}
    >
      ...
    </mesh>
  );
}
```

The current `OrbitCubeCard.setPointerCapture` deletes. The framework's R3F event manager populates `r3fHandledEvents` with `true` whenever the raycast hits a mesh; the GesturePipeline propagates that to `surfaceHandled`; the `idle` state system sees `surfaceHandled === true` on `drag-start` and stays in idle (engine doesn't fire `beginDrag`).

#### Design rule for widget authors

> **If your widget renders an element inside the slot, that element owns interaction at its position.** A click on it doesn't fall through to the canvas. A drag on it doesn't move the widget.
>
> If your widget renders something *passive* that you want to be transparent to interaction (a decorative `<img>`, a label that shouldn't block dragging the card chrome around it), opt out with one of:
>
> - `<img data-passive>` — framework treats this element as if it weren't rendered for hit-detection purposes
> - `<img style={{ pointerEvents: 'none' }}>` — same effect, plus the browser doesn't dispatch any pointer events to it at all
>
> Choose `pointer-events: none` if you also want the element to be invisible to widget-internal handlers (the click goes to whatever is behind it). Choose `data-passive` if you want widget-internal handlers to still fire (e.g. hover effects on the image) but you want canvas-level gestures (drag the card) to work *over* it.

`data-passive` detection is one extra `closest()` call in the slot-equality test:

```ts
const target = raw.native.target as HTMLElement | null;
if (target?.closest('[data-passive]')) return false;  // not handled, fall through
return target !== slot;
```

#### Future: dev-mode warning

In development builds, when a gesture would be marked `surfaceHandled = true` solely because a passive-looking element (an `<img>`, `<svg>`, `<span>` with no event handlers) was the target, we can emit a console warning:

> "Element `<img src=...>` inside widget `card-3` blocks canvas-level interaction. Add `data-passive` or `pointer-events: none` if this is decorative content."

This is heuristic and noisy; it's a v3 feature, not v2. Documented here so we don't lose the idea.

#### DOM `setPointerCapture` is a consequence, not the source of truth

When the GesturePipeline transitions a pointer into a tracked-drag state (regardless of `surfaceHandled`), it issues `setPointerCapture(pointerId)` on the canvas container so the pointer stream survives the cursor leaving the original target's bounds. Capture is a *delivery mechanism*, not a claim mechanism.

---

## Hit-test enrichment

A pure function that runs once per gesture event between `GesturePipeline.consume()` and any consumer:

```ts
function enrich(raw: GestureEvent, engine: LayoutEngine, native: Event): GestureEventEnriched {
  // For continuing gestures (drag-update, pinch-update, etc.), reuse the hit
  // frozen at gesture-start. The pipeline carries `_startHit` internally.
  if (raw.kind === 'drag' && raw.phase !== 'start')   return { ...raw, ...frozenHit };
  if (raw.kind === 'pinch' && raw.phase !== 'start')  return { ...raw, ...frozenHit };
  if (raw.kind === 'pan' && raw.phase !== 'start')    return { ...raw, ...frozenHit };

  // For hover/tap/dblclick/contextmenu/start phases, run engine.hit() once.
  const hit = engine.hit(raw.screen.x, raw.screen.y);
  const surface: Surface =
    hit === null                              ? 'canvas' :
    hit.role.role.type === 'resize'           ? 'chrome' :
                                                'widget';
  const surfaceHandled = surface === 'widget'
    ? detectSurfaceHandled(native, hit, engine)
    : false;  // canvas and chrome are framework-owned; never widget-handled

  return { ...raw, surface, surfaceHandled, hit };
}
```

The three surfaces:

- **`canvas`** — `hit === null`. Empty canvas area, no widget, no chrome. `surfaceHandled` is always `false`.
- **`widget`** — `hit.entityId !== null && hit.role.role.type !== 'resize'`. Pointer is over a widget. `surfaceHandled` is computed via the slot-equality test (DOM widgets) or raycast-result test (R3F widgets), per §5. State systems read this to decide whether engine reacts.
- **`chrome`** — `hit.role.role.type === 'resize'`. Pointer is over an engine-drawn resize hotspot. Always framework-owned; `surfaceHandled` is always `false`.

The `Widget.surface` component (`'dom' | 'webgl' | 'webview'`) is **not** the same as the gesture event's `surface` enum. The component records *how the widget renders*; the gesture event's `surface` records *what kind of thing the user is pointing at* (canvas / widget body / engine chrome). State systems read only the gesture-event `surface`. Delivery layers (R3F dispatch routing) read the component to know which dispatch path to use.

### Hit-freezing across multi-event gestures

A drag from start to end always reports `surface = X` at start and the same `surface` at update/end. The hit is *frozen at gesture-start*. This is what makes "click-and-drag a widget across the canvas" work cleanly: subsequent `drag-update` events don't re-resolve the surface mid-gesture even if the cursor crosses other widgets. The widget that was hit at gesture-start owns the gesture's lifetime.

This eliminates the redundant pickAt calls (smell 5.3): single hit-test at gesture-start, reused for the gesture's duration.

### `engine.hit()`

Replaces `engine.pickAt` and `engine.hitTest`. Single signature, single return shape:

```ts
interface Hit {
  readonly entityId: EntityId;
  readonly role: InteractionRoleData;       // { layer, role: { type: 'drag'|'select'|'resize'|... } }
  readonly worldPoint: Point;
}

interface LayoutEngine {
  // … existing …
  hit(screenX: number, screenY: number): Hit | null;
  // pickAt and hitTest deleted.
}
```

Implementation reuses the existing internal `hitTest` (already does the right thing — RBush spatial index + `Active` filter + `InteractionRole.layer`/`ZIndex` sort).

---

## State machine — five states

State is held in a resource:

```ts
export type InputState =
  | { kind: 'idle' }
  | { kind: 'marquee-selecting'; origin: Point; pointerId: number }
  | { kind: 'marquee-selected'; selection: readonly EntityId[] }
  | { kind: 'widget-selected'; selection: readonly EntityId[] }
  | { kind: 'widget-dragging'; entityId: EntityId; pointerId: number; subMode: 'drag' | 'resize' | 'marquee-move' };

export const InputStateResource = defineResource<{ state: InputState }>(
  'InputState',
  { state: { kind: 'idle' } },
);
```

The ECS scheduler reads `InputStateResource.state.kind` and runs **exactly one** state system per tick. State systems consume `GestureEventEnriched[]` (drained from a per-tick queue) and may produce ECS commands (engine effects + state transitions).

### State transition diagram

```
                                ┌──── tap(canvas) ──── widget-selected
                                ▼                       ▲          │
                              idle ───┐                 │          │
                              ▲ ▲    │ tap(widget,            │
                              │ │    │  selectable)            │ tap(canvas)
              tap(non-selectable      └─────────────►          │  or tap(non-
              widget)│ │                                    │   selectable)
                     │ │                                    │
   drag(canvas)      │ │                                    │
   ────────►   marquee-selecting                            │
                     │                                      │
              drag-end                                      │
                     ▼                                      │
                marquee-selected ──── tap(widget,           │
                     │            ▲          selectable) ──┘
                     │            │
                     └─ drag(*) ──┘
                        (move marquee selection)

   Anywhere ── drag(widget, !surfaceHandled) ──► widget-dragging
                                                    │
                                            drag-end:
                                            if Selectable → widget-selected
                                            else          → idle
```

### State system contracts

Each state system is a function `(world, events: GestureEventEnriched[]) => void`. It:

1. Reads gesture events from the per-tick queue.
2. Branches on `event.kind` and `event.surface` (and sometimes `surfaceHandled`).
3. Writes engine effects via the existing engine API (`engine.beginDrag`, etc.).
4. May write `InputStateResource.state` to transition.

Events that don't appear in a state's branches are dropped (no recognizer-style fan-out). Events handled by widgets (`surfaceHandled === true`) are usually dropped — see §10.

---

### State system: `idle`

```
hover(surface=canvas):                         no-op
hover(surface=widget,  surfaceHandled=true):   no-op (widget owns hover)
hover(surface=widget,  surfaceHandled=false):  hoverSystem updates Hovered tag
hover(surface=chrome):                         hoverSystem updates Hovered tag (resize cursor)

tap(surface=canvas):                           no-op
tap(surface=widget,  surfaceHandled=true):     no-op
tap(surface=widget,  surfaceHandled=false):
  if hit.entity has Selectable:
    engine.selectEntity(hit.entity, modifiers.shift)
    → transition: widget-selected { selection: [hit.entity] }
  else:                                        no-op
tap(surface=chrome):                           no-op

double-tap(surface=canvas):                    engine.zoomAtPoint (or no-op)
double-tap(surface=widget,  surfaceHandled=true):  no-op
double-tap(surface=widget,  surfaceHandled=false):
  if hit.entity is a Container:
    engine.enterContainer(hit.entity)
double-tap(surface=chrome):                    no-op

context-menu(surface=canvas):                  canvas context-menu (TODO: future)
context-menu(surface=widget):                  widget-type-specific context-menu (TODO: future)
context-menu(surface=chrome):                  no-op

drag(phase=start, surface=canvas):
  → transition: marquee-selecting { origin: world, pointerId }
  engine.clearSelection()
  engine.beginMarquee(world)
drag(phase=start, surface=widget,  surfaceHandled=true):
  no-op (widget owns the drag; the gesture continues but state stays idle)
drag(phase=start, surface=widget,  surfaceHandled=false):
  → transition: widget-dragging { entityId: hit.entity, pointerId, subMode: 'drag' }
  if hit.entity has Selectable AND not currently selected:
    engine.selectEntity(hit.entity, modifiers.shift)
  engine.beginDrag(hit.entity, world)
drag(phase=start, surface=chrome):
  → transition: widget-dragging { entityId: hit.entity, pointerId, subMode: 'resize' }
  engine.beginResize(hit.entity, hit.role.handle, world)

drag(phase=update, *):                         (only fires after a phase=start; handled in dragging states)

pan(*):                                        → camera system (state-independent)
pinch(*):                                      → camera system (state-independent)
context-menu(*):                               (handled above)
```

### State system: `widget-dragging`

Single sub-mode (`'drag' | 'resize' | 'marquee-move'`) carried in the state. All gesture events for any pointer other than `state.pointerId` are dropped.

```
drag(phase=update, pointerId == state.pointerId):
  switch state.subMode:
    'drag':         engine.updateDrag(state.entityId, world)
    'resize':       engine.updateResize(state.entityId, world)
    'marquee-move': engine.updateMarqueeMove(world)

drag(phase=end, pointerId == state.pointerId):
  switch state.subMode:
    'drag':         engine.endDrag(state.entityId, { cancelled: false })
    'resize':       engine.endResize(state.entityId, { cancelled: false })
    'marquee-move': engine.endMarqueeMove()

  if dragged entity has Selectable:
    → transition: widget-selected { selection: [state.entityId] }
  else:
    → transition: idle

drag(phase=cancel, *):
  engine.cancelInteraction()
  → transition: idle

pinch(phase=start):
  // second finger arrived during drag — cancel drag, transfer to camera pinch
  engine.cancelInteraction()
  → transition: idle
  (the pinch event is then re-routed through the camera system this tick)

all other gestures:                            dropped
```

### State system: `marquee-selecting`

```
drag(phase=update, pointerId == state.pointerId):
  engine.updateMarquee(world)

drag(phase=end, pointerId == state.pointerId):
  selection = engine.endMarquee()
  if selection.length === 0:
    → transition: idle
  else:
    → transition: marquee-selected { selection }

drag(phase=cancel):
  engine.cancelInteraction()
  → transition: idle

pinch(phase=start):                            cancel marquee, → idle, pinch re-routes
all other gestures:                            dropped
```

### State system: `marquee-selected`

```
hover(*):                                      hoverSystem updates Hovered tag (pre-action chrome)

tap(surface=canvas):
  engine.clearSelection()
  → transition: idle

tap(surface=widget, surfaceHandled=false):
  if hit.entity has Selectable:
    if modifiers.shift:
      engine.toggleSelection(hit.entity)
      stay in marquee-selected { selection: updated }
    else:
      engine.selectEntity(hit.entity, false)
      → transition: widget-selected { selection: [hit.entity] }
  else:
    engine.clearSelection()
    → transition: idle

tap(surface=chrome):                           no-op

drag(phase=start, surface=widget, hit.entity ∈ state.selection):
  → transition: widget-dragging { ..., subMode: 'marquee-move' }
  engine.beginMarqueeMove(world)
drag(phase=start, surface=canvas):
  // re-marquee
  engine.clearSelection()
  → transition: marquee-selecting { origin: world, pointerId }

context-menu(*):                               (TODO future)
pan/pinch:                                     → camera system
all other gestures:                            dropped
```

### State system: `widget-selected`

```
hover(surface=chrome):                         hoverSystem updates Hovered tag (resize cursor)
hover(surface=widget):                         hoverSystem (preview chrome)
hover(surface=canvas):                         no-op

tap(surface=canvas):
  engine.clearSelection()
  → transition: idle

tap(surface=widget, surfaceHandled=true):      no-op
tap(surface=widget, surfaceHandled=false):
  if hit.entity has Selectable:
    if modifiers.shift:
      engine.toggleSelection(hit.entity)
      stay (selection updated)
    else if hit.entity ∈ state.selection:
      stay (no-op; already selected)
    else:
      engine.selectEntity(hit.entity, false)
      stay { selection: [hit.entity] }
  else:
    // tap on non-selectable widget while selected = deselect (Option A)
    engine.clearSelection()
    → transition: idle

tap(surface=chrome):                           no-op

drag(phase=start, surface=chrome):
  → transition: widget-dragging { entityId: hit.entity, ..., subMode: 'resize' }
  engine.beginResize(hit.entity, hit.role.handle, world)

drag(phase=start, surface=widget, surfaceHandled=true):
  no-op (widget owns drag)

drag(phase=start, surface=widget, surfaceHandled=false):
  if hit.entity has Selectable:
    engine.selectEntity(hit.entity, modifiers.shift)
  else:
    engine.clearSelection()
  → transition: widget-dragging { entityId: hit.entity, ..., subMode: 'drag' }
  engine.beginDrag(hit.entity, world)

drag(phase=start, surface=canvas):
  // re-marquee from selected
  engine.clearSelection()
  → transition: marquee-selecting { origin: world, pointerId }

context-menu(*):                               (TODO future)
pan/pinch:                                     → camera system
all other gestures:                            dropped
```

---

## State-independent: camera system

Pan, pinch, and wheel apply in every state. They live in a separate system that runs **every tick**, before the state systems, on the same gesture-event queue:

```ts
function cameraSystem(world: World, events: GestureEventEnriched[]) {
  for (const e of events) {
    if (e.kind === 'pan' && e.surface === 'canvas') {
      engine.panBy(-e.delta.x, -e.delta.y);
      consumed.add(e);
    } else if (e.kind === 'pinch' && e.surface === 'canvas') {
      engine.zoomAtPoint(e.center.x, e.center.y, e.scale - 1);
      // two-finger pan component
      engine.panBy(centerDelta);
      consumed.add(e);
    } else if (e.kind === 'wheel') {
      if (e.pinch) engine.zoomAtPoint(e.screen.x, e.screen.y, -e.delta.dy * WHEEL_ZOOM_FACTOR);
      else         engine.panBy(-e.delta.dx, -e.delta.dy);
      consumed.add(e);
    }
  }
}
```

Consumed events are removed from the queue before the state system runs. Pan/pinch on a widget surface (with `surfaceHandled === false`) doesn't reach the camera system — that's the widget's gesture to handle (or to ignore, in which case nothing happens).

This decouples camera ops from FSM state. Pan/zoom while dragging = drag continues, camera pans underneath. Same as Figma. If we want to mute camera during specific states, the camera system reads the resource and gates — but the default is "always responsive."

---

## Hover system

Reads `PointerStateResource.screen` (last pointer position, written by adapters), calls `engine.hit()`, manages the `Hovered` tag, manages the resize-handle cache. **One writer.**

The `idle`, `widget-selected`, and `marquee-selected` state systems delegate hover handling to this system by writing to `PointerStateResource` and letting the hover system pick up. State systems don't touch hover state directly.

`hover-leave` semantics are handled by `RawLeave` → `GesturePipeline` → `hover` gesture with `phase: 'leave'` → state system clears the Hovered tag (or hover system observes the gesture queue directly — TBD in implementation).

This is one writer total. Smell 5.4 dissolves.

---

## Selectable gating (clarification)

The `Selectable` component already exists. It's a tag on entities that participate in selection chrome. RFC-009 makes the gating explicit at three transition points:

| Transition | If `Selectable` | Else |
|---|---|---|
| `idle.tap(widget, !handled)` | → widget-selected | no-op (stay idle) |
| `widget-selected.tap(widget, !handled)` | switch / toggle / stay | clear selection → idle |
| `widget-dragging.dragEnd` | → widget-selected | → idle |

Cards (move-only widgets) lack `Selectable` and therefore: tapping a card is a no-op, dragging a card moves it but doesn't enter selected state, dragging a card while another widget is selected clears the selection.

Selectable widgets (shapes, frames, etc.) get the full selection lifecycle.

---

## Engine effect API

Unchanged from today. State systems call:

- `engine.selectEntity(id, additive)`, `engine.clearSelection()`, `engine.toggleSelection(id)`
- `engine.beginDrag(id, world)`, `engine.updateDrag(id, world)`, `engine.endDrag(id, { cancelled })`
- `engine.beginResize(id, handle, world)`, `engine.updateResize(id, world)`, `engine.endResize(id, { cancelled })`
- `engine.beginMarquee(world)`, `engine.updateMarquee(world)`, `engine.endMarquee(): EntityId[]`
- `engine.beginMarqueeMove(world)`, `engine.updateMarqueeMove(world)`, `engine.endMarqueeMove()` (new — currently part of beginDrag with multi-selection)
- `engine.cancelInteraction()`
- `engine.panBy(dx, dy)`, `engine.zoomAtPoint(x, y, deltaZoom)`, `engine.zoomTo(zoom)`
- `engine.enterContainer(id)`
- `engine.hit(x, y): Hit | null` (replaces pickAt + hitTest)

The engine's internal `inputState.mode` becomes a derived shadow of `InputStateResource` for rendering needs (e.g. marquee box). One direction of truth: the resource leads, the engine state follows.

---

## Migration plan

Five phases, each green and shippable.

### Phase 1 — Engine API: collapse `pickAt` + `hitTest` → `hit()`

- Add `engine.hit(): Hit | null` to `LayoutEngine`. Internally delegates to today's private `hitTest(x, y)` (already does the right thing).
- Mark `pickAt` and `hitTest` (rich variant) deprecated. Delegate them to `hit()`.
- Update every internal caller: `InputManager.dispatch` step 1, `installEngineHandlers` (`tap`, `dblclick`, `drag-start`), `R3FRouter.compute`, `HoverRecognizer`, `engine.updateHover`.
- Pure refactor. No behaviour change. Validates the API shape.

### Phase 2 — `RawInputPipeline` extraction

- Add `src/input/raw/`. Move `PointerAdapter`/`WheelAdapter`/`ClickAdapter` from `src/react/input/adapters/` into the new home. Repurpose them to emit `RawInputEvent` instead of the v6 `InputEvent`.
- Adapters lose their `manager.dispatch(...)` coupling and gain a generic `(event: RawInputEvent) => void` sink.
- The existing `InputManager` in `src/react/input/InputManager.ts` consumes the new raw stream as a temporary shim (the v6 `InputEvent` becomes a thin wrapper around `RawInputEvent` with extra fields).
- No state-system changes yet. Validates the raw layer in isolation.

### Phase 3 — `GesturePipeline` parallel run

- Add `src/input/gesture/GesturePipeline.ts`. Single class, all recognition logic.
- Add the enrichment step.
- Wire it to the raw stream.
- Run it **alongside** the existing recognizer registry, behind a debug flag. Log every gesture event it emits and compare to the equivalent recognizer-emitted synthetic.
- No code consumes the new pipeline yet. Validates parity for at least one full session of playground use across mouse/touch/trackpad.

### Phase 4 — State systems + cutover

- Add `InputStateResource`, `PointerStateResource`, `Hovered` tag.
- Add the five state systems and the camera system.
- Add a feature flag (`RFC009_PIPELINE`) selecting old (recognizers + `installEngineHandlers`) or new (state systems).
- Wire state systems to the GesturePipeline output queue. Wire camera system to the same queue.
- Behind flag-on: `installEngineHandlers` is replaced by the state systems. `manager.on('drag-start', ...)` external API remains as a passthrough emitter.
- Validates feature parity in playground exhibits: card drag, shape resize, marquee, pinch zoom, click selection, R3F mesh interactions including `OrbitCubeCard` orbit-without-drag.

### Phase 5 — Delete v6 internals

- Delete `src/react/input/recognizers/` (six files).
- Delete `installEngineHandlers.ts`.
- Delete `R3FRouter.isPointerClaimed` and `createR3FEventManager.isPointerCaptured`. Replaced by automatic detection: slot-equality test for DOM widgets and raycast-result test for R3F widgets (§5).
- Delete `engine.pickAt`, `engine.hitTest`, `engine.handlePointer*` (deprecated since RFC-008 phase 3d).
- Delete the v6 `InputManager` class — `RawInputPipeline` + `GesturePipeline` + state systems are the new shape.
- Migrate widget exhibits: drop `setPointerCapture` calls in `OrbitCubeCard` and any other widget that used the v6 capture mechanism. The framework now detects mesh-was-hit automatically.
- Update `docs/diagrams/input-pipeline.md` to reflect the post-RFC-009 architecture.

Each phase is one PR, one merge, observable on main. Phase 4 carries the feature flag for one release cycle; Phase 5 removes it.

---

## What gets deleted

| Path | Reason |
|---|---|
| `src/react/input/recognizers/HoverRecognizer.ts` | Hover handled inline by GesturePipeline + hover system |
| `src/react/input/recognizers/TapRecognizer.ts` | Tap inlined into GesturePipeline |
| `src/react/input/recognizers/DoubleTapRecognizer.ts` | Double-tap inlined |
| `src/react/input/recognizers/DragRecognizer.ts` | Drag inlined |
| `src/react/input/recognizers/PinchRecognizer.ts` | Pinch inlined |
| `src/react/input/recognizers/PanRecognizer.ts` | Pan inlined |
| `src/react/input/installEngineHandlers.ts` | Replaced by five state systems + camera system |
| `src/react/input/InputManager.ts` | Replaced by RawInputPipeline + GesturePipeline + state systems |
| `src/react/input/routers/R3FRouter.isPointerClaimed` | Replaced by automatic raycast-result detection in the R3F event manager (§5) |
| `createR3FEventManager.isPointerCaptured` | Same — no more `internal.capturedMap` probe |
| `LayoutEngine.pickAt`, `LayoutEngine.hitTest` | Replaced by `LayoutEngine.hit` |
| `LayoutEngine.handlePointerDown/Move/Up/Cancel` | Already deprecated since RFC-008 phase 3d; finally removed |
| `LayoutEngine.setHoveredEntity`, `LayoutEngine.updateHover` | Replaced by `hoverSystem` writing the `Hovered` tag |
| `PointerDirective` enum | No external state-machine return needed |

Surviving from v6 / RFC-008:

- `PointerAdapter`, `WheelAdapter`, `ClickAdapter` (moved + repurposed to emit `RawInputEvent`)
- `NATIVE_INTERACTIVE_SELECTOR` (used by raw adapters)
- The engine's effect API
- The v6 click-family unification (no separate channels, no R3F connect-side listeners)

---

## Decisions

Resolved during RFC review. Listed here for traceability; the spec above reflects the chosen design.

1. **DOM widget event delivery.** ✅ **Resolved: slot-equality test (§5).** Widget authors write plain React. The framework owns `WidgetSlot`; the enrichment step compares `e.target` against the slot element. Target deeper than the slot ⇒ widget rendered something there ⇒ `surfaceHandled = true`. No widget-side framework calls. Passive elements (decorative `<img>`, etc.) opt out via `data-passive` or `pointer-events: none` — design rule, documented.

2. **R3F mesh handling.** ✅ **Resolved: raycast-result test (§5).** The R3F event manager records whether the raycast hit a mesh inside the active widget's scene. The result is read by the enrichment step. Mesh authors write plain `onPointerDown` — no `setPointerCapture` call, no framework hook. The current `OrbitCubeCard.setPointerCapture` deletes.

3. **Surface enum granularity.** ✅ **Resolved: `'canvas' | 'widget' | 'chrome'`.** No DOM/WebGL split at the gesture-event level. Systems that need to know the rendering surface read the `Widget.surface` component directly. Only the delivery layer cares about DOM-vs-R3F dispatch; state systems don't.

4. **Multi-touch beyond pinch.** Out of scope for v2. The GesturePipeline tracks exactly two pointers for pinch. A third arriving is dropped (no synthetic events emitted). Stylus + mouse on different widgets simultaneously is not supported. Future RFC if a use case emerges.

5. **`marquee-selected.tap(widget)` UX.** ✅ **Resolved: switch.** Plain tap on a widget while in marquee-selected commits to `widget-selected` with the new single target. Shift-tap toggles within the marquee selection (expand/contract). Matches Figma.

6. **State systems and CommandBuffer.** ✅ **Resolved: direct mutation.** State systems call the engine's effect API (`beginDrag`, `updateMarquee`, etc.) directly. The engine internally decides what to commit to CommandBuffer (only final commits are undoable; mid-gesture writes are live). No state-system-level command queueing.

7. **R3F mesh hover diff.** ✅ **Resolved: two parallel hover stories.** Engine-level hover (`Hovered` tag) is written by the active state system on `hover` gesture events — single writer. R3F mesh-level hover (mesh `onPointerOver` / `onPointerOut`) is fired by R3F's internal raycast diff inside the delivery layer for webgl widgets. Both run, both are intentional, no race.

8. **Devtools panel.** Defer to a future RFC. With state in `InputStateResource` and an inspectable gesture-event queue, a dedicated panel is straightforward to build.

9. **Spacebar pan / KeyAdapter.** ✅ **Resolved: dropped from v2.** Touch users get pinch + two-finger pan. Trackpad users get wheel-driven pan/zoom. Mouse users get scroll wheel. Spacebar pan is a Photoshop/Figma power-user shortcut whose absence is non-critical for v2. The KeyAdapter is removed; modifier state (shift/ctrl/alt/meta) flows natively on every pointer / wheel / click event. Future RFC can re-introduce keyboard-driven actions (delete key, undo, escape, spacebar pan) as a coherent unit.

---

## Appendix: example flows

### A.1 Click a shape (selectable) on canvas

```
PointerAdapter        pointerdown / pointerup (no movement)
RawInputPipeline      RawDown → RawUp (within tap window)
ClickAdapter          click (browser-native)
GesturePipeline       'tap' { kind: 'tap', pointerId: 0, screen, world, ... }
enrich                engine.hit() → { entityId: 42, role: { type: 'select' } }
                      → surface = 'widget', surfaceHandled = false, hit
idleSystem            tap(surface=widget, !handled, hit.entity has Selectable):
                      engine.selectEntity(42, false)
                      InputStateResource.state = widget-selected { selection: [42] }
```

### A.2 Drag a card (non-selectable)

```
PointerAdapter        pointerdown
                      pointermove × N (past dead zone)
GesturePipeline       'drag' { phase: 'start', pointerId, ... }
enrich                hit = { entityId: 17, role: { type: 'drag' } }
                      surface = 'widget', surfaceHandled = false
idleSystem            drag(start, widget, !handled):
                      engine.beginDrag(17, world)
                      state = widget-dragging { entityId: 17, pointerId, subMode: 'drag' }

(subsequent drag-update events skip enrich's hit-test — frozen at start)

PointerAdapter        pointermove × N
GesturePipeline       'drag' { phase: 'update', ... }
widgetDraggingSystem  drag(update, ptr matches state.pointerId):
                      engine.updateDrag(17, world)

PointerAdapter        pointerup
GesturePipeline       'drag' { phase: 'end', ... }
widgetDraggingSystem  drag(end):
                      engine.endDrag(17, { cancelled: false })
                      Card has no Selectable → state = idle
```

### A.3 R3F mesh owns drag (orbit cube)

```
PointerAdapter        pointerdown over R3F widget
RawInputPipeline      RawDown
                      → R3F dispatch runs: compute() raycasts, hits cube mesh
                        mesh onPointerDown fires (does its own state setup)
                        R3F event manager records: r3fHandledEvents[native] = true
                      → adapter bubble fires; framework reads the flag
GesturePipeline       (nothing yet — single pointer, no movement)

PointerAdapter        pointermove past dead zone
GesturePipeline       'drag' { phase: 'start', pointerId, ... }
enrich                hit = { entity: 42, role: { type: 'drag' } }
                      surface = 'widget'
                      surfaceHandled = r3fHandledEvents[native] → TRUE
idleSystem            drag(start, widget, surfaceHandled=true):
                      no-op (widget owns the drag)
                      state stays idle

(mesh onPointerMove handlers fire via the delivery layer — independent path)

PointerAdapter        pointerup
GesturePipeline       'drag' { phase: 'end', ... }
                      surfaceHandled = TRUE (frozen at gesture-start)
idleSystem            drag(end, surfaceHandled=true): no-op
```

The card never moved. The cube rotated. State stayed `idle` throughout. No `internal.capturedMap` probe. No `setPointerCapture` call in the widget. The mesh handler is plain R3F.

### A.4 Marquee → drag-move → re-select

```
state = idle
drag(start, canvas) → marquee-selecting { origin, ptr }
drag(update, ...)   → engine.updateMarquee
drag(end)           → selection = [17, 42, 99] → marquee-selected { selection }

drag(start, widget=42)
  hit.entity ∈ selection → widget-dragging { entityId: 42, ..., subMode: 'marquee-move' }
  engine.beginMarqueeMove(world)
drag(update)        → engine.updateMarqueeMove
drag(end)           → engine.endMarqueeMove
                      entity 42 has Selectable → widget-selected { selection: [17, 42, 99] }
                      // selection preserved
```

### A.5 Pinch over a card

```
state = idle (or any state)
PointerAdapter        1st pointerdown
PointerAdapter        2nd pointerdown (within pinch threshold)
GesturePipeline       'pinch' { phase: 'start', pointerIds: [0, 1], center, scale: 1 }
                      // any in-flight drag for ptr 0 emitted as 'drag' { phase: 'cancel' }
                      // (consumed by widget-dragging if active, else dropped)
enrich                surface = 'canvas' (center over canvas)
cameraSystem          pinch(start, canvas):
                      engine.zoomAtPoint(center, 0)  // initial
                      consumed (not visible to state systems)

PointerAdapter        pointermoves
GesturePipeline       'pinch' { phase: 'update', scale: 1.05, center: ... }
cameraSystem          engine.zoomAtPoint(center, scale - 1)
                      engine.panBy(centerDelta)

PointerAdapter        pointerup (one finger)
GesturePipeline       'pinch' { phase: 'end' }
cameraSystem          (no-op; cleanup internal)
```

State system never saw the pinch — camera system consumed it. State stays whatever it was.

### A.6 Decorative passive content inside a widget

```
PointerAdapter        pointerdown on a card; e.target is a decorative <img>
                      inside the card body, marked data-passive
RawInputPipeline      RawDown
GesturePipeline       (single down, no gesture yet)

PointerAdapter        pointermove past dead zone
GesturePipeline       'drag' { phase: 'start', pointerId, ... }
enrich                hit = { entity: 17, role: { type: 'drag' } }
                      surface = 'widget'
                      surfaceHandled detection:
                        e.target.closest('[data-passive]') matches
                        → surfaceHandled = false (passive opt-out)
idleSystem            drag(start, widget, surfaceHandled=false, !Selectable):
                      engine.beginDrag(17, world)
                      state = widget-dragging { entityId: 17, subMode: 'drag' }
```

Without `data-passive`, the same flow would have `surfaceHandled = true` (target ≠ slot), and the drag would be a no-op. The widget author opted the `<img>` out, restoring "drag the card by its image" behaviour.

---

## Changelog

- **v2 (2026-05-01)**: Replace v1's `<InputSurface>`-blocking-DOM design with a two-layer pipeline (RawInputPipeline + GesturePipeline) that doesn't intercept native events from widgets. Replace the single InteractionManager FSM with five ECS state systems + a state-independent camera system. Make `surface` and `surfaceHandled` first-class properties of every gesture event. Selectable component gates selection at three explicit transitions (option A: tapping non-selectable while selected deselects).

  Post-review revisions (same v2): `surfaceHandled` is detected automatically by the framework (slot-equality test for DOM widgets, raycast-result test for R3F widgets) — widget authors write plain React/R3F with no framework hooks or `event.handle()` calls. Passive widget content opts out via `data-passive` or `pointer-events: none`. KeyAdapter and spacebar pan removed from scope; modifier state comes natively on every event. Surface enum stays 3-valued; DOM/R3F differentiation lives on the `Widget.surface` component.

- **v1 (2026-04-30)**: First draft. Used `@use-gesture/vanilla` + transparent `<InputSurface>` div blocking DOM widgets. Single InteractionManager state machine with 9 sub-states. Replaced by v2.
