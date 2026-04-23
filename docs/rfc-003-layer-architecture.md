# RFC-003: Layer Architecture & Drag-Promote

- **Status**: Implemented v3
- **Author**: James Yong
- **Date**: 2026-04-23
- **Area**: Rendering / ECS / Interaction
- **Related**: RFC-002 (R3F Virtual-Texture Compositor) — extends the
  compositor with a clipping uniform and `renderOrder` bump for the
  dragged widget; relies on the per-widget render-target pipeline.
- **Supersedes**: RFC-003 v2 (resolves Open Questions); v3 records the
  Card-as-single-source-of-truth refinement that emerged from playground
  testing (R3F card chrome must NOT promote — see "Revision notes")

---

## Summary

Make the dragged widget — DOM or R3F — visually sit on top of every
other widget for the duration of the drag, without breaking pointer
capture, selection chrome, or the existing layer sandwich.

This is achieved with two cooperating mechanisms:

1. **An ECS `Layer` component + a small fixed set of named DOM stacking
   layers** (`background`, `base`, `overlay`). InfiniteCanvas mounts one
   DOM container per layer; each widget renders into the container that
   matches its `Layer.name`. Default is `'base'`. A `DragPromoteSystem`
   flips the dragged widget's `Layer.name` to `'overlay'` while
   `Dragging` is set, then restores it on release.

2. **The R3F compositor learns about the dragged widget**: its quad
   gets `renderOrder = 99` (drawn last in the composition pass), and
   every other widget's quad fragment shader discards fragments that
   fall inside the dragged widget's screen rect — so promoted CSS
   chrome behind the R3F canvas is no longer occluded by other R3F
   widgets that overlap.

Together these handle three cases:

- **Case A — dragged DOM widget**: the layer flip is sufficient. The
  widget moves from `'base'` (zIndex 0, behind the R3F canvas) to
  `'overlay'` (zIndex 2, above it). Pure DOM, zero compositor work.
- **Case B — dragged R3F widget *with* CSS chrome**: layer flip
  promotes the widget's `<CardChrome>` slot to `'overlay'` (now above
  the R3F canvas); compositor's clipping discards other R3F fragments
  inside the chrome's rect (so the promoted chrome is not visually
  obscured); the widget's own R3F content renders last (`renderOrder`
  bump) so its 3D content paints over the dragged chrome and over any
  other R3F widget behind it.
- **Case C — dragged R3F widget *without* chrome** (e.g.
  `chrome: 'none'` widgets like `FloatingCubeWidget`): no chrome to
  defend, no clipping needed; the `renderOrder` bump alone makes the
  dragged widget's quad draw last in the composition, on top of any
  other R3F widget it overlaps.

Out of scope: arbitrary per-widget z interleaving across layers (browser
compositors composite per-stacking-context, so this would require
multiple R3F canvases or moving DOM into WebGL — both rejected). The
RFC instead formalises the realistic Figma / iOS Home Screen model:
small set of named layers, full per-widget z within each.

---

## Motivation

### Current state

Today's stacking sandwich (top → bottom):

```
zIndex: 50    Toolbars / panels                         (app chrome)
zIndex: 3     WebGL chrome (selection + handles)
zIndex: 2     —
zIndex: 1     R3F compositor canvas
zIndex: auto  Camera transform layer (DOM widgets +
              R3F card chrome via SelectionOverlaySlot)
zIndex: auto  WebGL grid canvas
zIndex: auto  Container background
              ↓
              Container (interaction capture)
```

The R3F canvas at `zIndex: 1` paints over **every** DOM widget in the
camera transform layer. The chrome unification landed in
`d776deb..7bca8b6` exploits this: card chrome is in the camera transform
layer (behind R3F), and R3F's transparent pixels (everywhere except the
3D content) reveal the chrome below. This works perfectly *until* the
user wants a widget to sit above another for affordance reasons —
specifically during drag.

Concrete failure modes today:

- Drag a DOM widget over another DOM widget — fine, both DOM (z=auto +
  `ZIndex` per widget). But drag a DOM widget under a stack of R3F
  widgets — the R3F canvas always paints on top, the DOM widget can
  visually disappear behind the R3F bands. Bad affordance.
- Drag an R3F widget over another R3F widget — both quads are sampled
  in the same composition pass with the same `renderOrder`; sort order
  is undefined under transparent depthWrite=false (already mitigated
  for shadow / quad pairs in `aabb290`, but ambiguous between two card
  quads). Adjacent dragged R3F card content can flicker behind a
  neighbour during the lift.
- The R3F card chrome lives at zIndex < 1; when an R3F widget is
  dragged its chrome is still "below" every other R3F widget in the
  composition. Other R3F widgets passing through the dragged card's
  screen rect paint over the dragged chrome. Visually obvious.

### Why fix it now

The chrome refactor (RFC-002 follow-up) made these issues much more
visible because the chrome is a real DOM rectangle behind R3F. Before
the refactor, the R3F card body was a mesh inside the FBO at the same
depth as the user content, so other R3F content overlapping the card
naturally won by depth-sort. After the refactor, the card body is in a
different stacking context entirely — the asymmetry is now exposed.

Promoting the dragged widget to a higher layer + clipping other R3F
content out of the dragged rect closes the affordance gap with one
small, ECS-native mechanism that scales beyond drag (tooltips, modals,
context menus, future affordances all opt into `'overlay'` the same
way).

### What this RFC is **not**

- Not arbitrary per-widget z interleaving across DOM and R3F. The
  browser composites per-stacking-context; one widget can only live in
  one stacking context at a time. Achieving "any widget above any
  widget" per-pixel would require either multiple R3F canvases (one per
  z band) or rendering DOM through WebGL — both rejected as
  out-of-scope.
- Not a replacement for `ZIndex`. The existing per-widget `ZIndex`
  component continues to control intra-layer ordering. `Layer.name`
  picks the container; `ZIndex` orders within it.
- Not a multi-select drag scheme. The codebase has no multi-select; a
  single dragged widget is the only case the compositor's clipping
  uniform needs to handle. If multi-select arrives later, the simplest
  extension is "promote the bounding box," but that's deferred.

---

## Proposal

### Layer set

Three named layers, ordered low → high in the DOM stacking context:

```
'background'   zIndex 0  — DOM widgets behind everything user-content
'base'         zIndex 0  — default for all DOM widgets and R3F card chrome
'overlay'      zIndex 2  — promoted widgets (drag-over-R3F, future tooltips)
```

`'background'` and `'base'` share zIndex 0 because both sit beneath the
R3F canvas (zIndex 1); their relative order is established by source
order in the DOM (background first, base second), not by an explicit
zIndex value. This avoids creating two separate stacking contexts that
would compete for `ZIndex` ordering of widgets.

The R3F canvas (zIndex 1) sits between `'base'` and `'overlay'`.

WebGL chrome (zIndex 3) and toolbars (zIndex 50) stay above everything;
selection outlines always visible. Future `'tooltip'` layer at zIndex 4
would slot above WebGL chrome — not part of this RFC.

### Complete stacking — final state

```
zIndex 50  Toolbars / panels                  (app)
zIndex 3   WebGL chrome (selection + handles) (WebGLManager)
zIndex 2   'overlay' DOM container            (DragPromote target)
zIndex 1   R3F compositor canvas              (Compositor)
zIndex 0   'base' DOM container               (default)
zIndex 0   'background' DOM container         (background widgets)
zIndex 0   WebGL grid canvas                  (WebGLManager)
zIndex 0   Container background               (solid bg)
           ↓
           Container (interaction capture)    (root <div>)
```

### New ECS components / resources

#### `Layer`

```typescript
export type LayerName = 'background' | 'base' | 'overlay';

interface LayerData {
  /** Which DOM container this widget renders into. */
  name: LayerName;
}

export const Layer = defineComponent<LayerData>('Layer', { name: 'base' });
```

Every widget that wants explicit layering opts in. Widgets without a
`Layer` component default to `'base'` — preserves current behaviour for
existing apps without migration.

#### `LayerOrderResource`

```typescript
interface LayerOrderData {
  /**
   * Layer names in stacking order, low → high. Apps may extend with
   * custom layer names if their InfiniteCanvas mount renders matching
   * containers, but the default set is sufficient for the standard use
   * case and is what InfiniteCanvas mounts out of the box.
   */
  layers: LayerName[];
}

export const LayerOrderResource = defineResource<LayerOrderData>('LayerOrder', {
  layers: ['background', 'base', 'overlay'],
});
```

Resource rather than constant so future overlays (`'tooltip'`,
`'modal'`) are pluggable from outside the engine.

#### `PreDragLayer` (sidecar, internal to `DragPromoteSystem`)

```typescript
interface PreDragLayerData {
  name: LayerName;
}

export const PreDragLayer = defineComponent<PreDragLayerData>('PreDragLayer', {
  name: 'base',
});
```

Stores the widget's pre-drag `Layer.name` so `DragPromoteSystem` can
restore it on `Dragging` removal. Removed when the drag ends.
Serialization: skipped (runtime-only).

### `DragPromoteSystem`

Runs after `cullSystem`. Watches `onTagAdded(Dragging)` and
`onTagRemoved(Dragging)`:

```typescript
function dragPromoteSystem(world: World): void {
  // Reactive: handled via onTagAdded / onTagRemoved listeners
  // registered once at engine init. Pseudocode for clarity:

  for (const entity of world.justAdded(Dragging)) {
    const current = world.getComponent(entity, Layer);
    const prev = current?.name ?? 'base';
    world.addComponent(entity, PreDragLayer, { name: prev });
    world.setComponent(entity, Layer, { name: 'overlay' });
  }

  for (const entity of world.justRemoved(Dragging)) {
    const stash = world.getComponent(entity, PreDragLayer);
    if (stash) {
      world.setComponent(entity, Layer, { name: stash.name });
      world.removeComponent(entity, PreDragLayer);
    }
  }
}
```

Idempotent: re-adding `Dragging` while already promoted is a no-op
because `PreDragLayer` already captures the original (we don't overwrite
it with the current promoted value). Re-removing without `PreDragLayer`
is a no-op.

### `InfiniteCanvas` render layout

Replace the single camera-transform layer with three:

```tsx
<container>
  <BackgroundLayerContainer ref={cameraLayerRef}>
    {backgroundEntities.map(WidgetSlot | SelectionOverlaySlot)}
  </BackgroundLayerContainer>
  <BaseLayerContainer ref={cameraLayerRef}>
    {baseEntities.map(WidgetSlot | SelectionOverlaySlot)}
  </BaseLayerContainer>

  <WebGLGridCanvas zIndex={0} />
  <R3FCanvas zIndex={1} />

  <OverlayLayerContainer ref={cameraLayerRef} zIndex={2}>
    {overlayEntities.map(WidgetSlot | SelectionOverlaySlot)}
  </OverlayLayerContainer>

  <SelectionChromeWebGL zIndex={3} />
  {/* toolbars at zIndex 50 — owned by the app */}
</container>
```

Each container shares the **same** `cameraLayerRef` so the existing
camera transform (`translate3d` driven by `engine.getCamera()`) applies
uniformly. The bucket logic in `InfiniteCanvas` (currently splits by
`Widget.surface`) extends to also split by `Layer.name`:

```typescript
const buckets: Record<LayerName, EntityId[]> = {
  background: [],
  base: [],
  overlay: [],
};
for (const id of visibleEntities) {
  const layer = engine.get(id, Layer)?.name ?? 'base';
  buckets[layer].push(id);
}
```

The `slotRefs` Map (used by the rAF batch updater to set transforms /
sizes) is unchanged — slot elements register themselves regardless of
which container mounts them. The batch updater iterates the Map; the
DOM tree shape doesn't matter.

R3F widgets always render through the R3F canvas regardless of layer —
their `Layer.name` only determines where their `SelectionOverlaySlot`
(card chrome + interaction surface) mounts. So a dragged R3F widget's
chrome moves to the overlay container while its 3D content stays in the
R3F canvas (and gets a `renderOrder` bump in the compositor — see
below).

### Compositor changes

Switch the R3F composition material from `MeshBasicMaterial` back to a
minimal custom `ShaderMaterial`. The composition pass is already
"sample sRGB-encoded FBO texel and write it to the sRGB backbuffer
unchanged" — we explicitly do *not* want Three's tone-mapping pipeline
to touch these pixels (RFC-002 § sRGB FBO fix). A tiny shader is
cleaner than `onBeforeCompile`-style chunk injection, has no caching
hazards, and isn't coupled to Three's internal shader chunk names.

Two uniforms on the new material:

- `uDraggedRect: vec4` — screen-space pixel coords of the dragged R3F
  widget's AABB, expressed as `(minX, minY, maxX, maxY)` in
  `gl_FragCoord` space (origin bottom-left, in physical pixels). Set to
  `(0, 0, 0, 0)` when no R3F widget is being dragged.
- `uIsDragged: float` — 1.0 if this quad's widget is the dragged one,
  0.0 otherwise.

Full composition shader (replaces the `MeshBasicMaterial` set in the
Compositor's `register`):

```glsl
// vertex
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// fragment
uniform sampler2D map;
uniform vec4 uDraggedRect; // (minX, minY, maxX, maxY) in gl_FragCoord px
uniform float uIsDragged;
varying vec2 vUv;
void main() {
  if (uIsDragged < 0.5) {
    vec2 sp = gl_FragCoord.xy;
    if (sp.x >= uDraggedRect.x && sp.x <= uDraggedRect.z &&
        sp.y >= uDraggedRect.y && sp.y <= uDraggedRect.w) {
      discard;
    }
  }
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.001) discard;
  gl_FragColor = c;
}
```

When `uDraggedRect = (0,0,0,0)` the test is `sp.x >= 0 && sp.x <= 0` —
false for any pixel — so the discard is a no-op. No branch cost in the
common case.

The material is `transparent: true`, `depthWrite: false`. The texture's
sRGB encoding (set on the FBO per RFC-002 § sRGB FBO fix) means the
sampled `c` is already in sRGB space, ready to write to the sRGB
backbuffer — no tone mapping or output encoding needed.

Compositor `useFrame` per-frame work:

```typescript
const draggedR3F = findFirstDraggedR3FWidget(world); // null if none
const r3fCanvasHeight = size.height * dpr;
let draggedRect = ZERO_RECT;
let draggedEntityId: EntityId | null = null;

if (draggedR3F) {
  const wb = world.getComponent(draggedR3F, WorldBounds);
  if (wb) {
    // Apply drag-lift scale to the rect so the chrome at scale 1.05x
    // is correctly defended by the discard region.
    const lift = liftScaleRef.current.get(draggedR3F) ?? 1;
    const cx = wb.worldX + wb.worldWidth / 2;
    const cy = wb.worldY + wb.worldHeight / 2;
    const halfW = (wb.worldWidth * lift) / 2;
    const halfH = (wb.worldHeight * lift) / 2;
    const minWx = cx - halfW;
    const maxWx = cx + halfW;
    const minWy = cy - halfH;
    const maxWy = cy + halfH;
    // World → screen pixels (gl_FragCoord is bottom-up, in physical px)
    const sxMin = (minWx - cam.x) * cam.zoom * dpr;
    const sxMax = (maxWx - cam.x) * cam.zoom * dpr;
    const syTop = (minWy - cam.y) * cam.zoom * dpr;
    const syBot = (maxWy - cam.y) * cam.zoom * dpr;
    draggedRect = [
      sxMin,
      r3fCanvasHeight - syBot, // gl_FragCoord y is bottom-up
      sxMax,
      r3fCanvasHeight - syTop,
    ];
    draggedEntityId = draggedR3F;
  }
}

for (const [entityId, mesh] of quadsRef.current) {
  const material = mesh.material as MeshBasicMaterial;
  // Set uniforms on the shader instance attached to this material.
  setUniform(material, 'uDraggedRect', draggedRect);
  setUniform(material, 'uIsDragged', entityId === draggedEntityId ? 1 : 0);
  mesh.renderOrder = entityId === draggedEntityId ? 99 : 1;
}
```

`renderOrder = 99` on the dragged widget's quad ensures Three's
internal sort places it last in the composition pass, drawing on top of
all other R3F quads.

### Putting it together

Drag-start sequence (R3F widget with chrome):

1. Engine adds `Dragging`.
2. `DragPromoteSystem` stashes the widget's previous `Layer.name` in
   `PreDragLayer` and sets `Layer.name = 'overlay'`.
3. `InfiniteCanvas` re-buckets: the widget's `SelectionOverlaySlot`
   (and its `<CardChrome>` child) re-mounts under the overlay
   container at zIndex 2 — now visually above the R3F canvas.
4. Compositor's `useFrame` detects the `Dragging` tag, sets
   `uDraggedRect` to the widget's lifted screen AABB, sets
   `uIsDragged = 1` on this quad / `0` on others, sets
   `renderOrder = 99` on this quad.
5. Other R3F widgets' quads discard fragments inside the rect — the
   promoted chrome shows through there.
6. Dragged widget's own quad renders last with no discard, on top of
   everything in the R3F canvas.

Drag-end sequence:

1. Engine removes `Dragging`.
2. `DragPromoteSystem` restores `Layer.name` from `PreDragLayer`,
   removes `PreDragLayer`.
3. `InfiniteCanvas` re-buckets: widget's overlay slot demotes back to
   `'base'`.
4. Compositor zeroes uniforms; quad's `renderOrder` returns to 1.
5. CSS lift transition reverses naturally (chrome `transform: scale(1)`
   over 180ms cubic-bezier).

DOM widget drag (case A) skips steps 4–5 entirely — the layer flip
alone is sufficient because the DOM widget at zIndex 2 already wins
against the R3F canvas at zIndex 1.

R3F widget without chrome (case C) skips the discard's visual purpose
(no chrome to defend) but still benefits from the `renderOrder` bump so
the dragged widget's content draws on top of any other R3F widget it
visually overlaps.

---

## Alternatives considered

### Alt A: per-widget z sort across all layers (no fixed layers)

Single global render order; each widget has a z value; the renderer
ensures pixel-correct interleaving DOM ↔ R3F.

- **Pro**: maximally flexible, matches user mental model.
- **Con**: requires either rendering DOM through WebGL (loses
  accessibility, text rendering, scroll, etc.) or one R3F canvas per z
  band (browser context limits, 4× perf overhead per canvas, GPU memory
  duplication). Both rejected.

### Alt B: hide other R3F widgets entirely while dragging

When any R3F widget is dragged, set every other R3F widget's quad to
`mesh.visible = false`.

- **Pro**: simpler than the discard uniform.
- **Con**: massive visual regression — non-overlapping R3F widgets
  vanish during drag. Unacceptable.

### Alt C: render dragged R3F widget into a SECOND canvas

Mount a tiny second R3F canvas just for the dragged widget; place it at
zIndex 2.

- **Pro**: no shader changes; dragged widget renders to its own
  framebuffer, naturally above DOM at zIndex 2.
- **Con**: per-drag context creation / destruction is expensive (each
  `<canvas>` is a fresh GL context); resource sharing across contexts
  is impossible (geometries / materials / FBOs would have to be
  re-allocated for the dragged widget); two compositor render loops to
  coordinate. The discard-uniform approach gets the same visual result
  in one canvas with ~4 lines of GLSL.

### Alt D: dynamic stacking-context reorder via React tree

On `Dragging` add, move the widget's slot React element to a different
parent (the overlay container) without changing any `Layer` ECS state
— derive the container choice purely from `useTag(entityId, Dragging)`.

- **Pro**: avoids a new ECS component (`Layer`).
- **Con**: only handles drag promotion, no extension path for
  tooltips, modals, future affordances. Couples the rendering layout
  decision to interaction state in the React tree rather than ECS data.
  Rejected because the layer abstraction is independently valuable
  (e.g., grid widgets in `'background'`, future popovers in
  `'overlay'`).

---

## Migration path

### Phase 1 — `Layer` component + `LayerOrderResource` + serialization

Define both types. No render changes. `PreDragLayer` defined too.
`serialization.ts` skip lists updated for `PreDragLayer`. Acceptance:
existing tests pass; new tests cover the default `'base'` value and the
serialization round-trip.

### Phase 2 — `InfiniteCanvas` mounts three containers; widgets bucket by `Layer`

`background` and `overlay` containers added; bucket logic in
`InfiniteCanvas` extended. Widgets without `Layer` default to `'base'`.
No widget visibly moves because nothing yet sets `Layer.name` other
than the default.

Acceptance:
- All current widgets render in `'base'` — visually identical to
  pre-RFC.
- A widget with `Layer.name = 'background'` renders behind all `'base'`
  widgets and behind the WebGL grid.
- A widget with `Layer.name = 'overlay'` renders above the R3F canvas
  and above all `'base'` widgets.
- Camera transform (pan / zoom) applies uniformly to all three layers.
- Pointer events still reach the engine through every layer's
  `WidgetSlot` / `SelectionOverlaySlot`.

### Phase 3 — `DragPromoteSystem`

Reactive system wired via `world.onTagAdded(Dragging)` and
`world.onTagRemoved(Dragging)` at engine init. Idempotent restore via
`PreDragLayer` sidecar.

Acceptance:
- DOM widget drag: widget's slot re-mounts into the overlay container
  on `Dragging` add; back to `'base'` on remove. Visually now appears
  above the R3F canvas during drag (case A done).
- R3F widget drag: chrome re-mounts into overlay container too — chrome
  now visible above the R3F canvas.
- Chrome's `<CardChrome>` continues to read `Dragging` and apply CSS
  lift transition. No double-promotion: re-adding `Dragging` while
  promoted doesn't overwrite `PreDragLayer`.

### Phase 4 — Compositor `uDraggedRect` + `renderOrder` bump

Replace `MeshBasicMaterial` with a minimal custom `ShaderMaterial`
(see § Compositor changes for the full shader). The composition pass
samples already-sRGB-encoded FBO texels and writes them to an sRGB
backbuffer unchanged — no tone mapping needed, so the bespoke shader
loses nothing vs `MeshBasicMaterial` and avoids `onBeforeCompile`
chunk-injection hazards.

Compositor's `useFrame` computes the dragged screen rect each frame,
sets uniforms, sets `renderOrder`. Self-sustain loop already invalidates
while `Dragging` propagates through Hot phase, so no extra invalidation
wiring is needed.

Acceptance:
- R3F widget A with chrome dragged across R3F widgets B and C: B and C
  no longer paint over A's chrome inside A's bounds. (Case B done.)
- R3F widget without chrome (FloatingCube) dragged across other R3F
  widgets: dragged widget's quad renders on top regardless of overlap.
  (Case C done.)
- No R3F widget being dragged: `uDraggedRect = (0,0,0,0)`,
  `uIsDragged = 0` everywhere; discard is a no-op; visual output is
  byte-identical to current.
- The discard rect correctly accounts for the dragged widget's lift
  scale (1.05× during drag) — the chrome's enlarged bounds are fully
  defended.

---

## Open questions

1. **WebGL chrome vs `'overlay'` layer ordering**. WebGL chrome is at
   zIndex 3, overlay layer at zIndex 2. So a tooltip (future) in
   `'overlay'` would render *behind* selection outlines. Probably
   correct (selection should always be visible — Figma convention), but
   flagging for awareness. Adding a `'tooltip'` layer at zIndex 4 later
   is the natural extension.

2. **`Layer` for `'webgl'` chrome / engine-drawn elements**. Right now
   the WebGL grid + selection chrome are not ECS entities — they're
   rendered by `WebGLManager` directly. They sit at fixed zIndex
   positions outside the `Layer` system. If we ever want to move them
   into the layer system (e.g., user-controlled grid layer), they'd
   become entities with their own `Layer.name`. Out of scope.

3. **Pointer event capture during promotion** *(verify in Phase 3,
   contingency identified)*. The chrome's slot re-mounts into the
   overlay container, but pointer capture is set on
   `containerRef.current` (the root canvas div, not the slot), so the
   re-mount cannot break capture in principle. Two scenarios to
   exercise during Phase 3 acceptance: (a) drag a widget rapidly
   immediately after pointerdown — no frame drops, no lost moves;
   (b) drag, release, drag again — capture resets cleanly. **Fallback
   if these regress**: don't re-parent the DOM node; instead apply
   `style.zIndex` to the slot in place. Trades sibling-ordering
   guarantees for capture continuity. Default plan stays with
   container re-mount; only switch on observed failure.

---

## Acceptance criteria

**Phase 1 (Layer component + resource)**
- [x] `Layer`, `LayerOrderResource`, `PreDragLayer` defined.
- [x] Default `Layer.name = 'base'` on every widget that doesn't
      explicitly set it.
- [x] Serialization skip list updated for `PreDragLayer`.
- [x] No existing tests regress.

**Phase 2 (three DOM containers)**
- [x] InfiniteCanvas renders one container per layer name.
- [x] All current widgets visually identical (everything still in
      `'base'`).
- [x] Camera transform applies uniformly.
- [x] Pointer events route through every layer's slot to the engine.

**Phase 3 (DragPromoteSystem)** *(refined per v3)*
- [x] Adding `Dragging` to a Card-bearing DOM widget flips
      `Layer.name` to `'overlay'`; removing restores via `PreDragLayer`.
- [x] Promotion is gated on the `Card` ECS component — bare DOM
      widgets without `Card` are not card-shaped affordances and do
      not promote.
- [x] Promotion is gated on `Widget.surface !== 'webgl'` — R3F card
      chrome stays in 'base' (its opaque background would otherwise
      occlude its own 3D content if hoisted above the R3F canvas).
- [x] Idempotent: re-adding `Dragging` while promoted preserves the
      original `PreDragLayer` value.
- [x] DOM card visually pops above R3F canvas during drag (case A).

**Phase 4 (compositor uniforms)**
- [x] `uDraggedRect` + `uIsDragged` uniforms wired into composition
      material (custom `CompositionMaterial` `ShaderMaterial`).
- [x] Dragged R3F widget's quad gets `renderOrder = 99`; restored to
      `1` on drop. Applies to ALL dragged R3F widgets (with or without
      Card) so card-less widgets stack on top of overlapping R3F
      content (case C).
- [x] Other R3F widgets' fragments inside dragged rect are discarded —
      chrome visible there (case B closed). Discard rect computation
      is gated on `Card` so card-less widgets don't clip neighbours.
- [x] R3F widget without chrome dragged on top of overlapping R3F
      widget paints above it via `renderOrder` alone (case C closed).
- [x] No regression when no widget is being dragged
      (`uDraggedRect = ZERO_RECT` is a no-op).
- [x] Discard rect correctly accounts for lift scale (1.05×) via
      `liftScaleRef`.

---

## Dependencies and risks

**Depends on**
- `Dragging` tag (already exists, `src/ecs/components.ts`).
- `ZIndex` component (exists; intra-layer ordering unchanged).
- RFC-002 compositor + composition material (exists).
- `world.onTagAdded` / `onTagRemoved` reactive event API (exists, used
  by `interaction-role-sync.ts`).

**Risks**
- **Re-mount cost on drag start/end**: moving a slot between DOM
  containers triggers a React unmount + remount of `WidgetSlot` /
  `SelectionOverlaySlot`. Per-drag (one widget) this is cheap, but if
  the slot's mount effect is non-trivial (e.g., re-allocating heavy
  state), perceived drag-start latency could spike. Mitigation: keep
  slot mount lean (already true today); measure in Phase 3.
- **Pointer capture during re-mount**: pointer capture is on the root
  container, not the slot div, so re-mounting the slot can't break
  capture. But `WidgetSlot`'s `onPointerDown` runs `setPointerCapture`
  on its own ref — by the time `Dragging` is added the pointer event
  has already returned, so this race shouldn't manifest. Verify
  carefully in Phase 3.
- **One material instance per widget**: each composition quad currently
  has its own `MeshBasicMaterial`; the new `ShaderMaterial` pattern
  preserves that (uniforms must be per-instance). Three.js compiles the
  shader once and reuses the program across instances since they share
  defines / vertexShader / fragmentShader strings — no shader cache
  thrash. Confirm in Phase 4 by checking `renderer.info.programs.length`
  stays at 1 for the composition shader regardless of widget count.
- **`uDraggedRect` lift scale tracking**: the compositor's
  `liftScaleRef` is the source of truth for the dragged quad's
  effective scale. The discard rect must read the same value or the
  rect will lag behind / lead the lift, producing a visible "halo" of
  other R3F content peeking around the chrome edges during the
  transition. Mitigation: read `liftScaleRef.current.get(eid)` in the
  same useFrame body.

---

## Revision notes

**v1** — initial draft, 2026-04-23. Builds on the design discussion
that established three layers (`background`, `base`, `overlay`), one
`DragPromoteSystem`, and compositor-side discard + renderOrder bump as
the minimal changes needed to put the dragged widget visually on top.

**v1 → v2** (same-day revision after walking through the open
questions)

Resolutions of v1 Open Questions:
- **Q1 (`onBeforeCompile` vs custom `ShaderMaterial`)**: resolved into
  proposal as **custom `ShaderMaterial`**. Composition is "sample
  sRGB-encoded FBO and write unchanged" — no tone mapping needed, so
  the bespoke shader loses nothing and avoids `onBeforeCompile`
  chunk-injection hazards. Full shader source now in § Compositor
  changes. Risks block updated to call out per-instance materials with
  shared compiled program (verify via `renderer.info.programs`).
- **Q4 (pointer capture during promotion)**: kept open but tightened —
  added contingency (`style.zIndex` in place instead of re-parent) if
  Phase 3 testing reveals capture / drag-continuity issues. Default
  plan stays with container re-mount.
- **Q5 (custom user layers)**: resolved by deferral. v1 documented
  `LayerOrderResource` exposure as "could in principle" — v2 commits
  to: three hardcoded containers in `InfiniteCanvas`,
  `LayerOrderResource` retained for systems to read from (so
  `DragPromoteSystem` doesn't hard-code `'overlay'` as a string), no
  custom-layer API surface in v1. Add `layerContainers` prop later if
  someone files an issue.

Q2 (WebGL chrome zIndex 3 vs overlay zIndex 2) and Q3 (engine-drawn
elements outside Layer system) remain documented as intentionally
unresolved — they call out architectural decisions that are correct
as-is and don't need follow-up.

**v2 → v3** (post-implementation refinement)

Two important deviations from the v2 design surfaced during playground
testing and are now baked into the implementation. Updating the RFC
to match.

1. **Card is the single source of truth for card-shaped behaviour.**
   v2 carried a parallel `R3FChromeConfig` on the R3F widget binding
   to declare chrome (`'card' | 'none' | { background, radius }`).
   In practice this duplicated information that the `Card` ECS
   component already carried for DOM cards. v3 collapses both into
   the `Card` component:

     - Presence of `Card` opts a widget into the full bundle: DOM
       `<CardChrome>`, CSS lift transition on `Dragging`,
       drag-promote (DOM-only), and compositor `uDraggedRect` discard
       (R3F-only).
     - Absence of `Card` opts out of all of it — bare debug-style
       widget with no chrome and no card-shaped affordances.
     - `Card.background: string` field carries the chrome's
       background colour so `<CardChrome>` reads it directly.

   `R3FChromeConfig`, `R3FWidget.chrome`, and the chrome plumbing
   through `ResolvedWidget` / `WidgetProvider` /
   `SelectionOverlaySlot.resolveChrome` are deleted.
   `createGeometryCardWidget` exposes `background?: string` (forwarded
   to `Card`) and `withCard?: boolean` (skips `Card` entirely for
   bare 3D widgets).

2. **R3F card chrome must NOT promote to the overlay layer.** v2's
   Phase 3 acceptance criterion said R3F chrome should promote during
   drag (so the chrome would "pop above the R3F canvas"). In practice
   this puts the chrome's opaque background fill above the R3F canvas,
   which then occludes the dragged widget's own 3D content. The
   correct design: R3F cards stay in `'base'` for the entire drag and
   rely on the compositor's `uDraggedRect` clip + `renderOrder` bump
   to defend their visual stacking. `dragPromoteSystem` now has two
   guards: skip if no `Card`; skip if `Widget.surface === 'webgl'`.

3. **`FrameChanges.layersChanged` re-bucket signal.** A small
   discovery during Phase 3 wiring: the React bucket memo only
   re-runs when `visibleEntities` changes, which in turn only changes
   on entered/exited. A `Layer` component flip without entry/exit
   would have been a silent no-op. The engine now emits
   `layersChanged: boolean` on `FrameChanges` from
   `world.queryChanged(Layer).length > 0`, and the rAF loop's
   `setVisibleEntities` trigger extends to include it. One source of
   truth for "did any entity's Layer flip" — generalises naturally
   for future re-bucket triggers.

4. **`LayerContainer.zIndex` via direct DOM write, not React style.**
   Initial implementation used `style={{ zIndex }}`, which React
   reconciliation overwrote on every commit, wiping the rAF loop's
   `style.transform` writes on the same element. v3 applies `zIndex`
   via a one-shot `useEffect` that writes `style.zIndex` directly,
   leaving React out of the style attribute. Documented in the
   `LayerContainer` component's comment.

All v2 acceptance criteria now check; v3 ones are in the updated
"Acceptance criteria" section above.
