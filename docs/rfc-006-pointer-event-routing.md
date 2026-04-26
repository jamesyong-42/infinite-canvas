# RFC-006: Pointer Event Routing for DOM + R3F Widgets

- **Status**: Draft v1
- **Author**: James Yong
- **Date**: 2026-04-25
- **Area**: Interaction / R3F Layer / DOM Widget Layer
- **Related**: RFC-001 (ECS Hitbox — engine spatial index, `InteractionRole`), RFC-002 (R3F Virtual-Texture Compositor — `VirtualWidget` per-widget scenes/cameras), RFC-003 (Layer architecture)
- **Supersedes**: RFC-002 § Pointer event routing (sketched at draft level; unimplemented Phase 4c)

---

## Summary

After the compositor landed (RFC-002 Phases 1–7), R3F widgets paint into per-widget render targets and a fullscreen composition pass blits them. The R3F `<Canvas>` is mounted with `pointer-events: none`, so today no pointer event ever reaches an R3F widget's local scene — `<mesh onClick>`, `<group onPointerOver>`, nested raycasts, `event.stopPropagation()`, all silently dead. Meanwhile DOM widgets work but the engine is invoked from three places (container, `WidgetSlot`, `SelectionOverlaySlot`), each calling `e.stopPropagation()` to prevent double-dispatch.

This RFC unifies pointer routing around two principles:

1. **Engine routing** (drag / select / resize / marquee / navigation) is invoked from a single `PointerEventBus` at the canvas-container level. `WidgetSlot` and `SelectionOverlaySlot` stop calling the engine entirely.
2. **Widget-internal dispatch** stays on the natural event path of each surface — React/DOM events for DOM widgets, R3F's event manager for R3F widgets — but R3F's manager is replaced with one that raycasts the resolved widget's *local* scene, not the composition fullscreen quad.

The boundary signal between the two layers is `event.stopPropagation()` — the existing React/R3F idiom. Authors write plain `onClick` / `onPointerOver` / `event.stopPropagation()` on either surface; the engine still gets every pointer event for its own state machines.

This is a substantial restructure of the interaction layer but introduces no new ECS components and no new author-facing APIs. The compositor's existing per-widget `{ scene, camera }` registration is exactly the data the new router needs.

---

## Motivation

### Current state

Pointer events arrive through three independent React handler sites:

| Site | Calls | Stops propagation? | Why |
|---|---|---|---|
| Container `onPointerDown` (`InfiniteCanvas.tsx:523`) | `engine.handlePointerDown` | No | Last-resort handler for clicks on empty canvas. |
| `WidgetSlot.onPointerDown` (`WidgetSlot.tsx:49`) | `engine.handlePointerDown` | Yes | Per-DOM-widget hit. Stops to prevent the container handler from re-firing. |
| `SelectionOverlaySlot.onPointerDown` (`SelectionOverlaySlot.tsx:63`) | `engine.handlePointerDown` | Yes | Per-R3F-widget hit. The DOM overlay sits above the R3F canvas because the canvas has `pointer-events: none`. |

The R3F canvas itself (`R3FManager.tsx:72`) has `pointerEvents: 'none'` on its style — events skip the canvas entirely and the `SelectionOverlaySlot` above it picks them up instead.

What works:
- DOM widgets: React handlers on child elements work because React event bubbling reaches them before the slot's own handler. Native form interactives (`button`, `input`, …) get an explicit pass-through in the slot.
- Engine semantics: drag, resize, marquee, double-click navigation all function correctly.

What's broken:
- R3F widget authors cannot wire any pointer behaviour. `<mesh onClick>` is dead. `<group onPointerOver>` is dead. Nested mesh raycasts, `event.stopPropagation()`, `event.point`, `event.uv` — all unreachable.
- Even if the canvas's `pointer-events` were enabled, R3F's default raycaster would target the *composition* scene's fullscreen quads, not the widget's local geometry. Every event would resolve to the same fullscreen plane.
- The triple invocation of `engine.handlePointerDown` is fragile: any new handler site has to remember the `stopPropagation` discipline, and the order in which slots vs. container fire depends on the React event-bubbling model rather than on intentional design.

### What this RFC is not

- **Not a rewrite of the engine's interaction state machine.** Drag, resize, marquee, navigation, hover-driven selection chrome — all stay in `engine/interaction.ts` unchanged. Only the *invocation site* changes.
- **Not a new author-facing API.** No `useWidgetPointer`, no `useR3FEvent`. Authors write the same `onClick` they write today; we make it actually work for R3F.
- **Not a touch / gesture rewrite.** The native touch path in `InfiniteCanvas.tsx` (pinch-zoom, two-finger pan) keeps its dedicated listeners. The bus suppresses pointer-event routing while a multi-touch gesture is active.

---

## Proposal

### Mental model: two layers, one boundary

```
┌──────────────────────────────────────────────────────────────┐
│  PointerEventBus  (canvas-container, single invocation site)  │
│                                                              │
│   pointer event                                              │
│     ├── widget-internal dispatch first (natural bubble)       │
│     │      DOM widget  → React/DOM events                     │
│     │      R3F widget  → EventRouter → widget-local raycast    │
│     │                    R3F's EventManager dispatches normally │
│     │                                                        │
│     └── engine routing second (if not stopPropagation'd)      │
│            engine.handlePointerDown / Move / Up                │
│            engine returns directive (capture-drag, ...)        │
│            bus may setPointerCapture on container             │
└──────────────────────────────────────────────────────────────┘
```

The boundary signal is `event.stopPropagation()`. A widget handler that calls it is saying "I consumed this; don't engine-route" — the same idiom React and R3F authors already know.

**Implementation note for R3F widgets**: R3F's synthetic `event.stopPropagation()` only halts further dispatch within R3F's own bubble — it doesn't stop the native DOM event from reaching the canvas-container bus. R3F authors who need to halt engine routing too call `event.nativeEvent.stopPropagation()`, which is the standard DOM idiom for "don't bubble further." No new API required, no fork of R3F's events module needed. DOM widgets already enjoy the simpler `e.stopPropagation()` halts both, since React events bubble through the same DOM tree the bus listens on.

### New module layout

```
src/react/
  PointerEventBus.ts            ← [NEW] single source of engine.handlePointer* calls
  InfiniteCanvas.tsx            ← simplified: container pointer handlers delegate to bus
  widgets/WidgetSlot.tsx        ← simplified: drop engine calls + stopPropagation, drop pointer handlers
  overlays/SelectionOverlaySlot.tsx
                                ← simplified: pointer-events: none on the slot wrapper;
                                  CardChrome decoration only

src/r3f/
  R3FManager.tsx                ← drop pointer-events: none; install custom events= prop
  compositor/
    EventRouter.ts              ← [NEW] R3F EventManager that raycasts widget-local scenes
    CompositorContext.tsx       ← extended: registers (scene, camera, hasPointerHandlers)
```

### `PointerEventBus`

A plain class (or hook) that owns the only `engine.handlePointer*` invocations in the React tree.

```typescript
class PointerEventBus {
  private engineHasCapture = false;

  // Wired on the canvas container in InfiniteCanvas.tsx.
  onPointerDown(e: React.PointerEvent) {
    // Widget-internal handlers already ran (React/R3F bubble preceded this).
    // If anything called e.stopPropagation(), we don't reach here.
    if (this.engine.isMultiTouchActive()) return;          // touch-gesture path owns this
    if (this.shouldSkipForNativeInteractive(e.target)) return;

    const { x, y } = this.toLocal(e);
    const directive = this.engine.handlePointerDown(x, y, e.button, mods(e));
    if (directive.action === 'capture-resize'
     || directive.action === 'passthrough-track-drag'
     || directive.action === 'capture-drag'
     || directive.action === 'capture-marquee') {
      this.container.setPointerCapture(e.pointerId);
      this.engineHasCapture = true;
    }
    if (directive.action === 'capture-resize') e.preventDefault();
  }

  onPointerMove(e: React.PointerEvent) {
    if (this.engineHasCapture) {
      // Widget dispatch suspended during engine capture (drag/resize/marquee).
      this.engine.handlePointerMove(...);
      return;
    }
    // Widget-internal hover already dispatched via natural event path
    // (DOM React, or R3F via EventRouter listening on the same canvas).
    // We just notify the engine for cursor + hover-entity bookkeeping.
    this.engine.handlePointerMove(...);
  }

  onPointerUp(e: React.PointerEvent) {
    if (this.engineHasCapture) {
      this.container.releasePointerCapture(e.pointerId);
      this.engineHasCapture = false;
    }
    this.engine.handlePointerUp();
  }

  onPointerLeave(e: React.PointerEvent) {
    // Pointer left the canvas entirely — flush hover.
    this.eventRouter?.flushHover();      // synthesises onPointerLeave to last R3F widget+mesh
    this.engine.handlePointerMove(-Infinity, -Infinity, mods(e));  // engine clears hover
  }

  onDoubleClick(e: React.MouseEvent) {
    const { x, y } = this.toLocal(e);
    this.engine.handleDoubleClick(x, y);   // engine.enterContainer if hit
  }
}
```

**Why bus-level double-click, not slot-level**: today both slots register `onDoubleClick={() => engine.enterContainer(entityId)}`. The engine already has the spatial index to resolve the entity from coords, and `enterContainer` is the only double-click semantic in the system. Hoisting it to the bus eliminates two more sites that had to be kept in sync.

**Native interactive elements** (`button`, `input`, `textarea`, `select`, `[contenteditable]`) bypass the engine call. The detection runs at the bus, not at every slot. Authors of DOM widgets that want *additional* opt-out elements call `e.stopPropagation()` from their child handler, which is the existing idiom.

### `EventRouter` — R3F EventManager replacement

R3F lets the entire event system be replaced via `<Canvas events={factory}>`. We provide a factory that builds an `EventManager` whose `intersect` step uses widget-local scenes instead of the canvas's default scene.

```typescript
// src/r3f/compositor/EventRouter.ts

export function createCompositorEventManager(state, engine, compositorCtx): EventManager {
  // Reuse R3F's default manager for bookkeeping (hover diff, click synthesis,
  // capture, bubble), only override the intersection step.
  const manager = createDefaultEventManager(state);

  manager.handlers.compute = (event, manager) => {
    // Convert pointer to canvas-local px.
    const { x, y } = toCanvasLocal(event);

    // Resolve which widget owns this pixel via the engine spatial index.
    const entityId = engine.spatialIndex.entityAt(x, y);
    if (entityId === null) return;             // missed — bus handles fan-out

    // Look up this widget's per-VirtualWidget scene + camera.
    const widget = compositorCtx.widgets.get(entityId);
    if (!widget) return;

    // Map pointer to widget-local NDC and configure raycaster.
    const ndc = widgetLocalNdc(entityId, x, y, engine, widget);
    state.raycaster.setFromCamera(ndc, widget.camera);

    // Stash both the override scene and the resolved entity so R3F's
    // dispatch step intersects the right tree. Tracking the entity also
    // lets the bus suspend dispatch during engine capture.
    state.pointer.copy(ndc);
    state.scene = widget.scene;                // override default scene
  };

  return manager;
}
```

R3F's event manager handles the rest natively:
- Bubbling through `<group>` ancestors.
- `event.stopPropagation()` semantics (consumed-events list).
- `onClick` synthesis from matching down→up.
- Hover diffing via `connected` state — `onPointerEnter` / `onPointerLeave` fire on transitions inside one widget for free.
- `event.point`, `event.uv`, `event.face`, `event.intersections` populated from the widget-local raycast.

### Cross-widget hover transitions

Inside a single widget, R3F's manager handles hover diffing between meshes. Across widgets, the cursor leaves widget A's scene without A's manager seeing the move (because the next move arrives on widget B's scene). The `EventRouter` synthesises that boundary leave:

```
on each pointermove, after compute() resolves currentEntity:
  if currentEntity !== lastEntity:
    if lastEntity is R3F:
      synth onPointerLeave to lastEntity's scene with lastIntersections
      → R3F's manager flushes its hover state for that scene
    if currentEntity is R3F:
      raycast currentEntity's scene as usual
      → R3F's manager fires onPointerEnter on first hit
  lastEntity = currentEntity
```

Engine-level hover (the `getHoveredEntity()` signal that drives the selection ring + cursor) is independent from widget-internal hover and updated in parallel from the same move.

### Layer-stack changes

Today (z-index ascending):

```
WebGL canvas (grid + selection chrome)        pointer-events: none
DOM 'background' layer + slot wrappers        pointer-events: auto on slots
DOM 'base' layer + slot wrappers              pointer-events: auto on slots
R3F canvas                                    pointer-events: none  ← steals nothing, sees nothing
DOM 'overlay' layer                           pointer-events: auto on slots
SelectionOverlaySlot per R3F widget           pointer-events: auto  ← steals R3F clicks
```

After:

```
WebGL canvas                                  pointer-events: none
DOM 'background' + 'base' + slot wrappers     pointer-events: auto on slots (unchanged)
R3F canvas                                    pointer-events: auto  ← receives events
DOM 'overlay' layer                           pointer-events: auto on slots (unchanged)
SelectionOverlaySlot per R3F widget           pointer-events: none on wrapper
                                              CardChrome stays as visual decoration only
```

`SelectionOverlaySlot`'s wrapper drops `pointer-events: auto`. Its current React pointer handlers are removed entirely. CardChrome decorations (overlap glow, selection frame) are visual and remain.

`WidgetSlot`'s React pointer handlers also go away. The wrapper's `pointer-events` stays `auto` so DOM widget children still receive native events through the natural DOM path. The slot-level engine call + `stopPropagation` is what's removed.

### Engine capture semantics

When `engine.handlePointerDown` returns a `capture-*` directive, the bus calls `setPointerCapture` on the canvas container. While captured:

- All subsequent `pointermove` and `pointerup` events route to the container regardless of which descendant is under the cursor (browser native behaviour).
- The bus suspends dispatch into the `EventRouter` — widget meshes do not receive `onPointerMove` mid-drag, and `onClick` will not synthesise on release because down/up landed on different "targets" from R3F's point of view.
- The engine state machine (`Dragging` tag, resize handle, marquee bounds) drives the visual feedback.

On release the bus calls `releasePointerCapture` and re-enables dispatch. The next pointerdown re-establishes both layers.

This matches the engine's current behaviour exactly; we're just consolidating where the capture call is made.

### Touch coexistence

The native touch listeners (`InfiniteCanvas.tsx:480-518`) handle pinch / two-finger pan and tap-to-pointerdown for single-finger taps. They will continue to be the only `engine.handlePointerDown` invoker for touch. While `engine.isMultiTouchActive()` (or equivalently `cam.gesturing` set by the touch path) is true, the bus's pointer handlers short-circuit before calling the engine.

This keeps the gesture state machine untouched and avoids double-dispatch when both pointer events and touch events fire for the same finger contact.

### Pointer Missed

R3F natively supports `onPointerMissed` on Object3D nodes. When the engine's spatial-index hit-test returns no entity, `EventRouter.compute` sets the raycaster's camera to null and R3F's default missed-dispatch path fans the event out to every `Object3D` in `internal.interaction` that has an `onPointerMissed` handler.

**Phase scope is *mounted*, not *Visible***: R3F's `internal.interaction` is populated when a mesh's React fiber registers handlers and depopulated only when the mesh is unmounted. The compositor's state machine flips a widget between Hot / Warm / Cold / Waking / Dormant by mutating an ECS component — it does not unmount the per-widget React tree (the portal stays mounted so the FBO can survive eviction-and-rewake without re-registering handlers each cycle). So `onPointerMissed` reaches *every mounted widget with a handler*, including Cold and Dormant ones. In practice this is benign — handlers that need to gate on visibility can read `useWidgetPhase(entityId)` and early-exit. Adding explicit phase filtering at the EventRouter would require unmounting+remounting handlers on every phase transition, which trades the missed-event tightness for far worse churn.

DOM widgets do not get an equivalent — DOM has no missed-click concept. If a real use case appears later, we expose `useCanvasPointerMissed(entityId, handler)` as a follow-up; out of scope here.

### Author-facing contract

Unchanged for DOM widgets:

```tsx
function MyDomWidget({ entityId }) {
  return (
    <div onPointerOver={() => setHover(true)}>
      <button onClick={(e) => { e.stopPropagation(); doThing(); }}>btn</button>
    </div>
  );
}
```

Now works for R3F widgets:

```tsx
function MyR3FWidget({ entityId, width, height }) {
  return (
    <group>
      <mesh
        onClick={(e) => { e.stopPropagation(); doThing(); }}     // ← consumed; no drag
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}>
        <boxGeometry args={[width * 0.5, height * 0.5, 1]} />
        <meshStandardMaterial color={hover ? 'red' : 'blue'} />
      </mesh>
      <mesh onClick={() => beginDrag()}>                          {/* not stopped → engine drags */}
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
```

Idiomatic in both worlds, no new APIs.

---

## Alternatives considered

### Alt A: keep slot-level engine calls; only add R3F event routing

Smallest possible delta — leave the triple invocation of `engine.handlePointerDown` in place and just add `EventRouter` for R3F.

- **Pro**: minimal regression risk on DOM widget interaction; no behavioural change to engine routing.
- **Con**: the triple invocation persists, with its `stopPropagation` discipline and its tendency to invite bugs whenever new handlers are added. Doesn't solve the source-of-truth problem RFC-002 § Pointer event routing called out. Also retains `pointer-events: none` on the R3F canvas plus `pointer-events: auto` on `SelectionOverlaySlot`, which means R3F events would have to be re-dispatched manually from the slot rather than received natively — an extra synthesisation step.
- **Verdict**: rejected. The bus extraction is a small refactor (no behaviour change in engine semantics) and is a precondition for cleanly enabling pointer-events on the R3F canvas without double-dispatch.

### Alt B: bus owns DOM widget dispatch too (full symmetry)

Container becomes the only `pointer-events: auto` element. All descendants set `pointer-events: none`. Bus uses `document.elementFromPoint` to find the original target and re-dispatches a synthetic React event so child handlers fire.

- **Pro**: perfectly symmetric. One dispatch path, one mental model.
- **Con**: synthesising native DOM events breaks too many things — `<input>` focus, IME composition, native form submission, drag-drop API, browser autofill, accessibility tree. All these depend on the *real* native event reaching the actual target.
- **Verdict**: rejected. DOM widgets work today on natural React/DOM event semantics; the only broken surface is R3F. Asymmetric routing (DOM natural, R3F via bus + EventRouter) is the right scope.

### Alt C: per-widget R3F sub-canvases instead of one composited canvas

Roll back the compositor's per-widget FBO approach for interaction reasons — give each R3F widget its own `<Canvas>` so R3F's default event manager works without modification.

- **Pro**: zero new event code; each canvas's events are isolated by construction.
- **Con**: re-introduces every problem RFC-002 Alt B catalogued — multi-canvas overhead, per-canvas WebGL state, no shared resources, browser compositor cost. The compositor architecture was specifically chosen to avoid this.
- **Verdict**: rejected. Compositor stands; we route events through one canvas.

### Alt D: re-dispatch synthetic R3F events from a DOM intermediate

Keep `pointer-events: none` on R3F canvas; have `SelectionOverlaySlot` synthesise R3F-shaped events and call into widget-scoped raycasters manually.

- **Pro**: doesn't touch R3F's `events` prop.
- **Con**: re-implements R3F's hover diffing, bubble walk, capture, and click synthesis by hand. Every R3F behaviour upgrade (e.g. event priority changes between R3F versions) becomes a maintenance burden. The `events={factory}` API exists explicitly so we don't have to do this.
- **Verdict**: rejected. Replacing R3F's intersection step is a small surface; reimplementing dispatch is a large one.

---

## Migration path

### Phase 1 — Bus extraction (no behaviour change)

Create `PointerEventBus.ts` with `onPointerDown / Move / Up / Leave / DoubleClick`. Wire it on the canvas container in `InfiniteCanvas.tsx`. Do **not** yet remove the slot-level engine calls — both invocation paths run, but the bus's call is idempotent on the engine state for the same coords because:
- The container handler already calls `engine.handlePointerDown` today; the bus is just a refactor of that handler.
- Slot handlers still `stopPropagation` so the bus doesn't double-fire.

Acceptance:
- All existing interaction tests pass with no behaviour change.
- Touch gesture path still works (bus short-circuits on `gesturing`).
- Engine call count per pointerdown is unchanged: one call from the slot if hit on a widget, one from the bus if not.

### Phase 2 — Drop slot-level engine calls + stopPropagation

Remove `engine.handlePointer*` from `WidgetSlot.tsx` and `SelectionOverlaySlot.tsx`. Remove `e.stopPropagation()` from those slot handlers. Remove the slot's `onPointerDown / Move / Up / DoubleClick` props entirely (the slot wrapper becomes purely structural for DOM widgets; for R3F widgets, `SelectionOverlaySlot` becomes pure chrome). Move the `target.closest('button, input, …')` heuristic into the bus.

Acceptance:
- DOM widgets: native React handlers on child elements still fire (bubble path unchanged).
- DOM widgets: drag, resize, marquee, double-click navigation still function — engine receives every pointer event from the bus.
- Engine call count per pointerdown drops to 1.
- No regression in marquee-from-empty-canvas or click-on-button-inside-widget behaviours.

### Phase 3 — Enable R3F canvas events + install `EventRouter`

Drop `pointerEvents: 'none'` from `R3FManager.tsx`'s canvas style. Drop `pointer-events: auto` from `SelectionOverlaySlot`'s wrapper (set to `none`).

Build `EventRouter.ts` and pass it to `<Canvas events={factory}>`. Extend `CompositorContext` so `VirtualWidget`'s registration provides the data the router needs (scene, camera, plus a `hasPointerHandlers` cache). Wire cross-widget leave synthesis into the router's `compute` step.

Acceptance:
- R3F widget: `<mesh onClick>` fires with widget-local `event.point`.
- R3F widget: nested mesh `onClick` resolves to the deepest mesh.
- R3F widget: `event.stopPropagation()` halts propagation within the widget AND prevents engine routing.
- R3F widget: hover transitions inside the widget fire `onPointerEnter` / `onPointerLeave` correctly.
- R3F widget: hover transitions across widget boundaries fire leave on old + enter on new.
- R3F widget: drag from a mesh starts engine drag, suspends widget dispatch, releases on `pointerup`.
- R3F widget: `onPointerMissed` fan-out fires on all mounted R3F widget meshes with `onPointerMissed` handlers when empty canvas is clicked.
- DOM widget: zero regression — all DOM widget behaviour remains identical to Phase 2.
- Touch path: unchanged.

### Phase 4 — Cleanup + docs

Remove the now-dead pointer handler imports and unused `useContainerRef` calls from the slot files. Update `R3FWidgetProps` doc comments to declare the supported R3F event API. Add a short authoring guide section to README documenting the contract.

Acceptance:
- Slot files reduced to chrome + position-update concerns only.
- Docs include an R3F-widget interaction example showing `onClick` + `stopPropagation`.

---

## Open questions

1. **`hasPointerHandlers` detection.** Skipping the per-widget raycast for widgets with zero handlers is a meaningful optimisation for hover-heavy scenes. R3F's manager tracks subscribed handler counts internally — we can read that count off the widget's scene at registration time. If R3F's API doesn't expose it cleanly, fallback is "always raycast"; revisit if profiler shows a measurable cost.

2. **Pointer over an R3F widget that has no mesh under the cursor.** Engine spatial index resolves to the entity (its world AABB covers the pixel) but the widget's geometry might not (transparent regions of the widget's local scene). Decision: this is a "miss within the widget." We do not fall through to the next widget under-Z; the widget owns its bounds. Authors who want click-through transparency should design their geometry accordingly. Document in the authoring guide.

3. **Engine `passthrough` directive vs. widget-internal click.** When the engine returns `passthrough` (no entity hit, or hit but no engine-relevant role), the bus has already let the widget-internal handler run (or not — depending on bubble order). In practice the order is: widget handler fires first (React/R3F bubble), then bus calls engine. There's no conflict because the engine doesn't take any state-changing action on `passthrough`. Worth a regression test pinning the order.

4. **Wheel events.** Out of scope for this RFC. The container's `wheel` handler stays as it is. Touch-pad pinch via `wheel + ctrlKey` doesn't intersect the bus.

---

## Acceptance criteria

**Phase 1 (bus extraction)**
- [ ] `PointerEventBus` is the only call site for `engine.handlePointer*` invoked from the canvas container.
- [ ] All pre-existing interaction tests pass.
- [ ] Touch gesture path still suppresses the bus on multi-touch.

**Phase 2 (slot simplification)**
- [ ] `WidgetSlot` and `SelectionOverlaySlot` contain no `engine.handlePointer*` calls.
- [ ] No slot has `stopPropagation` for engine purposes.
- [ ] `target.closest('button, input, textarea, select, [contenteditable]')` heuristic moved to the bus.
- [ ] Engine call count per pointerdown is exactly 1.
- [ ] DOM widget interaction tests pass unchanged.

**Phase 3 (R3F event routing)**
- [ ] R3F canvas mounts without `pointer-events: none`.
- [ ] `SelectionOverlaySlot` wrapper has `pointer-events: none`.
- [ ] `EventRouter` registered as `<Canvas events={...}>`.
- [ ] `<mesh onClick>` fires with correct widget-local `event.point`.
- [ ] `event.stopPropagation()` on a mesh halts within-widget propagation and prevents engine drag/select.
- [ ] Within-widget hover transitions fire `onPointerEnter` / `onPointerLeave` on meshes.
- [ ] Cross-widget hover transitions fire leave on old + enter on new.
- [ ] Drag from a mesh: engine captures, widget dispatch suspends, release restores both.
- [ ] `onPointerMissed` fans out to all mounted R3F widget meshes with `onPointerMissed` handlers on empty-canvas click (phase-independent — meshes are not unmounted on cull).
- [ ] No DOM widget regression.

**Phase 4 (cleanup)**
- [ ] Slot files contain only chrome + position update logic.
- [ ] Authoring guide updated with R3F widget interaction example.

---

## Dependencies and risks

**Depends on**
- Engine spatial index (`InteractionRole`, RFC-001) — already exists.
- `VirtualWidget` per-widget scene + camera registration in `CompositorContext` — already exists.
- R3F's `<Canvas events={factory}>` API — public, stable.
- Engine `gesturing` flag — already exists (RFC-002 Phase 5).

**Risks**
- **R3F's EventManager internals could change between versions.** We override `compute` (the intersection step) and rely on R3F's bubble / capture / hover / click logic underneath. If R3F refactors that surface, we adapt. Lock the major version in `package.json` and gate upgrades on a manual smoke run of the Phase 3 acceptance set.
- **Pointer capture during drag still routes the up to the container.** Browsers honour `setPointerCapture` consistently on modern WebKit / Blink / Gecko, but Safari has historically had quirks with capture across iframes / shadow DOM. Test on Safari explicitly in Phase 3.
- **`document.elementFromPoint` not used anywhere in this RFC** — keeps things simple and avoids the synthetic-event pitfalls of Alt B. If a future feature needs it (e.g. drag-and-drop from R3F to DOM), revisit then.
- **Hover raycast cost on very large per-widget scenes.** Mitigation: per-widget `hasPointerHandlers` cache (Open Q1). Worst-case fallback is ~one raycast per move per hovered widget — orders of magnitude cheaper than today's full-canvas R3F frame loop, so acceptable even before optimisation.
- **`engineHasCapture` desync.** If the engine returns `capture-drag` but the actual drag is cancelled by some other path (escape key, navigation), the bus needs to clear `engineHasCapture` to re-enable widget dispatch. Subscribe to engine drag-end events from the bus.

---

## Revision notes

**v1** — initial draft, 2026-04-25. Captures the design walkthrough that resolved RFC-002 § Pointer event routing into a concrete plan. Resolves the four open questions raised during the walkthrough:

- **Double-click** lives at the engine / bus level, not on slots — `enterContainer` is the only double-click semantic in the system and the engine resolves the entity from coords directly.
- **R3F portal interaction** with the custom event manager — confirmed compatible (portals share the canvas's EventManager); will smoke-test in Phase 3.
- **`onPointerMissed` for DOM widgets** — deferred until a real use case appears.
- **Pointer capture handoff during engine drag** — bus tracks `engineHasCapture` and short-circuits widget dispatch while true.
