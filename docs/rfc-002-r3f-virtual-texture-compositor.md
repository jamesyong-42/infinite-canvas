# RFC-002: R3F Virtual-Texture Compositor

- **Status**: Draft v2
- **Author**: James Yong
- **Date**: 2026-04-22
- **Area**: Rendering / R3F Layer / ECS
- **Related**: RFC-001 (ECS Hitbox) — depends on `Visible` / `Active` tags and ECS system ordering established there.
- **Supersedes**: RFC-002 v1 (same-day; several items in v1 Open Questions have been resolved into the proposal — see "Revision notes")

---

## Summary

Today's R3F layer (`src/r3f/R3FManager.tsx`) mounts a single full-viewport `<Canvas frameloop="always">` and re-renders every R3F widget on every animation frame, regardless of whether anything in the scene has changed. With 20 widgets where 19 are static and 1 is animating, the engine pays for 20 widgets' worth of CPU traversal and draw-call dispatch, plus a full-viewport framebuffer clear and browser compositor pass, each frame.

This RFC replaces that model with a **virtual-texture compositor**:

- A new **`Culled` ECS tag** (complement of the existing `Visible` tag) makes cull state first-class and shared across DOM and R3F render layers.
- Each R3F widget renders into its **own persistent `WebGLRenderTarget`** (one texture per widget) on demand, not every frame.
- A single fullscreen **composition pass** samples those textures, positioned by each widget's world AABB transformed by the engine camera. Pan and drag-lift effects are pure compositor transforms — zero re-render.
- A **per-widget state machine** with five phases (`Hot` / `Warm` / `Cold` / `Waking` / `Dormant`) governs whether each widget renders, ticks state, or holds a cached texture. Driven by the `Visible` / `Culled` / `Active` tags plus animation signals. Non-Active widgets enter `Dormant` — zero cost, FBO protected so re-activation is instant.
- **Zoom** uses a hysteresis-banded re-render policy plus shader upsampling between bands. **Dynamic DPR** during active pan/zoom gestures drops composition quality transiently, restored on idle.
- **Three.js resources** (geometries, materials, environment textures) are shared across per-widget scenes via an archetype-keyed registry to keep per-widget scene overhead to a minimum.
- **Pointer events** route through the engine spatial index for widget-level hit-test, then into each widget's local R3F scene for intra-widget raycasting — user widget code remains unchanged.
- The architecture is **renderer-agnostic** — ships on WebGL2 first, with a parallel WebGPU renderer path opt-in.

This is a substantial restructure of the R3F layer but does not touch the DOM widget layer, the WebGL grid/selection layer, or the engine. It can be landed in phases; the first three phases (Phases 1–3) shore up the existing architecture without committing to the compositor and are independently valuable.

---

## Motivation

### Current state

`R3FManager.tsx:53-75` mounts:

```tsx
<Canvas
  ref={canvasRef}
  camera={initialCamera}
  frameloop="always"            // ← render every animation frame, no exceptions
  gl={{ alpha: true, antialias: true }}
  style={{ position: 'absolute', inset: 0, ... }}
>
  <CameraSync engine={engine} />
  <ProfilerProbe ... />
  {widgetEntries.map(...)}
</Canvas>
```

Per-frame cost breakdown for an N-widget scene where M ≤ N are animating:

| Cost | Scales with | Avoidable? |
|---|---|---|
| `requestAnimationFrame` tick | constant 60 Hz | yes — `frameloop="demand"` |
| `useFrame` callbacks (CameraSync + ProfilerProbe + per-widget) | N + 2 | partial — only animating widgets need to tick |
| Scene-graph traversal + uniform uploads | N | partial — only dirty widgets |
| Draw-call dispatch | N × draws-per-widget | yes — only dirty widgets need redraw |
| Full-viewport framebuffer clear | viewport pixels | yes — only redraw rect needs clearing |
| Fragment shading | sum of widget screen footprints | already minimal |
| Browser compositor (transparent canvas overlay) | viewport pixels | constant per render — but if no render, no composite |

The fragment shading line is a common red herring: GPUs don't shade pixels outside the rasterised geometry, so "fullscreen canvas" doesn't mean "fullscreen shading." The real waste is the constant CPU/dispatch cost and the unconditional clear/composite cycle running at 60–120 Hz when, for most cards in most sessions, nothing has changed since last frame.

### What's already in place

The codebase has the load-bearing primitives this RFC needs:

- **Spatial culling**: `cullSystem` (`src/ecs/systems/cull.ts`) tags entities `Visible` when they intersect the camera AABB plus a 200-px overscan band. Already wired into the tick pipeline.
- **`Active` / `Visible` tags**: separate concerns — `Active` = part of the current navigation frame, `Visible` = on-screen. The state machine in this RFC keys off `Visible`.
- **`Camera` resource + `CameraSync.tsx`**: world-space camera state that the composition pass needs to project widget AABBs.
- **Multi-layer profiler**: `Profiler.recordR3FFrame` (`src/profiler/Profiler.ts`) already samples R3F per-frame counters. We extend it with per-widget render counters and per-pass GPU timestamps.
- **`R3FWidgetSlot`** (`src/r3f/R3FWidgetSlot.tsx`): clean per-widget boundary already exists. The compositor architecture just changes what `R3FWidgetSlot` renders into and when.

### What this RFC is not

- **Not a refactor of the DOM widget layer.** DOM widgets render through React directly; they're already on-demand. This is purely about the WebGL surface.
- **Not a port to WebGPU as a precondition.** The compositor model works on WebGL2 today. WebGPU is a downstream optimisation path with separately documented benefits.
- **Not a replacement for `frameloop="demand"`.** Demand mode is necessary but insufficient for this case — invalidating the canvas still re-renders all widgets. The compositor is what gives us per-widget granularity.

---

## Proposal

### Mental model

Treat each widget as a **paint layer** in a browser-style compositor:

1. **Paint** — widget renders into its own GPU texture when something invalidates it. Cost proportional to that one widget.
2. **Composite** — fullscreen pass samples all visible widget textures, positions them by world AABB × camera, applies pan/zoom/drag transforms in the shader. Cost proportional to viewport pixels covered, independent of widget count.

Pan, drag-lift, hover ring — all live in the compositor and need zero widget re-renders. Animation, data change, zoom-band crossing — these invalidate a single widget's paint.

### New module layout

```
src/r3f/
  R3FManager.tsx                ← restructured: owns the compositor canvas
  CameraSync.tsx                ← unchanged
  ProfilerProbe.tsx             ← extended with per-widget counters
  R3FWidgetSlot.tsx             ← deprecated, replaced by VirtualWidget
  ProfilerProbe.tsx
  compositor/                   ← [NEW] all compositor concerns
    Compositor.tsx              ← top-level <Canvas> + composition pass
    VirtualWidget.tsx           ← per-widget render-target lifecycle
    WidgetRenderTargetPool.ts   ← FBO allocation, eviction (LRU + budget)
    WidgetStateMachine.ts       ← Hot/Warm/Cold/Waking transitions
    CompositionMaterial.ts      ← shader sampling N widget textures
    ZoomBands.ts                ← hysteresis policy for zoom-driven re-renders
    renderer/
      WebGL2Renderer.ts         ← Three.js WebGLRenderer wrapper
      WebGPURenderer.ts         ← Three.js WebGPURenderer wrapper [opt-in]
  widgets/                      ← unchanged user-facing widget API
```

### New ECS components / resources

#### `Culled` — new shared lifecycle tag (applies to ALL widgets, DOM and R3F)

This is the one ECS addition in this RFC that isn't R3F-specific. It formalises cull state as a first-class tag so every render layer consumes the same signal.

**Current state** (`src/ecs/systems/cull.ts`): `cullSystem` marks Active entities intersecting the viewport (+200 px overscan) as `Visible`. Active entities *outside* the overscan have no tag. Non-Active entities also have no tag. So "why is this widget not rendered?" has two possible answers collapsed into the same empty-tag state, which obscures two very different intentions:

- "Active but off-screen" → should be kept in a cold cache (DOM mounted-but-hidden, R3F FBO retained).
- "Not in the current navigation frame" → should be preserved across navigation switches so re-activation is instant, regardless of viewport position.

Adding an explicit `Culled` tag separates these.

```typescript
/** Entity is Active and intersects the viewport+overscan AABB. Render normally. */
export const Visible = defineTag('Visible');     // already exists

/** Entity is Active but outside viewport+overscan. Cached state, not rendered. */
export const Culled = defineTag('Culled');       // NEW
```

**Invariant**: for every `Active` entity, exactly one of `Visible` or `Culled` is set. For non-Active entities, neither.

**Updated `cullSystem`**:

```typescript
export const cullSystem = defineSystem({
  name: 'cull',
  after: 'navigationFilter',
  execute: (world) => {
    const camera = world.getResource(CameraResource);
    const viewport = world.getResource(ViewportResource);
    if (viewport.width === 0 || viewport.height === 0) return;

    // Clear previous frame's tags.
    for (const e of world.queryTagged(Visible)) world.removeTag(e, Visible);
    for (const e of world.queryTagged(Culled)) world.removeTag(e, Culled);

    const overscan = 200 / camera.zoom;
    const vpAABB = { /* ... as before ... */ };

    const visibleIds = new Set<EntityId>();
    const candidates = spatialIndex.search(vpAABB);
    for (const entry of candidates) {
      if (world.hasTag(entry.entityId, Active)) {
        world.addTag(entry.entityId, Visible);
        visibleIds.add(entry.entityId);
      }
    }

    // Tag remaining Active entities as Culled.
    for (const e of world.queryTagged(Active)) {
      if (!visibleIds.has(e)) world.addTag(e, Culled);
    }
  },
});
```

**Consumers**:

- **DOM widget layer** (`WidgetSlot` / `R3FWidgetSlot` mounting): unchanged rendering of `Visible`; optionally listens to `Culled` to keep slots mounted-but-hidden for fast unculling (skipping React unmount/remount thrash). This is a separate optimisation not required to land with this RFC, but the tag is there for future use.
- **R3F compositor**: phase transitions key off `Visible` / `Culled` / `!Active` directly (see [§ State machine](#state-machine)).
- **WebGL selection renderer**: already iterates `Visible`; no change.

**Why a tag rather than a derived query**: the reactive-ecs API's `queryTagged` is O(k) where k = tag count. The equivalent "Active without Visible" query requires iterating all Active entities and testing absence — O(A) where A ≫ k once many entities are off-screen. The tag also supports `onTagAdded` / `onTagRemoved` observers for reactive systems (animation cancellation, FBO eviction).

**Serialization**: `Culled` is runtime-only, same as `Visible`. Add to the skip list in `serialization.ts:55-56` and `:180`.

#### `R3FRenderState` — per-widget state machine value

```typescript
type R3FStatePhase = 'Hot' | 'Warm' | 'Cold' | 'Waking' | 'Dormant';

interface R3FRenderStateData {
  phase: R3FStatePhase;
  /** Pixel resolution the texture was last rendered at (width × height). */
  paintedAt: { width: number; height: number; dpr: number; zoom: number };
  /** True if the widget itself has signalled an animation tick is in progress. */
  animating: boolean;
  /** Bumped when the widget should re-render — composition pass reads this. */
  paintGeneration: number;
  /** Generation last successfully painted into the FBO. */
  fboGeneration: number;
}

export const R3FRenderState = defineComponent<R3FRenderStateData>('R3FRenderState', {
  phase: 'Cold',
  paintedAt: { width: 0, height: 0, dpr: 1, zoom: 1 },
  animating: false,
  paintGeneration: 0,
  fboGeneration: -1,
});
```

State transitions are documented in detail in [§ State machine](#state-machine).

#### `R3FRenderBudget` — global resource

```typescript
interface R3FRenderBudgetData {
  /** Total bytes of GPU memory the widget FBO pool may consume. */
  maxBytes: number;
  /** Current consumption — written by the pool, read by eviction logic. */
  currentBytes: number;
  /** Max widgets to repaint per composited frame (stagger budget). */
  maxRepaintsPerFrame: number;
}

export const R3FRenderBudget = defineResource<R3FRenderBudgetData>('R3FRenderBudget', {
  maxBytes: 256 * 1024 * 1024,    // 256 MB default
  currentBytes: 0,
  maxRepaintsPerFrame: 4,
});
```

#### `R3FAnimationSignal` — opt-in tag

A widget that wants per-frame ticking sets this tag (typically through a hook — see [§ Widget API](#widget-api)). The state machine treats `Visible + R3FAnimationSignal` as the trigger for `Hot`. Removing the tag transitions back to `Warm`.

```typescript
export const R3FAnimationSignal = defineTag('R3FAnimationSignal');
```

### State machine

```
                              ┌─── !Active ────────────────────┐
                              │                                 ▼
                         ┌────┴─────┐                   ┌──────────────┐
                         │  (any)   │ ◄── Active ───────│   Dormant    │
                         └────┬─────┘                   └──────────────┘
                              │                           (FBO retained,
                              │                            eviction-last)
                              ▼
     ┌──────┐ Culled  ┌───────┐  Visible + texture present  ┌────────┐
     │ Cold │ ◄─────  │ Cold* │ ──────────────────────────► │  Warm  │
     └──────┘         └───────┘                              └────────┘
        │ texture evicted                                       │  ▲
        │                                                       │  │
        │  Visible + no texture                                 │  │ animation
        ▼                                                       ▼  │ signal
     ┌────────┐  paint completes      ┌────────┐                ┌──────┐
     │ Waking │ ────────────────────► │  Warm  │ ──────────────►│ Hot  │
     └────────┘                       └────────┘   starts anim  └──────┘
```

| Phase | Tags | Texture | State tick | Render tick | Composited |
|---|---|---|---|---|---|
| **Hot** | `Active + Visible + R3FAnimationSignal` | present, refreshed each invalidation | yes | yes | yes |
| **Warm** | `Active + Visible` | present, valid | no | no | yes, sampled as-is |
| **Waking** | `Active + Visible`, just un-culled/un-dormant, no valid FBO | absent or stale | yes (one shot) | yes (one shot) | next frame, after paint |
| **Cold** | `Active + Culled` | present (LRU eligible) or evicted | no | no | no (off-screen) |
| **Dormant** | `!Active` | present, **eviction-protected** | no | no | no (not in active nav frame) |

Transition triggers (driven from the ECS tags by `WidgetStateMachine.ts`):

- **Any → Dormant**: `Active` tag removed. Rendering and ticking stop immediately. FBO is *not* released; pool marks it as eviction-protected. Re-activation (`Active` added back) transitions to Warm (texture intact) or Waking (texture was evicted under extreme pressure).
- **Dormant → Warm / Waking**: `Active` added back. If `Visible` is already set and FBO generation matches, Warm. Else Waking. Cost on re-entry: zero repaint in the common case.
- **Cold → Waking**: `Visible` tag added (spatial intersection). If texture exists and `paintGeneration === fboGeneration`, skip Waking — go straight to Warm.
- **Waking → Warm**: paint completes, `fboGeneration` updated.
- **Warm → Hot**: `R3FAnimationSignal` tag added or `paintGeneration` bumped by an external invalidation source.
- **Hot → Warm**: `R3FAnimationSignal` removed and final paint complete.
- **Warm / Hot → Cold**: `Culled` tag added (i.e., `Visible` removed).
- **Cold → Cold***: texture evicted by pool under memory pressure (asterisk denotes "Cold with no valid FBO" — re-entry requires Waking).

**Dormant design notes**: Dormant models "the user has switched navigation frames; this widget is stored but not shown." The pool's eviction priority is `Dormant ≫ Cold (LRU) ≫ Warm (LRU)` — Dormant FBOs are the last to be evicted under memory pressure. A Dormant widget coming back via Active re-tagging should be visually indistinguishable from never having left, unless the pool had to evict it. Eviction of Dormant entries is logged at debug level so we can tune the memory budget when it happens.

#### Why decouple state tick from render tick

Some widgets advance state independently of rendering — a chart subscribed to a data stream, a timer ticking up, a spring driven by external velocity input. If these state ticks pause when the widget goes off-screen, they snap on uncull (jumping to "now"). If they continue, the widget is in the right state when it comes back, but you've paid CPU cost while invisible.

Default policy: **state ticks while Hot, paused while Warm/Cold**. Widgets that need always-on state can opt in with a `state-only` tick mode (no rendering), implemented as a separate `R3FStateOnlySignal` tag — out of scope for this RFC, included as a future hook in [§ Open questions](#open-questions).

### Composition pass

Per composited frame:

```
1. Update camera (CameraSync writes to camera resource — already exists)
2. Determine dirty widget set:
     - Visible widgets where paintGeneration > fboGeneration (Waking + Hot)
     - Cap at R3FRenderBudget.maxRepaintsPerFrame (stagger)
3. For each dirty widget (in priority order):
     - Bind widget's WebGLRenderTarget
     - Render widget's local scene (orthographic, widget-local space)
     - Update fboGeneration
4. Composition pass:
     - Bind default framebuffer (viewport)
     - Clear to canvas background (alpha 0)
     - For each Visible widget (sorted by ZIndex):
         - Issue one quad with widget's FBO as texture
         - Vertex shader projects widget worldAABB through engine camera
         - Fragment shader samples FBO with mip selection from current zoom
     - Drag-lift, hover ring, selection outline can also be composited here
       as additional quads driven by ECS state, no widget re-render needed
```

Priority for the stagger budget (highest first):
1. Waking widgets that just entered visible bounds (avoid first-frame stall)
2. Hot widgets currently animating
3. Warm widgets that crossed a zoom-up band (sharpness restoration)
4. Warm widgets that crossed a zoom-down band (memory reclaim)

If priority 1 alone exceeds the budget, the excess defers one frame (stale texture sampled until paint lands). This is the same trade-off the cull margin is designed to absorb: aggressive margin = fewer first-frame stalls but more painted-but-invisible widgets.

### Zoom handling

A widget's FBO has a fixed pixel resolution. Its display size on the composited frame is `widgetWorldSize × cameraZoom × DPR`. Sharpness ratio = `display / source`.

| Ratio | Visual effect | Action |
|---|---|---|
| 0.25× – 0.66× | downsampled, fine | composite samples lower mip — free, no repaint |
| 0.67× – 1.5× | within natural range | composite uses base mip — no action |
| 1.5× – 2.0× | mild blur acceptable in motion | shader upsample (bilinear), defer repaint until gesture idle |
| > 2.0× | unacceptable blur | invalidate, repaint at new band |
| < 0.25× | significant memory waste | invalidate, repaint at new band (smaller) |

Bands are defined as powers of 2 in `ZoomBands.ts`:

```typescript
const ZOOM_BANDS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];

function selectBand(currentZoom: number, paintedZoom: number): number {
  const ratio = currentZoom / paintedZoom;
  if (ratio > 2 || ratio < 0.5) {
    return ZOOM_BANDS.find(b => b >= currentZoom) ?? 16;
  }
  return paintedZoom;
}
```

Hysteresis comes from the band gap: a widget painted at band 1 stays valid in display zooms `[0.5, 2.0]`. Continuous zoom across the band edge re-renders once, then is stable across a 4× display range.

Crucially: **during an active zoom gesture (engine reports `gesturing: true`), defer all band-driven invalidations until the gesture ends.** Prevents repaint thrash during pinch/wheel. This is gated through the existing camera resource — extend it with a `gesturing` boolean already partially used by the touch path in `InfiniteCanvas.tsx`.

### Renderer abstraction

```typescript
interface CompositorRenderer {
  /** Allocate an FBO for a widget at the requested resolution. */
  allocateRenderTarget(width: number, height: number): WidgetRenderTargetHandle;
  releaseRenderTarget(handle: WidgetRenderTargetHandle): void;

  /** Render a scene into a render target. */
  paintWidget(handle: WidgetRenderTargetHandle, scene: Scene, camera: Camera): void;

  /** Composition pass — renders to default framebuffer. */
  composite(quads: CompositionQuad[]): void;

  /** Optional GPU timing — null on WebGL without WEBGL_timer_query. */
  beginTimestamp(label: string): TimestampHandle | null;
  endTimestamp(handle: TimestampHandle): Promise<number>;

  bytesUsed(): number;
}

interface CompositionQuad {
  texture: WidgetRenderTargetHandle;
  worldAABB: AABB;            // widget's world bounds
  zIndex: number;
  liftZ: number;              // for drag effect
  scale: number;              // for drag-lift scale
  alpha: number;
}
```

Two implementations: `WebGL2Renderer` and `WebGPURenderer`. `Compositor.tsx` accepts a renderer instance via prop or auto-selects based on browser support.

WebGPU advantages we get for free with this abstraction:
- **Render bundles** — composition quads for Warm widgets pre-recorded, replayed each frame. Massive CPU win.
- **Timestamp queries** — actual per-pass GPU time, not estimates.
- **Multi-target rendering** — paint multiple Hot widgets in parallel.
- **Compute shader upsampler** — better quality than bilinear in the > 1.5× zoom band.

### Dynamic DPR during gestures

During active camera gestures (pan, pinch, wheel zoom), the compositor drops render resolution transiently. This matches browser compositor behaviour ("reduced quality during scroll") and is worth 30–50% GPU time during continuous input on mid-tier hardware.

Policy:

```typescript
interface CompositionDprPolicy {
  /** DPR used when the camera is idle (no gesture, no animation). */
  idleDpr: number;              // default: window.devicePixelRatio
  /** DPR used during active pan/zoom gestures. */
  gestureDpr: number;           // default: min(idleDpr, 1.0)
  /** Frames of continuous idle before restoring idleDpr. */
  idleFramesBeforeRestore: number;  // default: 6 (~100 ms at 60 Hz)
}
```

This affects **only the final composition pass**, not individual widget FBO resolutions. Widget FBOs are governed by their own zoom band hysteresis (see [§ Zoom handling](#zoom-handling)). So during a pinch gesture:

1. Compositor renders at `gestureDpr` → cheap fullscreen quad pass.
2. Widget FBOs keep their current band → no repaints.
3. Visual result: slightly softer composited image, no widget repaint thrash.
4. Gesture ends → after `idleFramesBeforeRestore` idle frames, compositor restores `idleDpr` and repaints the fullscreen pass once.
5. Any widgets whose zoom band is now stale get invalidated and repainted over the next few frames (subject to `maxRepaintsPerFrame` budget).

The `gesturing` flag on the camera resource drives this. Already partially set by the touch path (`InfiniteCanvas.tsx`) during pinch; extend to wheel zoom and pan in the same patch.

### Three.js resource sharing

Each widget owns its own `THREE.Scene` so it can render independently into its FBO. Naive implementation duplicates geometries, materials, textures, and environment maps per widget — a 100-widget canvas could hold 100× the GPU memory required.

**Strategy**: an archetype-keyed registry caches shared resources.

```typescript
// src/r3f/compositor/ResourceRegistry.ts

interface SharedResources {
  geometries: Map<string, BufferGeometry>;
  materials:  Map<string, Material>;
  textures:   Map<string, Texture>;
  envMaps:    Map<string, Texture>;   // PMREM-processed environment
}

class ResourceRegistry {
  private cache = new Map<ArchetypeId, SharedResources>();

  getOrCreate<K extends keyof SharedResources>(
    archetype: ArchetypeId,
    kind: K,
    key: string,
    factory: () => SharedResources[K] extends Map<string, infer V> ? V : never,
  ): ReturnType<typeof factory>;

  /** Called on archetype unregistration. */
  releaseArchetype(archetype: ArchetypeId): void;
}
```

Rules:

- **Geometries** — shared by default. Same archetype → same geometry instance across all widget scenes. The rounded-card geometry in `geometry-card.tsx:20-47` already memoises per-widget; hoist to registry keyed by `(width, height, radius, depth)` so resizable widgets share at discrete breakpoints.
- **Materials** — sharable if no per-instance uniforms. Widgets needing per-instance colour use `material.clone()` sparingly or push colour through vertex colours / instanced attributes.
- **Textures / env maps** — always shared. Widget scenes assign the same `Texture` instance; Three.js handles GPU binding correctly.
- **Lights** — stay per-widget. Each widget declares its own lights in local space; sharing would require absolute positions to be transformed per render, which defeats the purpose.

Archetype keying lets the registry release resources when all widgets of an archetype are gone (tracked via ref counts). Under memory pressure, the pool can also evict shared textures (weak-held) as a last resort before starting to reject paints.

This section addresses v1 Open Question 6. Memory savings are validated in the Phase 0 benchmark; if per-archetype sharing doesn't meet the target for 1000-widget scenes, consider instanced rendering of identical widget bodies (defer until measured).

### Pointer event routing

Widget authors continue to write normal R3F interaction code — `onClick`, `onPointerOver`, `onPointerMove`, nested `onPointerDown` on child meshes, etc. The compositor transparently handles routing so that R3F's raycaster is never run against the composition canvas (which would resolve every event to a fullscreen quad).

**Design**:

1. The composition canvas's native pointer events are captured by the engine-level pointer handler (already how DOM widgets work — `engine.handlePointerDown` is coordinate-based, see RFC-001 § DOM topology assumption).
2. The engine's spatial index resolves to an `EntityId`.
3. For R3F widgets, the event is forwarded to a **widget-scoped raycaster** that runs against just that widget's local scene with the pointer mapped into widget-local coordinates.
4. The raycaster produces R3F's internal `Intersection[]` output, fed into R3F's event dispatcher with the widget's scene as the "root" — so `onClick` / `onPointerOver` bubble through the widget's scene graph normally.

```typescript
// src/r3f/compositor/EventRouter.ts

class WidgetEventRouter {
  /** Called by engine pointer handler when a point resolves to an R3F widget. */
  route(widget: EntityId, event: PointerEvent): void {
    const scene = this.widgetScenes.get(widget);
    const camera = this.widgetCamera(widget);
    if (!scene || !camera) return;

    // Map pointer to widget-local NDC.
    const local = this.pointerToWidgetLocal(widget, event);

    // Run R3F's event machinery against ONLY this widget's scene.
    this.r3fEventManager.handlePointers(local, { scene, camera });
  }
}
```

Implementation notes:

- R3F's event system (`@react-three/fiber`'s internal `EventManager`) accepts a custom `getEventPriority` / `filterEvents` configuration. The compositor provides a configured event manager that ignores the default canvas raycaster path and only dispatches when `WidgetEventRouter.route` feeds it a widget-scoped intersection.
- The `eventSource` prop on `<Canvas>` (or the compositor's `<CompositorProvider>` equivalent) points at the engine's event emitter, not the canvas DOM element. The engine is already the source of truth for pointer state.
- Per-widget raycasts are cheap because each widget's local scene is small. No spatial overhead.
- Hover tracking: the engine already emits hover changes via the spatial index; the router maps these to synthetic `onPointerEnter` / `onPointerLeave` events per widget.

**Zero-friction guarantee** for widget authors:

- `onClick`, `onPointerOver`, `onPointerOut`, `onPointerMove`, `onPointerDown`, `onPointerUp`, `onPointerLeave`, `onPointerEnter`, `onPointerMissed` — all work identically to standard R3F.
- `event.point`, `event.uv`, `event.face`, `event.intersections` populated by the widget-scoped raycaster, with positions in widget-local space.
- `event.stopPropagation()` stops propagation within the widget. It does *not* prevent the engine from receiving the pointer (which it needs for drag/resize); the engine's own pointer-down handler gates selection/drag semantics based on the widget's reported `InteractionRole` (RFC-001).
- `raycast` overrides on meshes continue to work — each mesh's own `raycast` method is called by the widget-scoped raycaster.

**`onPointerMissed` semantics**. In the default R3F event model, clicking empty canvas fires `onPointerMissed` on any scene node that registered for it. In the compositor, "missed" means the engine spatial index returned no entity for the pointer coordinates. The router handles this by fanning the missed event out to **every Visible widget scene simultaneously** — any widget with `onPointerMissed` handlers on its meshes or groups receives the dispatch. Dormant and Culled widgets do not receive `onPointerMissed` (they aren't on-screen). This matches the natural user expectation that a click on blank canvas can deselect or defocus whatever's currently shown.

What authors lose vs the default R3F event model:

- Cross-widget event bubbling (e.g., `onPointerMove` on an ancestor Group catching events from a child widget). This was always architecturally unlikely in the compositor model because different widgets are separate scenes, and the engine is the interaction orchestrator.
- Ability to receive events on meshes outside the widget's own scene. Not a feature anyone has used; acceptable regression.

This section addresses v1 Open Questions 7 and (v2) 6. A Phase 4 acceptance test covers hover, click, drag-start, nested-mesh `onClick`, `stopPropagation`, and `onPointerMissed` fan-out against compositor output.

### Widget API

The user-facing API in `src/react/widgets` does not change. The lift in this RFC is internal to the R3F layer. Two new opt-in hooks expose compositor features:

```typescript
/**
 * Marks the current widget as actively animating. While the returned ref is true,
 * the widget renders every frame (Hot phase). Set to false to return to Warm.
 *
 * Replacement for `useFrame` inside R3F widgets — that hook still works but
 * it ticks at canvas rate, not widget rate, defeating the compositor.
 */
function useWidgetAnimation(active: boolean): void;

/**
 * Schedules a one-shot repaint of the current widget. Use when widget data
 * changes outside React's render cycle (e.g., subscribed external state).
 */
function useWidgetInvalidate(): () => void;
```

Internally these set/clear the `R3FAnimationSignal` tag and bump `paintGeneration` respectively.

The existing `geometry-card.tsx` widget has a spring lerp inside `useFrame` (lines 144–152). Migration: wrap with `useWidgetAnimation(dragging)` so the spring is Hot during drag and Warm at rest. The spring runs while `dragging` is true plus a tail until `s` and `g.position.z` settle within epsilon — call sites can manage the tail with a small `useEffect`.

---

## Alternatives considered

### Alt A: `frameloop="demand"` only

Simplest possible change: switch the canvas to demand mode and call `invalidate()` on camera change, drag, animation tick.

- **Pro**: ~20 LOC. Removes idle-frame cost completely. No architectural change.
- **Con**: still re-renders all N widgets when any one of them invalidates. The 19/1 scenario this RFC is designed for sees ~20× more work per animating frame than necessary. No zoom resolution control. No path to per-widget GPU timing.
- **Verdict**: ship as Phase 1 of this RFC. Necessary but insufficient.

### Alt B: Two-canvas split (static + dynamic)

Mount two `<Canvas>` elements: one with all idle widgets in `frameloop="demand"`, one with currently-animating widgets in `frameloop="always"`. Promote/demote on animation start/end.

- **Pro**: simpler than full compositor. Uses standard R3F primitives. Browser compositor preserves the static canvas's pixels for free.
- **Con (architectural)**: z-order is canvas-level — the dynamic canvas is always on top, which works for drag-lift but breaks cleanly interleaved z. No per-widget zoom resolution. State-tick / render-tick coupling unchanged. Each canvas still re-renders all of its widgets when any one invalidates (smaller N but same problem).
- **Con (performance)**: counter-intuitively, multi-canvas is often *heavier* than single-canvas multi-pass. Each `<Canvas>` is its own WebGL context with its own GPU command queue, its own state machine, and its own compositor layer in the browser. Context switches serialize on most drivers; GPU resources (geometries, materials, textures, environment maps) cannot be shared across contexts — so Three.js state duplicates. The browser then composites N canvas layers, each at full viewport cost, before final screen presentation. Practical upshot: the "free preservation" the browser compositor gives you is paid back via per-canvas overhead and duplicated GPU memory. Multi-canvas only wins when the browser can actually run contexts in parallel (rare, usually only when each canvas is fully off-thread via OffscreenCanvas + workers — see Alt C).
- **Verdict**: rejected. The compositor model both subsumes the two-canvas idea (Warm bucket = "static canvas," Hot bucket = "dynamic canvas") and avoids its performance penalties by sharing a single context, command queue, and resource pool. Once committing to per-widget FBOs is on the table, the unification is cleaner in every dimension.

### Alt C: OffscreenCanvas + worker per widget

Each widget owns a worker with an OffscreenCanvas; main thread composites via `ImageBitmap`.

- **Pro**: parallel widget rendering across CPU cores. Useful if widget scenes are CPU-heavy.
- **Con**: WebGL contexts don't share resources across workers, so each widget needs independent textures. Composition requires per-frame readback or `transferControlToOffscreen` machinery. Browser context limits cap this at ~16 widgets. WebGPU has cleaner cross-thread story but still requires substantial plumbing.
- **Verdict**: orthogonal optimisation, not a replacement for the compositor. The compositor architecture *enables* this later: each widget's "paint" step can be pushed to a worker if profiler shows main-thread CPU bottleneck. Defer until measured.

### Alt D: `preserveDrawingBuffer: true` + scissor redraws

Enable backbuffer preservation, then each frame scissor-clear and redraw only the animating widget's screen rect.

- **Pro**: no per-widget FBOs. Single canvas.
- **Con**: `preserveDrawingBuffer` carries a driver-level perf penalty (forced extra blit on most platforms) and visible artifacts on some Android/iOS browsers. Pan invalidates everything (no way to translate preserved pixels). Z-overlap with Warm widgets requires redrawing those too. Camera zoom invalidates all widgets simultaneously.
- **Verdict**: rejected. The penalty defeats the savings on the platforms most affected by R3F frame cost (mid-tier mobile).

### Alt E: drei `<View>` per widget

Use `@react-three/drei`'s `<View>` to scissor-render each widget into its own viewport rect, tracked to a DOM element.

- **Pro**: well-trodden pattern, uses standard R3F machinery.
- **Con**: View internally still ticks all views per frame — scissor saves fragment work but not CPU traversal. No texture caching, so an idle frame still pays N draw calls. Doesn't address zoom resolution. Adding caching on top would essentially reinvent the compositor model.
- **Verdict**: View is the right primitive if you want one-shot scissored rendering. We want texture caching across frames, which is a different concern. Reject.

---

## Migration path

### Phase 0 — Benchmark

Before any code changes, capture baseline frame timings using the existing profiler. Test scenes:

- **Idle** — 1 / 10 / 100 / 1000 R3F widgets, no animation, no input.
- **Single-widget animation** — 1 widget actively spring-lerping (drag), N − 1 idle. Run for N ∈ {5, 20, 100}.
- **Pan** — continuous pan across a 1000-widget scene.
- **Zoom** — continuous zoom from 0.25× to 8× across a 100-widget scene.
- **Multi-animate** — drag 5 widgets simultaneously (multi-select drag), N = 50.

Record per-frame: total ms, R3F draw calls, R3F triangles, programs, memory.geometries, memory.textures. The existing `R3FSample` (`Profiler.ts:55-68`) covers this.

Phase exit criterion: baseline numbers checked into `docs/perf-baselines/r3f-2026-04.md` for regression tracking.

### Phase 1 — `frameloop="demand"` + invalidation wiring

Switch `R3FManager.tsx:57` to `frameloop="demand"`. Wire `invalidate()` calls at:

- `CameraSync.tsx:18` after `syncCamera` writes new camera state.
- `R3FWidgetSlot.tsx:28` `useFrame` — replaced with a subscription to the entity's `WorldBounds` change event.
- A new top-level subscription that invalidates on widget add/remove (already triggered by `widgetEntries` memoisation in `R3FManager.tsx:39-51`, just needs to call `invalidate`).
- Inside `geometry-card.tsx`'s spring loop — invalidate while spring is settling.

Acceptance:
- Idle scene with no animation: zero `R3FSample` records produced over a 10-second window.
- Drag scene: continuous frames during drag, zero frames after release once spring settles.
- Phase 0 baseline re-run shows ≥ 80% reduction in idle frame count and no regression in active-drag frame time.

This phase is independently shippable. If Phases 2+ slip, this alone removes the bulk of idle waste.

### Phase 2 — Profiler extensions

Extend `R3FSample` with:

```typescript
interface R3FSample {
  // ... existing fields
  /** Per-widget paint count this frame. */
  widgetsRepainted: number;
  /** FBO pool memory consumption in bytes. */
  fboBytes: number;
  /** Phase histogram. */
  phases: { hot: number; warm: number; cold: number; waking: number };
  /** GPU timestamps when available (WebGPU or WEBGL_timer_query). */
  gpuPaintMs?: number;
  gpuCompositeMs?: number;
}
```

Wire through `Profiler.recordR3FFrame`. Inspector panel adds a per-widget phase histogram and a paint-count sparkline.

This phase is preparatory — it gives us the instrumentation needed to validate Phases 3+ without speculation.

### Phase 3a — `Culled` tag + updated `cullSystem` (shared ECS primitive)

Independent of the compositor. Adds the `Culled` tag to `src/ecs/components.ts`, extends `src/ecs/systems/cull.ts` to tag both `Visible` and `Culled` per the invariant, and updates `src/ecs/serialization.ts:55-56` and `:180` to skip `Culled` (runtime-only, same as `Visible`). No consumers in this phase — the tag is just defined and maintained.

Acceptance:
- Every `Active` entity has exactly one of `Visible` or `Culled` each tick.
- No non-Active entity has either tag.
- No existing behaviour changes (the tag has no consumers yet).
- Zero p95 regression in `cullSystem` duration at 1000 entities.

### Phase 3b — `R3FRenderState` component + state machine (no compositor yet)

Register the `R3FRenderState` component, `R3FRenderBudget` resource, and `R3FAnimationSignal` tag. Implement `WidgetStateMachine.ts` as an ECS system that updates the phase from `Visible` / `Culled` / `Active` + `R3FAnimationSignal`. **No FBO allocation yet — just the bookkeeping.**

`R3FWidgetSlot` reads its phase and gates `useFrame` on `phase === 'Hot'`. This alone gives us "only animating widgets tick" without changing the rendering model.

Acceptance:
- 19/1 scenario: profiler shows 1 widget in Hot, 19 in Warm; Hot widget's `useFrame` runs every frame, Warm widgets' `useFrame` does not.
- Panning widgets out of viewport transitions Warm/Hot → Cold.
- Removing `Active` from a widget transitions it to Dormant; re-adding returns to Warm without a repaint.
- No render output changes (still rendering through the existing single canvas).

### Phase 4 — `WidgetRenderTargetPool` + `VirtualWidget` + event routing + resource sharing

The big phase. Lands the compositor model end-to-end.

**4a — FBO pool + per-widget paint.** Introduce `WidgetRenderTargetPool.ts`: allocates `WebGLRenderTarget` instances, tracks bytes. Implement `VirtualWidget.tsx` that renders its scene into its own FBO when paint is requested. Stub composition: `texture2D(fbo, uv)` per widget, sized at current display resolution, no upsampler yet, no zoom-band logic yet.

**4b — Resource sharing registry.** Implement `ResourceRegistry.ts` per [§ Three.js resource sharing](#threejs-resource-sharing). Hoist `geometry-card.tsx`'s rounded-card geometry memoisation into the registry keyed by `(width, height, radius, depth)`. Environment textures and PMREM-processed cubemaps share by default.

**4c — Event routing.** Implement `WidgetEventRouter.ts` per [§ Pointer event routing](#pointer-event-routing). Replace R3F's default event manager with the compositor's custom one. Plumb through engine spatial index → widget → widget-scoped raycaster.

Acceptance:
- 19/1 scenario: only the Hot widget's FBO repaints each frame; Warm widgets sampled from cached FBOs.
- Pan: zero widget repaints during pan (composition reads same FBOs at new positions).
- Visual output matches Phase 3 (no regressions in z-order, color, alpha).
- Phase 0 baseline re-run shows ≥ 90% reduction in 19/1 active-drag GPU work.
- 100-widget scene with all widgets of the same archetype: GPU memory for geometries is O(1), not O(N). Verified via `renderer.info.memory`.
- Pointer event acceptance tests pass:
  - Click on a mesh inside a widget → widget's `onClick` fires with widget-local `event.point`.
  - Nested mesh `onClick` resolves to the deepest mesh.
  - `event.stopPropagation()` inside a widget's scene halts propagation within that widget.
  - Hover across widget boundaries fires `onPointerLeave` on the exiting widget and `onPointerEnter` on the entering one.
  - Click on empty canvas fires `onPointerMissed` on all visible widget scenes.
  - Drag initiated from a widget's mesh dispatches to the engine (which handles move/end), while `onPointerDown` still fires on the widget.

### Phase 5 — Zoom hysteresis + dynamic DPR

Add `ZoomBands.ts` policy per [§ Zoom handling](#zoom-handling). `WidgetStateMachine` triggers repaint when current zoom crosses the painted band. Composition shader upsamples (bilinear) within band tolerance.

Add `CompositionDprPolicy` per [§ Dynamic DPR during gestures](#dynamic-dpr-during-gestures). Extend the camera resource's `gesturing` flag (currently partially set by touch path) to cover wheel zoom and pan. Compositor reads this and switches between `idleDpr` and `gestureDpr` for the final pass.

Acceptance:
- Continuous wheel zoom from 0.25× to 8×: ≤ 1 repaint per band crossing per widget. Profiler `widgetsRepainted` count consistent with band math.
- Paused mid-zoom: in-band widgets sharp, out-of-band widgets visibly soft for one frame, sharp the next.
- No flicker during gesture (verify visually; ideally automated visual regression).
- During active pan/zoom: composition pass renders at `gestureDpr`; verified via render target inspection in profiler.
- After `idleFramesBeforeRestore` idle frames: composition restores `idleDpr`, single fullscreen pass repaints at full quality.
- DPR switching does not cause widget FBO repaints (decoupled from band hysteresis).

### Phase 6 — Eviction + Waking + Dormant protection

Implement LRU eviction in the pool when `currentBytes > maxBytes`. Eviction priority order:

1. **Cold (LRU)** — first to evict.
2. **Warm (LRU)** — second.
3. **Dormant (LRU)** — last resort. Evicting these defeats the "instant re-activation" guarantee, so log at debug level for memory-budget tuning.
4. **Hot** — never evicted.

`Cold → Waking` and `Dormant → Waking` transitions trigger a paint at next opportunity. Cull margin is widened in `cullSystem` if profiler shows first-frame stalls (currently 200 px overscan; may need 400+).

Acceptance:
- 1000-widget scene with 256 MB budget: pool stays under budget across panning across the full canvas.
- No visible stalls during pan (all unculling widgets either had texture or are visually identical to surrounding widgets for one frame).
- Cold widgets' state ticks paused (verified by external state subscriptions not firing while culled).
- Re-activating a Dormant widget (e.g., switching navigation frames back) shows the widget on the very next frame from the cached FBO — no Waking latency in the common case.
- Forced Dormant eviction (extreme memory pressure scenario) emits a debug log and Waking happens on re-activation.

### Phase 7 — Composition extras (drag-lift, selection chrome)

Move the drag-lift visual effect (currently scale + z lerp inside the widget) into the composition pass — the widget's FBO is sampled with a scaled, z-offset quad and a soft drop shadow shader. The widget's own scene no longer needs to know it's being dragged.

Optional: render the WebGL selection chrome (currently a separate pass in `react/webgl/SelectionRenderer.ts`) as composition quads in the same pass for fewer draw calls.

Acceptance:
- Drag-lift visually identical to current behaviour but drives zero widget repaints.
- `geometry-card.tsx`'s `useFrame` spring removed — widget code is purely declarative.

### Phase 8 — WebGPU renderer (opt-in)

Add `WebGPURenderer.ts` implementing `CompositorRenderer`. Auto-detect support; fall back to `WebGL2Renderer` if unavailable. Expose a prop on `<InfiniteCanvas>` for explicit override (`renderer="webgpu" | "webgl2" | "auto"`).

Initial wins to validate:
- Render bundles for Warm widget composition quads.
- Timestamp queries → populate `gpuPaintMs` / `gpuCompositeMs` in profiler.
- Compute-shader upsampler (FSR-lite) replaces bilinear in the > 1.5× zoom band.

Phase 8 is independently shippable after Phase 7 and can land as a separate RFC if it grows large. Recommend keeping it scoped to "renderer parity + bundles + timestamps" here, with FSR upsample as a follow-up.

---

## Open questions

1. **State-only ticking for off-pipeline widgets (both DOM and R3F).** Some widgets (live charts, timers, countdown indicators) need state to advance even when Culled or Dormant — and this applies to both DOM widgets and R3F widgets, not just the compositor. Default policy in this RFC pauses state ticks for any non-`Visible` widget.

    Deferred until a real use case lands. When it does, the tag should be generalised — something like `StateTickWhileOffscreen` (or `AlwaysTick`) — placed in the shared ECS components module rather than the R3F-specific module, so DOM widgets opt in the same way. Implementation is a single ECS system iterating `query(AlwaysTick, Culled | !Active)` and invoking whatever tick callback the widget registered.

2. **Memory budget defaulting.** 256 MB is a guess. Real default should be informed by Phase 0 baselines and target hardware. Likely to vary: maybe 128 MB on mobile, 512 MB on desktop, 1 GB on workstations. Expose as a `<InfiniteCanvas r3fMemoryBudget={...}>` prop with a sensible auto-detect default (`navigator.deviceMemory` × heuristic × effective memory signal). Settle in a follow-up once Phase 6 eviction lands and we have real telemetry.

3. **Eviction of Dormant FBOs — should we ever?** Current policy protects Dormant entries until Cold (LRU) and Warm (LRU) eviction fails to free enough. This means a very long-lived session with many navigation frames could OOM on the GPU. Alternatives: (a) time-based Dormant eviction (haven't been Active in > 5 min → eligible), (b) frame-count-based, (c) make the budget per-navigation-frame so switching frames forces bounded Dormant memory. Revisit when we see the first OOM report.

4. **Gesture DPR defaults across devices.** `gestureDpr: min(idleDpr, 1.0)` is a safe start. Retina Macs may want `gestureDpr = 1.5`; low-end Android may want `0.75`. Same auto-detect problem as the memory budget — defer to telemetry.

5. **Interaction with RFC-001's handle entities.** Resize handles are separate Hitbox child entities (RFC-001). They should *not* be R3F widgets (they're WebGL chrome, not user content) and therefore aren't subject to this compositor. Document the boundary clearly in Phase 3 — `WidgetStateMachine` only iterates entities with a `Widget` component *and* `surface === 'webgl'`.

---

## Acceptance criteria

**Phase 0 (benchmark)**
- [ ] Baseline frame-time and per-frame R3F counter records committed to `docs/perf-baselines/r3f-2026-04.md` for the 5 scenarios listed in Phase 0.

**Phase 1 (demand mode)**
- [ ] `R3FManager` uses `frameloop="demand"` with explicit `invalidate()` calls.
- [ ] Idle scene produces zero `R3FSample` records over a 10-second window.
- [ ] Drag scene produces frames only while the spring is settling.
- [ ] No regression in active-drag p95 frame time vs Phase 0 baseline.

**Phase 2 (profiler extensions)**
- [ ] `R3FSample` extended with `widgetsRepainted`, `fboBytes`, `phases`, optional GPU timestamps.
- [ ] Inspector panel shows per-widget phase histogram and paint sparkline.
- [ ] No behaviour change.

**Phase 3a (Culled tag — shared ECS primitive)**
- [ ] `Culled` tag defined in `src/ecs/components.ts`.
- [ ] `cullSystem` maintains the invariant: every Active entity has exactly one of `Visible` or `Culled` per tick.
- [ ] `serialization.ts` skip list updated.
- [ ] No existing behaviour changes; existing tests pass.
- [ ] No p95 regression in `cullSystem` duration at 1000 entities.

**Phase 3b (state machine, no FBO)**
- [ ] `R3FRenderState`, `R3FRenderBudget`, `R3FAnimationSignal` defined.
- [ ] `WidgetStateMachine` system updates phases from `Visible` / `Culled` / `Active` / `R3FAnimationSignal`.
- [ ] In a 19-Warm + 1-Hot scene, only the Hot widget's `useFrame` callbacks run.
- [ ] Removing `Active` transitions a widget to Dormant; re-adding returns to Warm (no repaint, no visual regression).
- [ ] No visual regression.

**Phase 4 (compositor end-to-end: FBOs + sharing + event routing)**
- [ ] Each Visible widget paints into its own `WebGLRenderTarget` on demand.
- [ ] Composition pass blits all visible widget FBOs by world AABB × camera.
- [ ] Pan triggers zero widget repaints.
- [ ] 19/1 scenario shows ≥ 90% reduction in active-drag GPU work vs Phase 0.
- [ ] `ResourceRegistry` shares geometries / materials / env maps per archetype; 100 widgets of one archetype use O(1) geometry memory.
- [ ] R3F user widget code (`onClick`, `onPointerOver`, `event.stopPropagation`, etc.) works unchanged against compositor output.
- [ ] Engine spatial index is the only widget-level hit-test path; R3F's default canvas raycaster never runs against the composition canvas.
- [ ] `onPointerMissed` fires on all visible widget scenes when empty canvas is clicked.

**Phase 5 (zoom hysteresis + dynamic DPR)**
- [ ] `ZoomBands` policy applied; widgets repaint at most once per band crossing per widget.
- [ ] Composition shader upsamples bilinear within tolerance.
- [ ] Active zoom gesture defers band-driven invalidations until idle.
- [ ] Composition pass uses `gestureDpr` during active pan/zoom and restores `idleDpr` after `idleFramesBeforeRestore` idle frames.
- [ ] DPR switching does not trigger widget FBO repaints.

**Phase 6 (eviction + waking + Dormant protection)**
- [ ] FBO pool stays under `R3FRenderBudget.maxBytes` across full-canvas pan.
- [ ] Eviction priority `Cold (LRU) → Warm (LRU) → Dormant (LRU) → Hot (never)`.
- [ ] Re-activating a Dormant widget shows it on the very next frame from cached FBO (no Waking latency in common case).
- [ ] Cold widgets' state ticks paused.
- [ ] No first-frame stalls visible during pan with default cull margin.
- [ ] Dormant eviction emits debug log entry.

**Phase 7 (composition extras)**
- [ ] Drag-lift driven by composition quads, not widget repaints.
- [ ] `geometry-card.tsx`'s spring `useFrame` removed; widget purely declarative.

**Phase 8 (WebGPU)**
- [ ] `WebGPURenderer` implements `CompositorRenderer` parity.
- [ ] Render bundles record Warm widget quads once per phase change.
- [ ] `gpuPaintMs` / `gpuCompositeMs` populated when available.
- [ ] Auto-fallback to WebGL2 when WebGPU unavailable.

---

## Dependencies and risks

**Depends on**
- `cullSystem` and `Visible` tag (already exists, `src/ecs/systems/cull.ts`).
- `Active` tag (already exists, used by `cullSystem`). Note: RFC-001 expands `Active`'s role for navigation frames; this RFC's Dormant phase relies on `Active` being mutable per navigation frame, which is already the case today.
- Engine `Camera` resource (exists).
- Profiler ring buffers (exist; needs Phase 2 extension).
- The `gesturing` flag on the camera resource (partially exists in touch path; Phase 5 extends to wheel/pan).

**Risks**
- **Three.js scene-per-widget memory cost.** Each widget's local scene + materials + geometries duplicates state. With 1000 idle widgets, this could be 100s of MB of CPU memory before any FBOs allocate. Mitigation: aggressive sharing of materials/geometries via a registry keyed by widget archetype. Validate in Phase 4.
- **First-frame stalls when un-culling during fast pan.** If pan velocity exceeds the cull margin's "warm-up" budget, users see one-frame-empty widgets. Mitigation: dynamic cull margin proportional to pan velocity; pre-emptive painting of Cold widgets in pan direction.
- **WebGPU adoption timing.** If the WebGPU renderer is gated on missing browser features (e.g., timestamp queries on Safari), Phase 8 may need to ship in halves: WebGPU-without-timestamps first.
- **R3F event raycaster bypass.** Phase 4 changes how pointer events resolve to widgets. Risk of subtle regressions in widget interaction. Mitigation: comprehensive interaction test suite added in Phase 4 covering hover, drag, resize, multi-select against compositor output.

---

## Revision notes

**v1** — initial draft, 2026-04-22. Builds on conversation about per-widget paint caching, virtual texture compositors, and the trade-offs between the simpler two-canvas approach (Alt B) and the full compositor.

**v1 → v2** (same-day revision after design walkthrough)

Resolutions of v1 Open Questions (now in proposal):
- **Q1 (state-only ticking)**: kept open, scope explicitly deferred until a real use case lands.
- **Q2 (multi-canvas)**: resolved — multi-canvas rejected with explicit performance analysis added to Alt B. Single canvas with one composition pass is the chosen architecture.
- **Q3 (DPR during gestures)**: resolved into proposal as [§ Dynamic DPR during gestures](#dynamic-dpr-during-gestures). Promoted from "maybe in Phase 5" to a defined `CompositionDprPolicy` shipped in Phase 5.
- **Q4 (`Active` interaction)**: resolved — non-Active widgets enter a new explicit **Dormant** phase. State machine grew from 4 phases to 5; eviction priority places Dormant last so re-activation is instant.
- **Q5 (memory budget defaulting)**: kept open, refined.
- **Q6 (Three.js shared state)**: resolved into proposal as [§ Three.js resource sharing](#threejs-resource-sharing). Archetype-keyed `ResourceRegistry` shares geometries / materials / textures / env maps.
- **Q7 (R3F event handling)**: resolved into proposal as [§ Pointer event routing](#pointer-event-routing). Engine spatial index → widget → widget-scoped raycaster → R3F event dispatch. Zero friction at widget implementation level — user `onClick` / `onPointerOver` / `event.stopPropagation` etc. all work normally.
- **Q8 (publish as separate package)**: resolved — keep internal to `infinite-canvas`.

New ECS addition:
- **`Culled` tag** — promoted from "implicit !Visible" to explicit ECS tag, applies to both DOM and R3F widgets. `cullSystem` now maintains the invariant that every Active entity has exactly one of `Visible` or `Culled`. Phase 3 split into 3a (Culled tag landing) and 3b (R3F state machine consuming it).

New Open Questions added in v2 and their status after follow-up review:
- Eviction policy for very long-lived Dormant entries (3) — **deferred to future**, revisit on first real OOM.
- Per-device gesture DPR defaults (4) — **deferred**, wait for telemetry.
- Boundary with RFC-001 handle entities (5) — **acknowledged**, will document explicitly in Phase 3 wiring.
- `onPointerMissed` semantics (originally v2 Q6) — **resolved into proposal**: fan out to all Visible widget scenes simultaneously; Dormant / Culled widgets don't receive it.
- v2 Q1 generalised: state-only ticking applies to both DOM and R3F, so the eventual tag belongs in the shared ECS module (not R3F-specific). Deferred.
