# RFC-001: ECS-Native Hitbox, Interaction Role & Cursor System

- **Status**: Draft v2
- **Author**: James Yong
- **Date**: 2026-04-11
- **Area**: Engine / Interaction Layer
- **Supersedes**: RFC-001 v1 (2026-04-11, same day — v1 had factual errors about the current rendering path and several design gaps; see "Revision notes" at the end)

---

## Summary

Replace the current ad-hoc, imperative hit test system (two separate code paths, scattered magic numbers, phantom geometry recomputed on every pointer event) with a unified **Hitbox component** and **InteractionRole component**. Every interactable region — entity body, resize handle, future rotation handle, anchor point, connection port — is discoverable through the same spatial index, prioritised by a `layer` field on `InteractionRole`, and dispatched through a single `switch` on `InteractionRole.role.type`.

In the same pass, introduce a **`CursorHint` component** on each interactable entity and a **`cursorSystem`** that derives the current cursor each tick from input state + hovered entity and writes it to a `CursorResource`. The React render loop applies a single `style.cursor` on the root container — no cursor CSS lives on individual DOM elements.

This RFC can be landed in phases. Phases 1–5 (constants + unified hit test) are independently valuable and can ship first. Phases 6–7 (CursorHint + cursorSystem) introduce a new feature — cursor affordances — and are effectively RFC-001b layered on top.

---

## Motivation

### Current state

`handlePointerDown` (`engine.ts:600-635`) contains two independent hit-test code paths that must be checked in a fixed order:

```
pointerDown
  1. hitTestResizeHandle()   ← bespoke, imperative, recomputes 8 AABBs every call
  2. hitTest()               ← spatial R-tree, generic
  3. else → marquee
```

This has compounding problems.

**Hard-coded sizing values, no single source of truth.** Three independent places encode "handle size":

| Value | Location | Role |
|---|---|---|
| `8` (half-size, world units) | `engine.ts:333` | Hit zone half-size — full clickable area is 16 screen px, constant across zoom |
| `handleSize: 8` (full size, screen px) | `react/webgl/SelectionRenderer.ts:32` | Visual handle rendered by SDF shader — full visual is 8 screen px, constant across zoom |
| `DEAD_ZONE_PX = 4` | `engine.ts:97` | Drag dead zone (mouse) |
| `DEAD_ZONE = 8` | `react/InfiniteCanvas.tsx:164` | Drag dead zone (touch) — intentionally wider than mouse |
| `MIN_SIZE = 20` | `engine.ts:739` | Minimum resize dimension (live path) |
| `ResizeCommand.MIN_SIZE = 20` | `commands.ts:128` | Minimum resize dimension (undo/redo path) — duplicated |
| `h-2.5 w-2.5` (10 px) | `react/SelectionFrame.tsx:13` | **Dead code** on the default canvas (see below) but still shipped as an advanced export |

So **visual (8 px) and hit zone (16 px) differ by 2×** — they happen to both be constant in screen pixels, but they're set independently. Changing one without the other is a latent bug. Changing either to track zoom (for example, to give touch users a bigger visual) would produce drift the test suite won't catch.

**The default canvas renders selection chrome entirely in WebGL, not DOM.** `InfiniteCanvas.tsx:482-492` draws outlines, handles, hover rings, and snap guides in a single `SelectionRenderer` draw call via SDF shader. `SelectionFrame.tsx` is exported from `src/advanced.ts:11` for users who want a DOM-based selection frame in custom compositions, but it is not mounted by `<InfiniteCanvas>`. Therefore:

- The `cursor-nw-resize` / `pointer-events-auto` classes in `SelectionFrame.tsx` have **no effect** on the default canvas.
- There are currently **no cursor styles** of any kind driven by input state — no `cursor: grab` on widget bodies, no `cursor: *-resize` on handles. The canvas shows the OS default cursor at all times.
- The "cursor flickers during fast drags" bug described in v1 of this RFC does not exist — there was nothing to flicker.

This reframes half of v1's motivation from *"fix a broken cursor system"* to *"introduce a cursor system we never had."* That's still worth doing — Figma-parity interaction affordances matter — but it is a **new feature**, and the RFC shouldn't sell it as a bug fix.

**No extension path.** Adding a rotation handle, anchor point, or connection port requires a new bespoke `hitTestXxx()` function, another `if` branch in `handlePointerDown`, and new magic numbers. There is no generalisable pattern.

**Phantom geometry.** The 8 resize handle AABBs are recomputed from scratch on every `pointerDown`. They have no persistent identity in the world and cannot be reasoned about outside that one function.

---

## Proposal

### Guiding principle

> If something is interactable, it is an entity with `InteractionRole`. If it has world bounds, the spatial index finds it. Hit-test is one function, dispatched by role.

### Shared constants module

All sizing values move to `src/interaction-constants.ts`, consumed by the engine, `handleSyncSystem`, `SelectionRenderer`, and (if ever rendered) `SelectionFrame.tsx`.

```typescript
// src/interaction-constants.ts

/**
 * Visual handle size rendered by SelectionRenderer (full width, screen px).
 * Constant across zoom — the SDF shader converts via pxToWorld.
 */
export const HANDLE_VISUAL_SIZE_PX = 8;

/**
 * Hit-zone size for handles (full width, screen px). Deliberately larger than
 * HANDLE_VISUAL_SIZE_PX to give a generous clickable area — preserves the
 * "invisible hit tolerance" feel the current engine provides via `8 / zoom`
 * (full clickable width = 16 px). Do not reduce this without a UX test.
 */
export const HANDLE_HIT_SIZE_PX = 16;

/** Drag dead zone for mouse input. */
export const DEAD_ZONE_MOUSE_PX = 4;

/** Drag dead zone for touch input. Wider than mouse because fingers are fuzzier. */
export const DEAD_ZONE_TOUCH_PX = 8;

/** Minimum widget dimension (world units), enforced live and on undo/redo. */
export const MIN_WIDGET_SIZE = 20;
```

Phase 1 wires:
- `engine.ts` reads `HANDLE_HIT_SIZE_PX` (converted to `HANDLE_HIT_SIZE_PX / 2 / camera.zoom` half-size world units at the call site)
- `engine.ts:97` and `commands.ts:128` read `MIN_WIDGET_SIZE`
- `InfiniteCanvas.tsx:164` reads `DEAD_ZONE_TOUCH_PX`
- `SelectionRenderer.ts` reads `HANDLE_VISUAL_SIZE_PX` via `DEFAULT_SELECTION_CONFIG.handleSize`
- `SelectionFrame.tsx` reads `HANDLE_VISUAL_SIZE_PX` for its Tailwind arbitrary value (`h-[${HANDLE_VISUAL_SIZE_PX}px]`) — kept in sync even though it's dead code on the default path

Phase 1 alone (this subsection) is Alternative B from the original RFC and is worth shipping independently if Phases 2–7 slip.

---

### New ECS components

#### `Hitbox`

Defines a rectangular interactable region **anchored relative to the parent entity's `WorldBounds`**. The RFC v1 version stored absolute pixel offsets, which caused handles to detach from the parent during live resize. Anchor-relative offsets track parent bounds automatically.

```typescript
interface HitboxData {
  /** Anchor X in parent local space: 0 = parent.worldX, 1 = parent.worldX + parent.worldWidth */
  anchorX: number;
  /** Anchor Y in parent local space: 0 = parent.worldY, 1 = parent.worldY + parent.worldHeight */
  anchorY: number;
  /** Hitbox width in world units (fixed). */
  width: number;
  /** Hitbox height in world units (fixed). */
  height: number;
}

export const Hitbox = defineComponent<HitboxData>('Hitbox', {
  anchorX: 0,
  anchorY: 0,
  width: 0,
  height: 0,
});
```

Widget bodies do **not** need `Hitbox`. Their `WorldBounds` is already their hit area — adding `InteractionRole` alone makes them hit-testable. `Hitbox` is only for sub-entities whose position is relative to a parent (handles, ports, future rotation pivots).

#### `InteractionRole`

Declares what happens when this entity is hit, plus its hit-test priority.

```typescript
type InteractionRoleType =
  | { type: 'drag' }
  | { type: 'select' }
  | { type: 'resize'; handle: ResizeHandlePos }
  | { type: 'rotate' }          // future
  | { type: 'connect' }         // future
  | { type: 'canvas' };         // background-like entity

interface InteractionRoleData {
  /** Hit-test priority — higher wins when multiple entities contain the point. */
  layer: number;
  /** Discriminated role + role-specific data. */
  role: InteractionRoleType;
}

export const InteractionRole = defineComponent<InteractionRoleData>('InteractionRole', {
  layer: 0,
  role: { type: 'canvas' },
});
```

Canonical layer values:

| Layer | Usage |
|---|---|
| `0` | Background / canvas catch-all |
| `5` | Normal widget body |
| `10` | Edge resize handles (n, s, e, w) |
| `15` | Corner resize handles (nw, ne, sw, se) — higher so corners win at overlaps |
| `20` | Reserved for future point handles (rotation, anchor) |

Layer lives on `InteractionRole` rather than `Hitbox` because priority is a property of what the interaction *does*, not of the geometry.

#### `HandleSet`

Component on the parent entity listing the EntityIds of its spawned handle children. Replaces the `HitboxOwner` tag from v1. Having the IDs (not just a presence tag) means `engine.destroyEntity` can cascade in O(1) without a reverse-index scan of `Parent` components.

```typescript
interface HandleSetData { ids: EntityId[] }
export const HandleSet = defineComponent<HandleSetData>('HandleSet', { ids: [] });
```

#### `CursorHint`

Declares the cursor this entity requests when hovered (idle) and when actively being interacted with (drag/resize in progress).

```typescript
type CSSCursor =
  | 'default' | 'grab' | 'grabbing' | 'crosshair'
  | 'n-resize' | 's-resize' | 'e-resize' | 'w-resize'
  | 'ne-resize' | 'nw-resize' | 'se-resize' | 'sw-resize';

interface CursorHintData {
  hover:  CSSCursor;   // cursor when this entity is hovered in idle state
  active: CSSCursor;   // cursor while this entity is being dragged/resized
}

export const CursorHint = defineComponent<CursorHintData>('CursorHint', {
  hover: 'default',
  active: 'default',
});
```

Canonical values per entity type:

| Entity | `hover` | `active` |
|---|---|---|
| Widget body | `'grab'` | `'grabbing'` |
| Corner handle (`nw`, `ne`, `sw`, `se`) | `'nw-resize'` etc. | same |
| Edge handle (`n`, `s`) | `'n-resize'` etc. | same |
| Edge handle (`e`, `w`) | `'e-resize'` etc. | same |
| Background / canvas | `'default'` | `'default'` |

#### `CursorResource`

Output sink. Written by `cursorSystem` each tick; read by the RAF loop to apply `style.cursor` on the root container div.

```typescript
interface CursorResourceData { cursor: CSSCursor }
export const CursorResource = defineResource<CursorResourceData>('Cursor', { cursor: 'default' });
```

---

### New systems

#### `handleSyncSystem` — runs BEFORE `hitboxWorldBoundsSystem`

Manages the lifecycle of resize handle child entities in response to selection state changes. **Must run before `hitboxWorldBoundsSystem`** so handles spawned this tick have their `WorldBounds` computed in the same tick (otherwise there is a one-frame window where new handles are not in the spatial index).

```typescript
function handleSyncSystem(world: World): void {
  // Who should have handles right now?
  const selectedResizable: EntityId[] = [];
  for (const entity of world.query(Resizable)) {
    if (world.hasTag(entity, Selected)) selectedResizable.push(entity);
  }

  // Multi-select disables handles (matches the v1 behaviour of hitTestResizeHandle).
  const shouldSpawn = selectedResizable.length === 1 ? selectedResizable[0] : null;

  // Despawn handles on anything that shouldn't have them.
  for (const parentId of world.query(HandleSet).slice()) {
    if (parentId !== shouldSpawn) despawnHandles(world, parentId);
  }

  // Spawn handles on the sole selected resizable, if it doesn't already have them.
  if (shouldSpawn !== null && !world.hasComponent(shouldSpawn, HandleSet)) {
    spawnResizeHandles(world, shouldSpawn);
  }

  // Orphan sweep: handles whose parent has been destroyed.
  for (const entity of world.query(Hitbox, Parent)) {
    const parentId = world.getComponent(entity, Parent)!.id;
    if (!world.entityExists(parentId)) {
      world.destroyEntity(entity);
    }
  }
}

const HANDLE_SPECS: Array<{
  pos: ResizeHandlePos; ax: number; ay: number; layer: number; cursor: CSSCursor;
}> = [
  { pos: 'nw', ax: 0,   ay: 0,   layer: 15, cursor: 'nw-resize' },
  { pos: 'ne', ax: 1,   ay: 0,   layer: 15, cursor: 'ne-resize' },
  { pos: 'sw', ax: 0,   ay: 1,   layer: 15, cursor: 'sw-resize' },
  { pos: 'se', ax: 1,   ay: 1,   layer: 15, cursor: 'se-resize' },
  { pos: 'n',  ax: 0.5, ay: 0,   layer: 10, cursor: 'n-resize'  },
  { pos: 's',  ax: 0.5, ay: 1,   layer: 10, cursor: 's-resize'  },
  { pos: 'w',  ax: 0,   ay: 0.5, layer: 10, cursor: 'w-resize'  },
  { pos: 'e',  ax: 1,   ay: 0.5, layer: 10, cursor: 'e-resize'  },
];

function spawnResizeHandles(world: World, parentId: EntityId): void {
  const S = HANDLE_HIT_SIZE_PX;  // world-unit size of the hit box
  const ids: EntityId[] = [];

  for (const spec of HANDLE_SPECS) {
    const id = world.createEntity();
    world.addComponent(id, Parent, { id: parentId });
    world.addComponent(id, Hitbox, {
      anchorX: spec.ax,
      anchorY: spec.ay,
      width: S,
      height: S,
    });
    world.addComponent(id, InteractionRole, {
      layer: spec.layer,
      role: { type: 'resize', handle: spec.pos },
    });
    world.addComponent(id, CursorHint, { hover: spec.cursor, active: spec.cursor });
    // Inherit Active from parent so the navigation filter doesn't exclude handles.
    if (world.hasTag(parentId, Active)) world.addTag(id, Active);
    ids.push(id);
  }

  world.addComponent(parentId, HandleSet, { ids });
}

function despawnHandles(world: World, parentId: EntityId): void {
  const set = world.getComponent(parentId, HandleSet);
  if (!set) return;
  for (const id of set.ids) {
    if (world.entityExists(id)) world.destroyEntity(id);
  }
  world.removeComponent(parentId, HandleSet);
}
```

Important: `engine.destroyEntity` is updated to read `HandleSet` from the target (if present) and destroy each handle (and remove its spatial-index entry) before destroying the target itself. This gives a proper destroy cascade without relying on `handleSyncSystem`'s orphan sweep for correctness during active pointer operations.

#### `hitboxWorldBoundsSystem` — runs AFTER `handleSyncSystem` and `transformPropagateSystem`

For every entity with `Hitbox + Parent`, derives absolute `WorldBounds` from the parent's `WorldBounds` + anchor-relative offset. Because offsets are expressed as 0..1 anchors, handles automatically track parent resizes mid-drag.

```typescript
function hitboxWorldBoundsSystem(world: World): void {
  for (const entity of world.query(Hitbox, Parent)) {
    const parentId = world.getComponent(entity, Parent)!.id;
    if (!world.entityExists(parentId)) continue;
    const parentWB = world.getComponent(parentId, WorldBounds);
    if (!parentWB) continue;

    const hb = world.getComponent(entity, Hitbox)!;
    const cx = parentWB.worldX + parentWB.worldWidth  * hb.anchorX;
    const cy = parentWB.worldY + parentWB.worldHeight * hb.anchorY;

    const next = {
      worldX: cx - hb.width / 2,
      worldY: cy - hb.height / 2,
      worldWidth:  hb.width,
      worldHeight: hb.height,
    };

    if (world.hasComponent(entity, WorldBounds)) {
      world.setComponent(entity, WorldBounds, next);
    } else {
      world.addComponent(entity, WorldBounds, next);
    }
  }
}
```

The spatial index's existing `onComponentChanged(WorldBounds)` observer (`engine.ts:262-266`) picks these up automatically — no additional wiring required. **Note**: this multiplies per-tick spatial-index upserts during an active drag by the number of handles (currently 8). See Phase 0 below for the required benchmark.

#### `cursorSystem` — runs at the END of the pipeline

Derives the correct cursor each tick from input state and entity `CursorHint` components.

```typescript
function cursorSystem(
  world: World,
  inputState: InputState,
  hoveredEntity: EntityId | null,
): void {
  let cursor: CSSCursor = 'default';

  switch (inputState.mode) {
    case 'idle':
    case 'marquee': {
      if (hoveredEntity !== null) {
        cursor = world.getComponent(hoveredEntity, CursorHint)?.hover ?? 'default';
      }
      break;
    }
    case 'tracking': {
      // Dead zone not yet crossed — show hover intent (grab), not active (grabbing)
      cursor = world.getComponent(inputState.entityId, CursorHint)?.hover ?? 'default';
      break;
    }
    case 'dragging': {
      cursor = world.getComponent(inputState.entityId, CursorHint)?.active ?? 'grabbing';
      break;
    }
    case 'resizing': {
      // handleEntityId is the handle child that was originally hit
      cursor = world.getComponent(inputState.handleEntityId, CursorHint)?.active ?? 'default';
      break;
    }
  }

  world.setResource(CursorResource, { cursor });
}
```

**Why `tracking` returns `hover` and not `active`**: when the user presses down on a widget but hasn't dragged past the dead zone, we want to show `grab` (hover intent). The moment the dead zone breaks and the mode becomes `dragging`, the cursor shifts to `grabbing`. This distinction cannot be expressed with static CSS classes.

**Application in the RAF loop** (`InfiniteCanvas.tsx`):

```typescript
if (didTick) {
  const { cursor } = engine.world.getResource(CursorResource);
  if (containerRef.current && containerRef.current.style.cursor !== cursor) {
    containerRef.current.style.cursor = cursor;
  }
  // ... rest of render
}
```

**Cursor-tick-rate caveat**: this updates at tick rate (≤ 60 Hz), not pointer rate. Pointer-move without state change already marks the engine dirty via hover tracking (`engine.ts:778-783`), so hover cursors update at pointer rate in practice. But if pointer events arrive during a frame that's already ticking, the cursor may lag one frame. Acceptable for an initial implementation; revisit if users notice.

---

### Unified hit test

`hitTestResizeHandle` is deleted. `hitTest` becomes:

```typescript
function hitTest(
  screenX: number,
  screenY: number,
): { entityId: EntityId; role: InteractionRoleData } | null {
  const camera = world.getResource(CameraResource);
  const worldPos = screenToWorld(screenX, screenY, camera);

  // Zero-tolerance point query: with tolerance=0, RBush returns only entries
  // whose AABB strictly contains the point, so no secondary pointInAABB check
  // is needed. Generous "hit slop" for small widgets now lives in the Hitbox
  // size (HANDLE_HIT_SIZE_PX is larger than HANDLE_VISUAL_SIZE_PX for this
  // reason) rather than in the query tolerance.
  const candidates = spatialIndex.searchPoint(worldPos.x, worldPos.y, 0);

  // Filter: must be Active (in current navigation frame) AND have a role.
  type Candidate = { entityId: EntityId; role: InteractionRoleData };
  const interactable: Candidate[] = [];
  for (const c of candidates) {
    if (!world.hasTag(c.entityId, Active)) continue;
    const role = world.getComponent(c.entityId, InteractionRole);
    if (!role) continue;
    interactable.push({ entityId: c.entityId, role });
  }
  if (interactable.length === 0) return null;

  // Sort: role.layer desc, then ZIndex desc as tiebreaker.
  interactable.sort((a, b) => {
    if (b.role.layer !== a.role.layer) return b.role.layer - a.role.layer;
    const zA = world.getComponent(a.entityId, ZIndex)?.value ?? 0;
    const zB = world.getComponent(b.entityId, ZIndex)?.value ?? 0;
    return zB - zA;
  });

  return interactable[0];
}
```

Two invariants this relies on:
1. `spatialIndex.searchPoint(x, y, 0)` (`spatial.ts:48-55`) returns only entries whose AABB contains `(x, y)` — verified by reading the current implementation. Must remain true; a regression test should pin this.
2. Widget bodies are not made non-interactable by dropping the generous `2 / zoom` tolerance the old code used. Handles have generous tolerance via `HANDLE_HIT_SIZE_PX > HANDLE_VISUAL_SIZE_PX`; widget bodies lose ~2 px of slop at zoom 1×. Acceptable because widget bodies are typically much larger than 2 px.

### DOM topology assumption

The unified hit test works because **`engine.handlePointerDown` is coordinate-based, not DOM-topology-based**. It does not care which DOM element received the pointer event — it reads screen-space coordinates, converts to world space, and queries the spatial index. This means:

- A click on a resize handle that extends outside the widget body fires on the **background div** (`InfiniteCanvas.tsx:594-599`), which forwards world coordinates to the engine. The engine finds the handle entity in the spatial index regardless.
- A click inside a widget body fires on the `WidgetSlot` (`WidgetSlot.tsx:46-70`), which also forwards world coordinates.
- A click on an overlay for a WebGL widget goes through `SelectionOverlaySlot` (`SelectionOverlaySlot.tsx:44-57`), same forwarding.

No DOM changes are required for handle hit-testing to work. The RFC's Phase 5 switchover does not introduce new DOM elements. This is load-bearing and should be preserved.

### Simplified `handlePointerDown`

```typescript
handlePointerDown(screenX, screenY, button, modifiers): PointerDirective {
  const hit = hitTest(screenX, screenY);

  if (!hit) {
    clearSelection();
    inputState = { mode: 'marquee', startX: screenX, startY: screenY };
    markDirtyInternal();
    return { action: 'capture-marquee' };
  }

  switch (hit.role.role.type) {
    case 'resize': {
      const parentId = world.getComponent(hit.entityId, Parent)!.id;
      const t = world.getComponent(parentId, Transform2D)!;
      commandBuffer.beginGroup();
      inputState = {
        mode: 'resizing',
        entityId: parentId,
        handleEntityId: hit.entityId,   // stored so cursorSystem can read CursorHint
        handle: hit.role.role.handle,
        startX: screenX,
        startY: screenY,
        startBounds: { x: t.x, y: t.y, width: t.width, height: t.height },
      };
      markDirtyInternal();
      return { action: 'capture-resize', handle: hit.role.role.handle };
    }

    case 'drag': {
      selectEntity(hit.entityId, modifiers.shift);
      if (world.hasTag(hit.entityId, Draggable)) {
        inputState = { mode: 'tracking', entityId: hit.entityId, startX: screenX, startY: screenY };
      }
      markDirtyInternal();
      return { action: 'passthrough-track-drag' };
    }

    case 'select': {
      selectEntity(hit.entityId, modifiers.shift);
      markDirtyInternal();
      return { action: 'passthrough' };
    }

    case 'canvas':
    default:
      return { action: 'passthrough' };
  }
}
```

No ordering dependency. Priority is entirely data-driven via `InteractionRole.layer`.

---

### System execution order (updated)

```
transformPropagateSystem      ← WorldBounds from Transform2D
handleSyncSystem              ← spawn/despawn handle entities          [NEW]
hitboxWorldBoundsSystem       ← WorldBounds for Hitbox children        [NEW]
navigationFilterSystem        ← mark Active entities
cullSystem                    ← mark Visible entities
breakpointSystem
sortSystem
cursorSystem                  ← derive CursorResource                  [NEW]
```

Key ordering requirements:
- `handleSyncSystem` runs **before** `hitboxWorldBoundsSystem` so newly spawned handles get their `WorldBounds` in the same tick they are created (otherwise spatial-index entries lag by a frame and the first pointer event after selection misses).
- `hitboxWorldBoundsSystem` runs **after** `transformPropagateSystem` so parent `WorldBounds` is fresh.
- `navigationFilterSystem` runs after `handleSyncSystem` so it applies `Active` tagging to handles spawned this tick — plus `spawnResizeHandles` propagates `Active` from parent on creation as a belt-and-braces measure.
- `cursorSystem` runs last so it sees the final input-state + hover state for the tick.

---

## Alternatives considered

### Alt A: `InteractionZones` array on a single entity

Add an `InteractionZones: { zones: Zone[] }` component to existing entities rather than spawning child entities.

**Pro**: simpler, no lifecycle management, no spatial-index multiplier.
**Con**: zones must be flattened into the spatial index manually (the index stores entity bounds, not sub-entity bounds). Requires a custom index extension, and hit-test sorting across *sub-entities* rather than entities is a new concept. Also mixes display-entity data with interaction data.

### Alt B: Extract constants only

Phase 1 of this RFC, shipped alone. Move all magic numbers to `interaction-constants.ts` and wire `SelectionRenderer`, `engine.ts`, `commands.ts`, and touch dead-zone through them. **No** change to hit-test structure.

**Pro**: tiny, low-risk, fixes the single-source-of-truth problem.
**Con**: the two hit-test paths remain. New interactions still need bespoke functions.

This is the right fallback if Phases 2–7 slip. It is also a hard prerequisite for every later phase, so do it first regardless.

### Alt C: DOM pointer events on handle divs

Give each `<div data-handle="nw">` actual `onPointerDown` handlers in `SelectionFrame.tsx`, and actually mount `SelectionFrame` inside `WidgetSlot` when the widget is selected.

**Pro**: browser handles hit detection.
**Con**: the default canvas draws selection chrome in WebGL — mounting a DOM `SelectionFrame` just for hit-test would mean maintaining *two* handle representations, or switching the canvas to DOM chrome (a large regression for fill-rate and draw-call count). Also fights the pointer capture model in `WidgetSlot`. Rejected.

---

## Migration path

**Phase 0 — Benchmark** *(new)*

Before making any changes, record a baseline using the existing `Profiler` (see `src/profiler.ts` and the Inspector panel). Capture `frameTime.p50` / `p95` / `p99` and per-system averages on a playground scene with 1, 10, 100, and 1000 entities during:
- Idle
- Single-entity drag
- Single-entity resize
- Multi-entity drag (10 selected)

This gives us a concrete cost model for the 8× spatial-index upsert multiplier during resize/drag. Re-run after Phase 5 to verify no p95/p99 regression. If the multiplier turns out to matter, the mitigation is to drive `hitboxWorldBoundsSystem` reactively from `onComponentChanged(WorldBounds)` on the parent rather than iterating all `(Hitbox, Parent)` entities every tick — but we should measure before optimising.

**Phase 1 — Constants** *(Alt B, independently valuable)*

Create `src/interaction-constants.ts` with all constants. Update:
- `engine.ts:97` → `DEAD_ZONE_MOUSE_PX`
- `engine.ts:333` → `HANDLE_HIT_SIZE_PX / 2 / camera.zoom`
- `engine.ts:739` → `MIN_WIDGET_SIZE`
- `commands.ts:128` → `MIN_WIDGET_SIZE`
- `InfiniteCanvas.tsx:164` → `DEAD_ZONE_TOUCH_PX`
- `react/webgl/SelectionRenderer.ts:32` → `HANDLE_VISUAL_SIZE_PX`
- `react/SelectionFrame.tsx:13` → `h-[${HANDLE_VISUAL_SIZE_PX}px]` (arbitrary value)

No behaviour change. Existing tests must still pass.

**Phase 2 — Register `Hitbox`, `InteractionRole`, `HandleSet`, `CursorHint`, `CursorResource`**

Define the component and resource types. Wire no systems yet. Zero behaviour change.

**Phase 3 — `hitboxWorldBoundsSystem`**

Register the system in the correct slot (after `transformPropagateSystem`). Entities without `Hitbox` are untouched, so this is a no-op until Phase 4 adds `Hitbox` instances.

**Phase 4 — `handleSyncSystem` + destroy cascade**

Register the system (before `hitboxWorldBoundsSystem`). Extend `engine.destroyEntity` to cascade through `HandleSet`. Tests:
- Handles appear in the spatial index exactly when exactly one `Resizable + Selected` entity exists.
- Handles despawn on deselect, on `Resizable` tag removal, on multi-select, and on parent destroy.
- Handle positions update within one tick when parent `Transform2D` changes (verifies the anchor-relative math).
- Handle `WorldBounds` are present in the same tick they are created (verifies system ordering).

**Phase 5 — Switch `handlePointerDown` to unified hit test**

Add `InteractionRole { layer: 5, role: { type: 'drag' } }` (or `'select'` for `Selectable`-but-not-`Draggable` entities) to widget body entities in `engine.addWidget`. Delete `hitTestResizeHandle`. Replace the body of `handlePointerDown` with the switch above.

Regression-test resize at zoom 0.5×, 1×, 2× — same corner-handle locations, same minimum size, same command stream.

Re-run the Phase 0 benchmark. Block the phase on no p95 regression > 5%.

**Phase 6 — CursorHint on widget bodies** *(start of "cursor feature" subsystem; can be deferred to RFC-001b)*

Add `CursorHint { hover: 'grab', active: 'grabbing' }` to widget body entities in `engine.addWidget`. `spawnResizeHandles` already sets `CursorHint` on handles per Phase 4.

**Phase 7 — `cursorSystem` + RAF application**

Register `cursorSystem` at the end of the pipeline. In the RAF loop in `InfiniteCanvas.tsx`, read `CursorResource` after `flushIfDirty()` returns true and apply to `containerRef.current.style.cursor`. Guard with the equality check shown above to avoid redundant style writes.

No `cursor-*` class changes are required because the default canvas has none.

Verify:
- Idle hover over a widget body → `grab`
- Press down on widget body (dead zone not crossed) → still `grab`
- Drag past dead zone → `grabbing`
- Release → back to `grab` (still hovered) or `default` (pointer off widget)
- Hover over each of the 8 handles → correct directional cursor
- Active resize → same directional cursor held even when pointer leaves the handle's visual area

---

## Open questions

1. **Handle inheritance of `Active` during navigation changes.** Resolved in the proposal: `spawnResizeHandles` copies `Active` from parent at creation, and `navigationFilterSystem` running after `handleSyncSystem` cleans up any drift. If a more general parent-propagation system is added later, this can be simplified.

2. **Multi-select resize.** Currently blocked (handles only spawn when exactly 1 entity is selected — `handleSyncSystem` filter). Is multi-entity resize a near-term requirement? If so, a group-bounding-box entity with its own `InteractionRole { role: 'resize' }` is probably the right model rather than per-entity handles. Out of scope for this RFC.

3. **Hit zone shape.** The current engine uses a square AABB for handle hit zones. Rotation / anchor point handles would feel more natural as circles. The spatial index stores AABBs, so a circular hit region would need a secondary radius check in `hitTest` after the AABB query. Deferred until rotation handles are actually needed.

4. **Cursor update cadence.** `cursorSystem` currently runs at tick rate. Pointer-move already triggers ticks via hover tracking, so in practice cursors follow the pointer. But during an already-dirty frame, a cursor change queued by a second pointer event may lag by one frame. Leave as-is; revisit only if users notice.

5. **Touch and handle hit-testing.** Touch events enter through `InfiniteCanvas.tsx`'s gesture state machine (`onTouchStart` at line 216). The `isOnWidget` check (line 168) relies on `data-widget-slot` attribute detection, which is only set on widget slots — not on hypothetical handle DOM elements (which don't exist anyway in the default WebGL canvas). So on touch, a tap on the *visual* region of a handle that extends outside the widget body is classified as an empty-space tap and currently becomes a pan-pending gesture. **This is a gap today, not introduced by the RFC** — the same pre-existing bug affects `hitTestResizeHandle` on touch. Worth a follow-up RFC that either enlarges widget slot bounds by `HANDLE_HIT_SIZE_PX / 2` when selected, or adds a hidden DOM "handle shell" around selected widgets for touch. Out of scope here.

6. **Should Phases 6–7 be split into RFC-001b?** The cursor subsystem is independent of the hit-test rework and pure-feature rather than refactor. Splitting lets Phases 1–5 ship faster and lets cursor affordances gather feedback on their own. Author's preference: keep in this RFC, tag Phases 6–7 clearly as optional, let the implementer decide based on schedule.

---

## Acceptance criteria

**Phase 1 (constants)**
- [ ] All sizing/threshold values consolidated in `src/interaction-constants.ts`
- [ ] `SelectionRenderer`, `engine.ts`, `commands.ts`, `InfiniteCanvas.tsx` (touch), and `SelectionFrame.tsx` all read from the same module
- [ ] Visual handle (`HANDLE_VISUAL_SIZE_PX`) and hit zone (`HANDLE_HIT_SIZE_PX`) are explicitly different values with documented rationale
- [ ] Existing tests pass unchanged

**Phases 2–5 (hit test unification)**
- [ ] `hitTestResizeHandle` function deleted
- [ ] Single `hitTest` function covers all interaction types and filters by `Active`
- [ ] `handlePointerDown` body is a `switch` on `InteractionRole.role.type` with no ordering dependencies
- [ ] Handle entities are present in the spatial index in the same tick they are spawned
- [ ] Handles are despawned synchronously when parent is deselected, loses `Resizable`, is destroyed, or joins a multi-select
- [ ] Handle positions track parent size changes mid-drag (no detachment during resize)
- [ ] `engine.destroyEntity` cascades through `HandleSet` — no handle leaks
- [ ] Resize behaviour at zoom 0.5×, 1×, 2× matches the pre-change baseline (same final bounds, same command stream)
- [ ] Adding a new interaction type (rotation handle, connection port) requires: one new `InteractionRole` role variant, one spawn helper, one `case` in `handlePointerDown` — no changes to `hitTest` or the spatial index
- [ ] Phase 0 benchmark re-run shows no p95 frame-time regression > 5% at 1000 entities

**Phases 6–7 (cursor — optional, may split into RFC-001b)**
- [ ] Root-container `style.cursor` is the only place cursor is set anywhere in the React tree
- [ ] Cursor is `grab` during `tracking` (dead zone not yet crossed)
- [ ] Cursor is `grabbing` during `dragging`
- [ ] Cursor is held correctly when the pointer leaves widget bounds mid-drag (pointer capture active)
- [ ] Each of the 8 resize handles shows the correct directional cursor on hover and during active resize
- [ ] Cursor does not visibly flicker during fast drags (no `default` frames observed)
- [ ] Adding a new cursor style requires only a `CursorHint` value on the new entity — no changes to `cursorSystem`

---

## Revision notes

**v1 → v2** (same-day revision after a thorough review of the current codebase)

Corrections to motivation:
- `SelectionFrame.tsx` is not rendered by the default `<InfiniteCanvas>`; selection chrome is drawn by `SelectionRenderer` in WebGL. The "cursor flickers during fast drags" bug from v1 does not exist — no cursor is currently set anywhere. The cursor system is reframed as a new feature, not a bug fix.
- The "zoom = 2 → 20 px visual vs 16 px hit" arithmetic was wrong (referenced the dead-code DOM handle). The real mismatch is: WebGL visual = 8 px, hit zone = 16 px, both constant across zoom.

Design fixes:
- System execution order corrected: `handleSyncSystem` must run **before** `hitboxWorldBoundsSystem`, not after.
- `Active` tag filter preserved in the new `hitTest` (v1 dropped it, which would have let non-active-frame entities become hit-testable).
- `Hitbox` stores **anchor-relative** offsets (0..1 × parent dimensions), not absolute pixel offsets, so handles track parent size changes during live resize.
- `layer` moved from `Hitbox` to `InteractionRole` — it's a property of what the interaction does, not of the geometry.
- `HandleSet` component on the parent replaces the `HitboxOwner` tag, giving `engine.destroyEntity` O(1) cascade without a reverse-index scan.
- `handleSyncSystem` multi-select filter corrected — v1's example query would have spawned handles for every selected Resizable.
- Destroy cascade specified: `engine.destroyEntity` reads `HandleSet` and destroys handles before destroying the parent.
- Dead zones split into `DEAD_ZONE_MOUSE_PX` (4) and `DEAD_ZONE_TOUCH_PX` (8) to preserve the existing touch-vs-mouse difference.
- `HANDLE_HIT_SIZE_PX` pinned to 16 to preserve the current hit-zone size (v1's proposed 10 would have shrunk the clickable area).
- Phase 0 benchmark added — we must measure the 8× spatial-index upsert cost before committing.
- DOM topology assumption documented — the RFC works because `handlePointerDown` is coordinate-based, and this is load-bearing.
- Phases 6–7 flagged as independently splittable into RFC-001b.
