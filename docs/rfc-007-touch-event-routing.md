# RFC-007: Touch Event Routing for DOM + R3F Widgets

- **Status**: Draft v1
- **Author**: James Yong
- **Date**: 2026-04-26
- **Area**: Interaction / Mobile / R3F Layer / DOM Widget Layer
- **Related**: RFC-006 (Pointer Event Routing — `PointerEventBus`, R3F `EventRouter`), RFC-001 (ECS Hitbox — engine spatial index, `pickAt`), RFC-002 (R3F Virtual-Texture Compositor — `pointer-events: none` canvas)
- **Supersedes**: the `useEffect`-inlined touch handler in `InfiniteCanvas.tsx:289-583`

---

## Summary

The mobile touch path in `InfiniteCanvas.tsx` decides between *pan-the-canvas* and *drag-an-entity* by walking the DOM target up looking for a `data-widget-slot` attribute (`isOnWidget`). That works for DOM widgets (which are real `<div data-widget-slot>` elements) but fails for R3F widgets, because all R3F widgets paint into a single `<canvas>` that is intentionally `pointer-events: none` (RFC-002 / RFC-006). On mobile, touching an R3F widget therefore lands `e.target` on the container, `isOnWidget` returns `false`, and the gesture state machine enters `pending-pan` → `panning`. R3F's `EventRouter` simultaneously raycasts and dispatches the touch to the widget mesh, so the widget drags *and* the camera pans on every move.

This RFC mirrors the desktop fix from RFC-006: extract the touch gesture state machine out of `InfiniteCanvas.tsx` into a `TouchEventBus` class that lives next to `PointerEventBus`, and replace the DOM-only `isOnWidget` classifier with the engine's surface-agnostic `engine.pickAt(x, y)`. After this change there are three event surfaces — `PointerEventBus` (desktop pointer/mouse), `TouchEventBus` (mobile touch, including pinch/double-tap), `EventRouter` (intra-R3F dispatch) — each with one clear responsibility, all feeding the same engine API. `isOnWidget` is deleted.

This is a refactor with one bug fix folded in. No new ECS components, no new author-facing APIs, and no change to the engine's interaction state machine.

---

## Motivation

### The bug

On mobile browsers, dragging an R3F widget causes the underlying canvas to pan at the same time. DOM widgets are unaffected. Reproduction:

1. Open the playground on a mobile browser (or DevTools touch emulation).
2. Touch and drag any R3F widget (e.g. `ShapesCard`).
3. Observe: the widget moves correctly, but the canvas camera also pans by the same delta — the whole scene scrolls under the finger.

### Why it happens

`InfiniteCanvas.tsx:309-316` classifies the touch target by DOM hierarchy:

```ts
function isOnWidget(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null;
  while (el && el !== container) {
    if (el.hasAttribute('data-widget-slot')) return true;
    el = el.parentElement;
  }
  return false;
}
```

The R3F canvas is mounted with `pointer-events: none` (`R3FManager.tsx:108`) so DOM hit-testing skips it entirely; `e.target` resolves to the container `<div>` underneath, which has no `data-widget-slot` ancestor. The touch handler at `InfiniteCanvas.tsx:405-410` falls into the `else` branch and sets `gesture = { type: 'pending-pan' }`. Once the finger crosses `DEAD_ZONE_TOUCH_PX`, `gesture` becomes `panning` and `engine.panBy(...)` runs on every `touchmove` (`InfiniteCanvas.tsx:454`). Meanwhile R3F's `EventRouter` (which listens on the same container via `eventSource={containerRef}`) is correctly raycasting and dispatching to the widget — so the widget moves too.

Both fire concurrently. The DOM widget path is fine because DOM widgets *are* real DOM elements with `data-widget-slot`, so `isOnWidget` succeeds.

### Why a one-line patch isn't enough

The minimum patch — change `isOnWidget(e.target)` to `isOnWidget(e.target) || engine.pickAt(x, y) !== null` — fixes the symptom. But it leaves the underlying asymmetry: the desktop pointer path (RFC-006 `PointerEventBus`) routes through the engine and lets the engine's hit-test be the source of truth, while the mobile touch path keeps a parallel DOM-only classifier with its own gesture state machine inlined into `InfiniteCanvas.tsx`. Two independent decision surfaces is exactly what RFC-006 set out to fix on the desktop side. Doing the same on the touch side makes the architecture consistent and removes the last DOM-only routing decision from the codebase.

### What this RFC is not

- **Not a rewrite of the gesture state machine.** Pinch-zoom, two-finger pan, double-tap zoom, single-finger entity drag — semantics stay identical. Only the home of the state machine and the classifier moves.
- **Not a change to `PointerEventBus` or R3F's `EventRouter`.** Both are untouched. The new bus is a sibling.
- **Not a change to `engine.handlePointer*`.** The bus calls the same engine API the existing handler does today.
- **Not a touch/pointer unification.** Pointer Events on iOS/Android still don't fire reliably on the same element that has `touchstart` listeners with `preventDefault()`. We keep distinct touch and pointer paths and let each one own the gestures it's good at.

---

## Proposal

### Mental model: three buses, one engine

```
┌──────────────────────────────────────────────────────────────┐
│  PointerEventBus     (desktop mouse/pen on container)         │
│  TouchEventBus       (mobile touch on container)              │
│  EventRouter (R3F)   (intra-R3F raycast / hover / capture)    │
│                                                              │
│   all three call →   engine.handlePointer* / engine.pickAt    │
└──────────────────────────────────────────────────────────────┘
```

`PointerEventBus` and `TouchEventBus` are **canvas-level concerns** — they decide whether an input event becomes a pan, a pinch, an entity drag, or nothing. They share the engine API but are otherwise independent because pointer events and touch events have different lifecycles, different `preventDefault` semantics, and different multi-input shapes (touch has true multi-finger; pointer has multi-pointer but it's rarely useful for the same gestures).

`EventRouter` is an **intra-R3F concern** — it raycasts widget-local scenes and dispatches `<mesh onClick>` etc. It's orthogonal to the canvas-level decision; both can be live at the same time, and `event.nativeEvent.stopPropagation()` is the agreed boundary signal (RFC-006 § "Implementation note for R3F widgets").

### New module layout

```
src/react/
  PointerEventBus.ts      ← unchanged (RFC-006)
  TouchEventBus.ts        ← [NEW] gesture state machine + engine routing for touch
  InfiniteCanvas.tsx      ← simplified: touch useEffect collapses to bus instantiation + listener registration

src/r3f/
  compositor/EventRouter.ts ← unchanged (RFC-006)
```

`isOnWidget` goes away — its only call sites are the DOM-only classifier in the touch handler. `isInteractive` (native form-control detection) moves into `TouchEventBus` because that's still a touch-specific concern.

### `TouchEventBus`

A plain class that owns the gesture state machine and the only `engine.handlePointer*` invocations from the touch path.

```typescript
// src/react/TouchEventBus.ts

type TouchGesture =
  | { type: 'idle' }
  | { type: 'pending-pan'; x: number; y: number; time: number }
  | { type: 'panning'; lastX: number; lastY: number }
  | { type: 'pending-entity'; x: number; y: number; time: number }
  | { type: 'entity-dragging' }
  | { type: 'pinching'; lastDist: number; lastCx: number; lastCy: number };

const NO_MODS: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };
const DEAD_ZONE_TOUCH_PX = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
const TOUCH_GESTURE_IDLE_MS = 200;

export class TouchEventBus {
  private gesture: TouchGesture = { type: 'idle' };
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private gestureClearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly engine: LayoutEngine,
    private readonly getContainer: () => HTMLDivElement | null,
  ) {}

  // Wired via container.addEventListener('touchstart', bus.onTouchStart, { passive: false }).
  onTouchStart = (e: TouchEvent): void => { /* state-machine entry, see § Routing rules */ };
  onTouchMove  = (e: TouchEvent): void => { /* … */ };
  onTouchEnd   = (e: TouchEvent): void => { /* … */ };
  onTouchCancel = (_e: TouchEvent): void => {
    this.gesture = { type: 'idle' };
    this.engine.handlePointerCancel();
    this.syncGesturing();
  };

  /** Test seam — exposed for unit tests, not for callers. */
  _getGesture(): TouchGesture { return this.gesture; }

  private syncGesturing(): void { /* mirrors current debounced setGesturing logic */ }
  private toLocal(t: Touch): { x: number; y: number } | null { /* … */ }
  private isInteractive(target: EventTarget | null): boolean { /* form controls inside DOM widgets */ }
}
```

The class is deliberately not a hook — it's a stateful object whose lifetime matches one canvas instance. `InfiniteCanvas.tsx` constructs it inside a `useEffect`, registers its handlers with `addEventListener('touchstart' /* … */, { passive: false })`, and tears down on cleanup. The `useEffect`'s body shrinks from ~290 lines to ~15.

### Routing rules

The decision tree at `onTouchStart` becomes:

```
onTouchStart(e):
  if e.touches.length >= 2:
    e.preventDefault()
    cancelEngineGesture()                      // back out of any single-touch entity grab
    gesture = pinching{ … }
    return

  let touch = e.touches[0]
  let { x, y } = toLocal(touch)

  if isInteractive(e.target): return           // <input>, <button>, contenteditable — let browser handle

  e.preventDefault()

  if isDoubleTap(now, x, y):
    handleDoubleTap(x, y)                      // unchanged — uses pickAt + zoomAtPoint or enterContainer
    return

  // The change: ask the engine, not the DOM.
  if engine.pickAt(x, y) !== null:
    engine.handlePointerDown(x, y, 0, NO_MODS)
    gesture = pending-entity{ x, y, time: now }
  else:
    gesture = pending-pan{ x, y, time: now }
```

Everything downstream (`onTouchMove`, `onTouchEnd`, pinch transitions, dead-zone arithmetic, double-tap memory) is identical to today's behaviour — we're literally moving the existing functions into methods on the class and swapping one classifier line.

`isInteractive(e.target)` stays because R3F widgets paint into a canvas (no native form controls inside R3F), so its DOM check is harmless for the R3F case and remains correct for DOM widgets that embed an `<input>`. No false positives.

### Why `engine.pickAt`

`engine.pickAt(screenX, screenY)` is the engine's spatial-index query (`interaction.ts:1047-1056`). It returns the topmost interactable entity at a screen-space point or `null`. It already drives:

- The desktop double-click semantics (`PointerEventBus.onDoubleClick`).
- The R3F `EventRouter`'s widget resolution step (`EventRouter.ts compute`).
- The internal pointerdown hit-test inside `engine.handlePointerDown`.

It is surface-agnostic: it asks the spatial index, which doesn't care whether the entity is rendered by DOM, R3F, WebGL, or a future surface. The doc comment on the export explicitly calls out RFC-006 routing as a use case. Routing the touch path through `pickAt` makes it the *fourth* call site, all in service of the same architectural rule: hit-testing is the engine's job.

### Coexistence with `EventRouter`

R3F's `EventRouter` listens on the same container via `eventSource={containerRef}` (`R3FManager.tsx:92`). On a single touch:

1. `touchstart` fires on the container.
2. `TouchEventBus.onTouchStart` runs (registered earlier; the bus's `useEffect` runs before R3F's eventSource takes effect, but in either case both listeners receive the event).
3. R3F's event manager also dispatches a synthetic `pointerdown` to the widget mesh's `onPointerDown` handlers (R3F internally normalises touch into pointer).

`TouchEventBus.preventDefault()`s the touch event but does **not** stop propagation, so R3F still receives it. R3F widget authors who want to consume the event (suppress drag) call `event.nativeEvent.stopPropagation()` — same idiom RFC-006 codified for the desktop case. There is no new contract: the existing R3F `stopPropagation` rules apply.

The bus's `engine.handlePointerDown` and R3F's `<mesh onPointerDown>` dispatch happen in close succession on the same touch, in that order. This matches what `PointerEventBus` already does on desktop, so widget code that already handles desktop correctly handles touch correctly without modification.

### Coexistence with `PointerEventBus`

iOS and most Android browsers don't fire pointer events on a touch target whose `touchstart` listener called `preventDefault()`. Where they do (some Chromium builds), `PointerEventBus` will see the event but the engine's state machine is idempotent for the same coordinate sequence and the bus's pointer-capture call is a no-op when the gesture is already owned by touch (because `setGesturing(true)` flips a flag the engine respects). No double-dispatch in practice; if a regression appears, the bus can short-circuit on `engine.isGesturing()` (already used by the wheel debouncer).

### Module wiring in `InfiniteCanvas.tsx`

Today (excerpt):

```tsx
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  type TouchGesture = /* … */;
  let gesture: TouchGesture = { type: 'idle' };
  /* ~290 lines of state machine, classifiers, helpers, listener registration */
}, [engine]);
```

After:

```tsx
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  const bus = new TouchEventBus(engine, () => containerRef.current);
  container.addEventListener('touchstart',  bus.onTouchStart,  { passive: false });
  container.addEventListener('touchmove',   bus.onTouchMove,   { passive: false });
  container.addEventListener('touchend',    bus.onTouchEnd,    { passive: false });
  container.addEventListener('touchcancel', bus.onTouchCancel);

  return () => {
    container.removeEventListener('touchstart',  bus.onTouchStart);
    container.removeEventListener('touchmove',   bus.onTouchMove);
    container.removeEventListener('touchend',    bus.onTouchEnd);
    container.removeEventListener('touchcancel', bus.onTouchCancel);
  };
}, [engine]);
```

The `setGesturing` debounce + `wrap` helper move into the bus as a private method invoked at the end of each public handler. No change to the gesturing semantics consumed by the rest of the engine.

### Engine call parity

| Touch event | Today (`InfiniteCanvas.tsx`) | After (`TouchEventBus`) |
|---|---|---|
| Single-finger touchstart on DOM widget | 1 × `handlePointerDown` (via `isOnWidget`) | 1 × `handlePointerDown` (via `pickAt`) |
| Single-finger touchstart on R3F widget | **0** × `handlePointerDown` (bug — `isOnWidget` returns false) | 1 × `handlePointerDown` (via `pickAt`) ✅ |
| Single-finger touchstart on empty space | 0 × `handlePointerDown` (waits for end → tap) | 0 × `handlePointerDown` (unchanged) |
| Two-finger touchstart | `cancelEngineGesture` → maybe 1 × `handlePointerUp` | identical |
| Single-finger touchmove during entity drag | 1 × `handlePointerMove` | identical |
| Single-finger touchmove during pan | 1 × `engine.panBy` | identical |
| touchend after entity drag | 1 × `handlePointerUp` | identical |
| touchend after empty-space tap | `handlePointerDown` + `handlePointerUp` (synthesised tap) | identical |

The R3F bug-fix line is the only behavioural delta. Every other transition is preserved verbatim.

---

## Migration path

### Phase 1 — Bus extraction (no behaviour change for DOM widgets)

Create `TouchEventBus.ts` containing the existing state machine, classifiers (sans `isOnWidget`), and helpers, **with one change**: the `onTouchStart` widget classifier becomes `engine.pickAt(x, y) !== null`. Wire it into `InfiniteCanvas.tsx` as described above. Delete the inlined `useEffect` body and the `isOnWidget` helper.

Acceptance:
- DOM widgets: drag, double-tap, pinch, two-finger pan, single-tap select all behave identically to today.
- R3F widgets: dragging an R3F widget on mobile no longer pans the canvas. Bug fixed.
- The touch handler `useEffect` in `InfiniteCanvas.tsx` is ≤ 20 lines (instantiation + listener registration + cleanup).
- `isOnWidget` no longer exists in the codebase.

### Phase 2 — Tests

Add unit tests for `TouchEventBus`:
- `onTouchStart` on coordinates where `engine.pickAt` returns an entity → `gesture.type === 'pending-entity'` and `engine.handlePointerDown` called once.
- `onTouchStart` on coordinates where `engine.pickAt` returns `null` → `gesture.type === 'pending-pan'` and `engine.handlePointerDown` not called.
- `onTouchStart` on a `<button>` inside a DOM widget → early return, no engine call, gesture stays idle.
- Pinch transitions (single → double finger, double → single finger).
- Double-tap inside dead zone within 300 ms → zoom or `enterContainer`.
- Dead-zone deferral: a small move (< 8 px) keeps `pending-pan`; a large move flips to `panning`.

These tests don't exist today because the state machine was buried in a `useEffect`. Phase 2 is the first time we can write them.

Acceptance:
- New tests pass.
- Coverage for `TouchEventBus` ≥ 90 % branches.

### Phase 3 — Manual mobile QA matrix

Run on iOS Safari + Android Chrome (real devices preferred; DevTools touch emulation as fallback):

- Drag a DOM widget → widget moves, canvas does not pan.
- Drag an R3F widget → widget moves, canvas does not pan. **(regression target)**
- Single-tap an empty area → marquee start, then end — selection clears.
- Single-tap on a widget → selection toggles.
- Double-tap on empty area → zoom in / zoom out cycle.
- Double-tap on a widget → `enterContainer` semantics.
- Pinch on empty area → zoom around centroid.
- Pinch starting on a widget → cancels entity grab cleanly, switches to pinch-zoom.
- Two-finger drag → pan.
- Tap inside a `<button>` in a DOM widget → button click fires; no canvas reaction.
- Touch-cancel mid-drag (e.g. scroll-up gesture interrupts) → engine releases cleanly.

Acceptance:
- Every row above passes on both browsers.
- No regressions in `apps/playground` reported via the dashboard's smoke run.

---

## Alternatives considered

### Alt A: minimal patch — `isOnWidget(e.target) || engine.pickAt(x, y) !== null`

Single-line change inside the existing `useEffect`. Bug fixed; nothing else moves.

- **Pro**: smallest diff, fastest to ship.
- **Con**: leaves the gesture state machine inline in `InfiniteCanvas.tsx`, leaves `isOnWidget` as a parallel-but-redundant classifier with `pickAt`, leaves the touch path untestable in isolation, and leaves the asymmetry with `PointerEventBus` that RFC-006 set out to eliminate on the desktop side.
- **Verdict**: rejected as the final design but adopted as a "bridge fix" — if Phase 1 of this RFC is not landed within a week, ship Alt A in the meantime to unblock mobile users. The full bus extraction supersedes it.

### Alt B: fold touch handling into `PointerEventBus`

Make `PointerEventBus` listen to both `pointer*` events and `touch*` events, holding both gesture state machines.

- **Pro**: one bus, one mental model.
- **Con**: the two state machines have different shapes (touch has `pinching`, pointer doesn't; pointer has capture, touch doesn't), different `preventDefault` discipline, and different lifecycles. Coupling them produces a class with two clearly separable concerns. Splitting later is easy; merging now is bookkeeping.
- **Verdict**: rejected. Distinct buses with a shared engine API is the RFC-006 pattern, and it's serving us well.

### Alt C: move pan into the engine state machine

Rather than have the bus decide pan vs entity, have `engine.handlePointerDown` return a `start-pan` directive when there's no hit, and let the engine own the pan camera math too.

- **Pro**: fully unified — the engine is the single source of truth for what an input means.
- **Con**: the engine currently doesn't own camera state mutations (those live in the camera/viewport module); promoting pan into the state machine means restructuring how camera and interaction modules interact. Out of scope for a touch-routing RFC. Worth revisiting if a future RFC is restructuring engine ownership of camera.
- **Verdict**: deferred. Not blocking this work; would be a follow-up RFC.

### Alt D: drop `pointer-events: none` on the R3F canvas

Reverse the RFC-002/RFC-006 decision. Once the canvas receives events, `e.target` lands on the canvas element on R3F widget touches; `isOnWidget` could match a `data-widget-canvas` attribute and continue working.

- **Pro**: keeps the DOM classifier alive.
- **Con**: re-introduces every problem RFC-006 § "Layer-stack changes" called out — DOM widgets at higher z-indices stop being clickable through the canvas. Actively regresses the architecture.
- **Verdict**: rejected.

---

## Open questions

1. **Should `TouchEventBus` short-circuit on `engine.isGesturing()`?** RFC-006's `PointerEventBus` doesn't do this today, but if pointer events arrive in parallel with touch on Chromium-on-Android, the bus could double-dispatch. Decision: don't add the check until a real regression is observed; the engine state machine is idempotent for the same coords so the cost of letting both fire is small and getting the check wrong (e.g. blocking legitimate stylus-on-touchscreen input) is worse.

2. **Where do `lastTapTime` / `lastTapX` / `lastTapY` belong?** They're double-tap memory, scoped to a single canvas instance. They live as private fields on `TouchEventBus` for now. If a future RFC introduces multi-input scenarios (split-screen mobile, multiple canvases on one page), they may need to move into a shared input controller.

3. **Should `pickAt` be called on every `touchmove` to detect crossing into a widget mid-drag?** No — the current state machine commits at `touchstart` and doesn't reroute mid-gesture, which matches user expectation (you don't accidentally start dragging a widget you slid your finger over). Document this in the bus's class JSDoc.

4. **Should we test against Pointer Events natively on mobile and skip the touch path?** Modern browsers support Pointer Events on touch surfaces, and at first glance unification looks attractive. In practice, `PointerEvent` on touchscreens has fragmented `preventDefault` behaviour (Safari historically requires `touch-action: none` for pinch suppression; Chrome's gesture detection is opaque), and the existing touch code is battle-tested. Out of scope; revisit as a follow-up RFC if and when a maintenance need appears.

---

## Acceptance criteria

**Phase 1 (bus extraction + bug fix)**
- [ ] `src/react/TouchEventBus.ts` exists; class exports `onTouchStart` / `onTouchMove` / `onTouchEnd` / `onTouchCancel` as bound instance methods.
- [ ] `InfiniteCanvas.tsx`'s touch `useEffect` is reduced to bus instantiation + listener registration + cleanup.
- [ ] `isOnWidget` is deleted from the codebase.
- [ ] `engine.pickAt(x, y)` is the sole classifier for "is this touch on a widget?" in the touch path.
- [ ] Dragging an R3F widget on mobile moves the widget and **does not** pan the canvas.
- [ ] Dragging a DOM widget on mobile is unchanged.
- [ ] Pinch, two-finger pan, double-tap zoom, double-tap enterContainer, single-tap select, single-tap on `<button>` all behave identically to today.
- [ ] No new author-facing API.

**Phase 2 (tests)**
- [ ] `TouchEventBus` unit tests cover `pickAt`-true / `pickAt`-false / `isInteractive`-true / pinch / double-tap / dead-zone branches.
- [ ] Branch coverage for `TouchEventBus` ≥ 90 %.

**Phase 3 (mobile QA)**
- [ ] Manual matrix in § Migration → Phase 3 passes on iOS Safari + Android Chrome.

---

## Dependencies and risks

**Depends on**
- `engine.pickAt(screenX, screenY)` — already exposed (`LayoutEngine.ts:685`, `interaction.ts:1047-1056`).
- `engine.setGesturing` / `engine.isGesturing` — already exists (RFC-002 Phase 5).
- The existing touch state machine semantics — preserved verbatim, only relocated.

**Risks**
- **`pickAt` cost on touchstart.** `engine.pickAt` is an O(log n) spatial-index query; called once per touchstart it's negligible. Not called on touchmove (state machine commits at start), so no per-move cost.
- **iOS Safari touch event delivery during canvas resize / orientation change.** The bus's `getContainer()` callback re-reads the ref each call; rect-relative coordinates stay correct across resize. Touch cancellation paths route through `onTouchCancel` which calls `engine.handlePointerCancel()` — same as today.
- **Mid-flight regression on a less-common gesture (e.g. three-finger interactions if added later).** The state machine is the same shape it was before extraction, but tests didn't exist before; Phase 2 specifically writes the tests so future changes don't drift.
- **Bridge fix discipline.** If Alt A is shipped as a bridge before Phase 1 lands, the `isOnWidget(e.target) || engine.pickAt(x, y) !== null` line must be removed (not preserved) when Phase 1 deletes `isOnWidget`. Track in the Phase 1 PR.

---

## Revision notes

**v2** — 2026-04-26. After v1 landed, smoke-testing surfaced a separate latent issue: in-widget interactions (DOM widget React `onClick`, `<input>` focus, R3F `<mesh onClick>`) **never worked on mobile**, neither before nor after v1. The pre-v1 code called `e.preventDefault()` on touchstart for any non-form-control target inside a widget, which suppresses the browser's synthesized pointer/click events. Without those, neither `PointerEventBus` nor R3F's `EventRouter` saw the touch, and React's natural `onClick` never fired. This was a long-standing gap, not a v1 regression, but it became prominent once the canvas-pan fix made R3F drag usable.

v2 fixes it by **shrinking** TouchEventBus: it no longer drives single-finger entity interactions at all. When `engine.pickAt(x, y)` returns an entity, the bus enters a passive `tracking-entity` state and does **not** call `preventDefault`. The browser then synthesizes pointerdown / pointermove / pointerup / click / dblclick from the touch sequence, which `PointerEventBus` and R3F's `EventRouter` consume the same way they consume desktop mouse input. One code path serves both surfaces — exactly the architectural unification RFC-006 set out to achieve.

The bus retains four canvas-level concerns:
1. Single-finger pan on empty space (`pickAt` returns null).
2. Two-finger pinch / pan.
3. Empty-space double-tap zoom (entity double-tap is now `PointerEventBus.onDoubleClick` via native `dblclick`).
4. Multi-touch upgrade — when a second finger lands during any pointer-driven interaction, the bus calls `engine.handlePointerCancel()` to clean up engine state before pinch takes over.

State machine narrowed: `pending-entity` and `entity-dragging` are gone (they belong to PointerEventBus's directive flow now); `tracking-entity` replaces them. The new `preventDefault` discipline:

| Gesture | preventDefault on touchstart? | Why |
|---|---|---|
| Multi-touch (≥ 2 fingers) | Yes | Bus owns pinch; suppress synthesized scroll/zoom. |
| `isInteractive` target (`<input>`, `<button>`, …) | No | Browser handles focus/activation. |
| Empty-space double-tap | Yes | Bus drives the zoom. |
| Widget hit (`pickAt` non-null) | **No** | Let synthesized pointer/click events reach PointerEventBus + R3F. |
| Empty space (single finger) | Yes | Bus owns the pan; suppress marquee start. |

Engine-call parity changes accordingly: TouchEventBus no longer calls `engine.handlePointerDown` for entity touches (PointerEventBus does, via the synthesized pointerdown). Engine call count per touchstart on a widget drops from 1 (v1) to 0 (v2) on the touch path, with the matching `handlePointerDown` arriving via `PointerEventBus.onPointerDown` instead.

Acceptance criteria gain: in-widget tap (DOM child onClick, R3F mesh onClick), input focus, button activation all work on mobile via the same handlers the widget uses on desktop. No mobile-specific authoring guidance.

**v1** — initial draft, 2026-04-26. Written after diagnosing the mobile R3F drag-pans-canvas bug. The fix path mirrors RFC-006's bus extraction on the desktop side: replace a DOM-only classifier with the engine's surface-agnostic hit-test and lift the gesture state machine into a dedicated, testable class. After landing, `PointerEventBus` + `TouchEventBus` + `EventRouter` are the three input surfaces in the system, all calling into the same engine API. Open questions kept narrow — pointer/touch unification and engine-owned pan are explicitly deferred.
