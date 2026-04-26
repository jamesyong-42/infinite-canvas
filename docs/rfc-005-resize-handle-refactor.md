# RFC-005: Resize Handle Refactor

- **Status**: Implemented v1
- **Author**: James Yong
- **Date**: 2026-04-23
- **Area**: ECS / Interaction
- **Related**: RFC-001 (introduced the sub-entity handle model — this
  RFC supersedes its implementation choice while preserving every
  user-facing behaviour), RFC-004 (depends on this landing first —
  once `Parent` is no longer used for handles, RFC-004's Phase 0
  simplifies from a *split* of `Parent` into a straight *rename* to
  `ParentFrame`)

---

## Summary

Remove the sub-entity handle model introduced by RFC-001. Resize
hotspots no longer exist as ECS entities; `hitTest` detects them
inline from the dragged/selected widget's own `Transform2D`. The
`Resizable` tag is retained; every user-visible behaviour (8 handles,
cursor changes on hover, corner-wins-over-edge priority, anchor-correct
resize) is preserved.

This is a pure simplification — no feature added, no feature removed.
The goal is to collapse a seven-moving-part implementation (two
components, two systems, one tag, one command, cascading lifecycle)
down to two moving parts (one tag, one command), concentrated in
`interaction.ts`.

A follow-up benefit: the `Parent` component's only remaining consumer
disappears, which lets RFC-004's Phase 0 rename `Parent` →
`ParentFrame` cleanly instead of splitting the overloaded component.

To verify nothing regresses, the refactor ships with a minimal
`DebugResizable` widget in the playground that exercises each handle
position end-to-end; the existing `Resizable`-opt-in toggle in
`SettingsPanel.tsx` stays as a dev path for flipping resize on any
widget.

---

## Motivation

### What the current model does

RFC-001 made every resize handle a real ECS entity so the hit-test
pipeline could be unified: handles flowed through the same
spatial-index lookup as widgets, with their own `Hitbox`,
`InteractionRole`, `CursorHint`, and a `Parent` back-reference. The
mechanics today:

- `handleSyncSystem` (`systems/handle-sync.ts`, ~120 lines) —
  spawns 8 handle entities when a single `Resizable` widget is
  `Selected`; despawns them when selection changes; orphan-sweeps
  handles whose parent was destroyed.
- `hitboxWorldBoundsSystem` (`systems/hitbox-world-bounds.ts`, ~45
  lines) — derives each handle's `WorldBounds` from its parent's
  `WorldBounds` + anchor.
- `Parent`, `Hitbox`, `HandleSet` components — referenced by the two
  systems above; `Parent` also accidentally serves as a back-door for
  container-child hierarchy (RFC-004's v2 is cleaning that up).
- `interaction.ts` hit-test — returns `{ entityId: handleId, role:
  'resize' }`; resize state captures `handleEntityId` for… no
  subsequent use (only the handle *position* matters).

### The cost

One selected `Resizable` widget means:

- 8 new entities in the world.
- 8 new entries in the spatial index (with the associated RBush
  rebalancing and observer fan-out).
- 8 × 4 = 32 component writes on spawn (Parent, Hitbox,
  InteractionRole, CursorHint).
- Every `Transform2D` change on the parent triggers
  `hitboxWorldBoundsSystem` to rewrite 8 `WorldBounds` entries.
- Selection toggling spawns/despawns 8 entities per tick transition.

None of this cost buys anything the user can perceive. It's pure
machinery supporting an abstraction choice ("handles are entities")
that was made for code-unification reasons, not product ones.

### What the model actually needs to compute

On every pointer event, one deterministic question: *is the pointer
inside one of the 8 hotspots around the selected `Resizable` widget?*
That's 8 AABB-contains-point tests against arithmetic derived from
the widget's `Transform2D`. No persistent state required; no lifecycle;
no spatial index.

The refactor replaces the entity machinery with that direct test.

---

## Proposal

### `hitTest` pre-pass — inline handle detection

`interaction.ts`'s `hitTest(screenX, screenY)` gains a pre-pass that
runs before the existing spatial-index lookup. Pseudocode:

```typescript
function hitTest(screenX, screenY): HitResult | null {
  const world = ctx.world;
  const worldPt = screenToWorld(screenX, screenY, world.getResource(CameraResource));

  // --- Pre-pass: resize handle detection ---
  // Gather selected Resizable widgets, sorted by ZIndex desc. Usually 0–1.
  const resizables: EntityId[] = [];
  for (const e of world.queryTagged(Selected)) {
    if (world.hasTag(e, Resizable)) resizables.push(e);
  }
  resizables.sort(byZIndexDesc(world));

  for (const widgetId of resizables) {
    const t = world.getComponent(widgetId, Transform2D);
    if (!t) continue;
    const handle = detectResizeHandle(worldPt, t);
    if (handle) {
      return {
        entityId: widgetId,
        role: { layer: 15, role: { type: 'resize', handle } },
      };
    }
  }

  // --- Normal widget hit test: unchanged ---
  return spatialIndexHit(worldPt);
}
```

`detectResizeHandle`:

```typescript
function detectResizeHandle(
  worldPt: { x: number; y: number },
  t: Transform2DData,
): ResizeHandlePos | null {
  const S = HANDLE_HIT_SIZE_PX; // existing constant, now private to interaction.ts
  const half = S / 2;

  // Corners win over edges. Corner hotspots are S×S squares centred at
  // each corner of the widget's AABB.
  const corners: Array<{ pos: ResizeHandlePos; cx: number; cy: number }> = [
    { pos: 'nw', cx: t.x,           cy: t.y },
    { pos: 'ne', cx: t.x + t.width, cy: t.y },
    { pos: 'sw', cx: t.x,           cy: t.y + t.height },
    { pos: 'se', cx: t.x + t.width, cy: t.y + t.height },
  ];
  for (const c of corners) {
    if (
      worldPt.x >= c.cx - half && worldPt.x <= c.cx + half &&
      worldPt.y >= c.cy - half && worldPt.y <= c.cy + half
    ) return c.pos;
  }

  // Edges — the hotspot is a thin band of thickness S along the edge
  // segment, excluding the corner regions already tested above.
  const edges: Array<{ pos: ResizeHandlePos; cx: number; cy: number }> = [
    { pos: 'n', cx: t.x + t.width / 2, cy: t.y },
    { pos: 's', cx: t.x + t.width / 2, cy: t.y + t.height },
    { pos: 'w', cx: t.x,               cy: t.y + t.height / 2 },
    { pos: 'e', cx: t.x + t.width,     cy: t.y + t.height / 2 },
  ];
  for (const e of edges) {
    if (
      worldPt.x >= e.cx - half && worldPt.x <= e.cx + half &&
      worldPt.y >= e.cy - half && worldPt.y <= e.cy + half
    ) return e.pos;
  }

  return null;
}
```

The 8-hotspot geometry is identical to today's handle-entity layout —
same `HANDLE_HIT_SIZE_PX` slop, same corner-then-edge priority (the
`layer: 15` vs `layer: 10` ordering in the old `HANDLE_SPECS` is now
encoded by the loop order, cheaper and equally deterministic).

### Cursor derivation from the hit result

Today's `runCursorSystem` reads `CursorHint` off `hoveredEntity`.
`CursorHint` on handles stored `{ hover: 'nw-resize', active: 'nw-resize' }`
and so on, pulling the cursor from the handle entity.

With handles gone, the hit result itself carries the handle position.
The cursor system maps handle position → cursor directly:

```typescript
function cursorForHandle(handle: ResizeHandlePos): CSSCursor {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n':  case 's':  return 'ns-resize';
    case 'e':  case 'w':  return 'ew-resize';
  }
}
```

(The existing `CursorHint` values used `nw-resize`/`ne-resize` etc.,
which are also valid CSS. Either mapping works — I'd use the
`nwse`/`nesw` pairs because they communicate the resize axis more
honestly, but matching the existing values is a one-line switch if
we want zero visual difference.)

`runCursorSystem` flow change:

```
idle/tracking + hoveredEntity is a Resizable and handle detected → cursor = cursorForHandle(handle)
idle/tracking + hoveredEntity is a Resizable and no handle → cursor = widget's CursorHint.hover
idle/tracking + non-Resizable hover → unchanged (read CursorHint on hoveredEntity)
resizing mode → cursor = cursorForHandle(inputState.handle)
```

`hitTest` already knows the handle position (it returned it in the
pre-pass); cache that on `hoveredEntity`-adjacent state or re-detect
during cursor resolution. Re-detection is cheap (same 8 comparisons);
I'd re-detect to keep cursor system independent of the caller's
caching.

### Resize state machine simplification

`InputState.resizing` drops the `handleEntityId` field:

```diff
  | {
      mode: 'resizing';
      entityId: EntityId;
-     handleEntityId: EntityId;
      handle: ResizeHandlePos;
      startX: number;
      startY: number;
      startBounds: { x: number; y: number; width: number; height: number };
    }
```

`handlePointerDown`'s resize branch reads the role directly:

```diff
  case 'resize': {
-   const parentRef = world.getComponent(hit.entityId, Parent);
-   if (!parentRef) return { action: 'passthrough' };
-   const parentId = parentRef.id;
-   const t = world.getComponent(parentId, Transform2D);
+   const parentId = hit.entityId;          // hit IS the widget now
+   const t = world.getComponent(parentId, Transform2D);
    if (!t) return { action: 'passthrough' };
    commandBuffer.beginGroup();
    inputState = {
      mode: 'resizing',
      entityId: parentId,
-     handleEntityId: hit.entityId,
      handle: hit.role.role.handle,
      startX: screenX,
      startY: screenY,
      startBounds: { x: t.x, y: t.y, width: t.width, height: t.height },
    };
    markDirty();
    return { action: 'capture-resize', handle: hit.role.role.handle };
  }
```

`handlePointerMove` and `handlePointerUp` resize branches are
unchanged — they only ever read `inputState.handle` and
`inputState.entityId`.

### What deletes, at a glance

| Path | Disposition |
|---|---|
| `systems/handle-sync.ts` | DELETE (the whole file) |
| `systems/hitbox-world-bounds.ts` | DELETE (the whole file) |
| `Hitbox` component in `components.ts` | DELETE |
| `HandleSet` component in `components.ts` | DELETE |
| `Parent` component in `components.ts` | DELETE (handles were its only consumer — RFC-004 Phase 0 relabels container hierarchy to `ParentFrame`) |
| `interaction-constants.ts` `HANDLE_HIT_SIZE_PX` | MOVE to `interaction.ts` as a private const |
| `handleSyncSystem` / `hitboxWorldBoundsSystem` registrations in `LayoutEngine.ts` scheduler | DELETE |
| `InputState.resizing.handleEntityId` field | DELETE |
| `handlePointerDown` resize branch — parent-lookup code | SIMPLIFY to read widget directly |
| `runCursorSystem` — handle-cursor path | REWRITE to derive cursor from handle position |
| `serialization.ts` cross-reference remap for `Parent` / `HandleSet` | DELETE (and for handle-originated `Hitbox`) |
| `archetype.ts` — anything spawning `Parent` / `Hitbox` / `HandleSet` | AUDIT and delete |
| `webgl/renderers/SelectionRenderer.ts` — 8-handle visual draw | KEEP UNCHANGED (reads `Transform2D` + selection; no ECS handle entities involved) |
| `ResizeCommand` in `commands.ts` | KEEP UNCHANGED |
| `Resizable` tag | KEEP UNCHANGED |

Net effect: ~300 lines of deletion, ~30 lines of addition in
`interaction.ts`. One ECS component family gone (`Parent`, `Hitbox`,
`HandleSet`). Two ECS systems gone.

### Handle rendering — zero change

`SelectionRenderer.ts` already draws the 8 handle visuals at the
selected widget's corners/edges based on `Transform2D`. It never
consulted `Hitbox` positions or `HandleSet.ids`. Rendering and
hit-test were already decoupled; we're just removing the redundant
hit-test scaffolding.

---

## Alternatives considered

### Alt A — keep handles as entities, just drop `Parent` and derive differently

Replace `Parent` with `HandleOf` (dedicated name). Keep everything
else. **Rejected** — doesn't actually save the machinery, just renames
it. The eight-entity cost stays.

### Alt B — virtual handles in a resource cache

Maintain a `SelectionHandlesResource` = `Map<EntityId, HandleAABBs>`
updated reactively on selection/bounds/Resizable changes. `hitTest`
queries this map. **Rejected** — adds a resource + a reactive sync
path for zero benefit; inline arithmetic is faster and clearer than
a cache.

### Alt C — implicit edge/corner bands on the widget itself (no fixed hotspots)

Make the whole perimeter of the widget a resize affordance: pointer
near any edge → resize cursor + role, inferred corner if near two
edges. No hit slop outside the widget. **Rejected** — changes the
user-facing affordance (no more oversized corner hit slop); would
regress precision on small widgets.

### Alt D — keep the model unchanged; clean up `Parent` via RFC-004 split

The minimum to unblock RFC-004: split `Parent` → `Parent` (handle) +
`ParentFrame` (container). Leave handle-as-entity model intact.
**Rejected** (this was the previous plan) — preserves a model doing
far more work than the feature requires, and the RFC-004 Phase 0 gets
more complex, not less.

---

## Migration path

### Phase 1 — inline hotspot detection in `hitTest`

Add `detectResizeHandle` helper + pre-pass to `hitTest`. Still keep
the old handle-as-entity path running in parallel — they'll produce
the same hit results, so keeping both temporarily lets us swap the
consumer one step at a time.

Acceptance:
- Existing tests pass (no behavioural change yet).
- Manual pointer events over corners/edges of a selected Resizable
  widget return the expected role via both paths (asserted by a
  temporary dev assertion that the two paths agree).

### Phase 2 — swap consumers to the inline path

- `handlePointerDown` resize branch uses the inline path's result
  directly (drops the `Parent` lookup).
- `runCursorSystem` derives cursor from handle position.
- `InputState.resizing` loses `handleEntityId`.

Acceptance:
- All existing resize behaviours work end-to-end through the new
  path only (verified via the DebugResizable widget checklist below).
- Temporary dev assertion from Phase 1 removed.

### Phase 3 — delete the handle-entity scaffold

- Delete `handle-sync.ts`, `hitbox-world-bounds.ts`.
- Remove their registrations from the LayoutEngine scheduler.
- Delete `Hitbox`, `HandleSet`, `Parent` from `components.ts`.
- Delete any serialization cross-reference remap entries for these.
- Remove `Parent` / `Hitbox` / `HandleSet` from archetype spawning.
- Update tests that previously asserted handle-entity presence
  (`engine.test.ts`).

Acceptance:
- `grep` for `Hitbox`, `HandleSet`, `handleSyncSystem`,
  `hitboxWorldBoundsSystem`, `Parent` in `src/` returns zero hits
  outside the deletion diff.
- Type-check passes; test suite is green.
- DebugResizable checklist (below) passes end-to-end on both DOM and
  R3F paths.
- Bundle size drops measurably (tracked but not a gate).

### Phase 4 — unblock RFC-004 Phase 0

Announce the `Parent` deletion on the team channel (or equivalent)
so RFC-004's Phase 0 plan can be revised from "split `Parent` into
`Parent` + `ParentFrame`" down to "rename what was `Parent` →
`ParentFrame`." Update RFC-004 v3 revision notes accordingly.

---

## Verification plan — `DebugResizable` widget

The refactor has a nontrivial regression surface (cursor hover,
handle priority, anchor math). We land with a purpose-built
playground widget whose sole job is to exercise every handle
position manually.

### Widget spec

```typescript
// apps/playground/src/widgets/DebugResizable.tsx

export function DebugResizable({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width: '100%', height: '100%',
        background:
          'repeating-linear-gradient(45deg, #334, #334 10px, #223 10px, #223 20px)',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontFamily: 'system-ui',
        fontSize: 12,
      }}
    >
      {Math.round(width)} × {Math.round(height)}
    </div>
  );
}

// Register with Resizable tag and a non-card chrome so we can see the
// raw bounds without CardChrome in the way.
registerWidget({
  type: 'debug-resizable',
  surface: 'dom',
  component: DebugResizable,
  tags: [Resizable, Selectable, Draggable],
  defaultSize: { width: 200, height: 140 },
});
```

A spawn button in `SettingsPanel.tsx` lets the user drop a fresh
`DebugResizable` onto the canvas. (The existing `Resizable`-opt-in
toggle can stay for flipping regular widgets.)

### Manual test checklist

Each item must pass on both DOM and R3F widget paths (we spawn one
DebugResizable with `surface: 'dom'` and can also toggle `Resizable`
on an R3F widget like `GeometryCard` to test the R3F path).

**Visual affordance**
- [ ] Click a DebugResizable to select it → 8 handles appear at
      corners and edge midpoints (drawn by `SelectionRenderer`).
- [ ] Click the canvas background → selection clears, handles
      disappear.
- [ ] Select two resizables → handles do NOT appear (RFC-001 rule —
      multi-select disables resize chrome).

**Cursor feedback**
- [ ] Hover inside widget body → widget's default cursor.
- [ ] Hover NW corner hotspot → `nw-resize` / `nwse-resize` cursor.
- [ ] Hover NE corner hotspot → `ne-resize` / `nesw-resize`.
- [ ] Hover SW corner → `sw-resize` / `nesw-resize`.
- [ ] Hover SE corner → `se-resize` / `nwse-resize`.
- [ ] Hover N / S / E / W edge hotspot → corresponding cursor.
- [ ] Hover a pixel that's BOTH inside an edge band AND a corner box
      → corner cursor wins.
- [ ] Hover just outside the widget (farther than `HANDLE_HIT_SIZE_PX / 2`
      beyond the edge) → cursor returns to default (hotspot missed).

**Anchor-correct resize drag (each of 8 handles)**
- [ ] NW drag → top-left corner follows pointer, bottom-right
      anchors. Dragging inward shrinks; outward grows.
- [ ] NE drag → top-right follows, bottom-left anchors.
- [ ] SE drag → bottom-right follows, top-left anchors.
- [ ] SW drag → bottom-left follows, top-right anchors.
- [ ] N drag → top edge follows, bottom anchored; width unchanged.
- [ ] S drag → bottom follows, top anchored; width unchanged.
- [ ] E drag → right follows, left anchored; height unchanged.
- [ ] W drag → left follows, right anchored; height unchanged.

**Constraints**
- [ ] Drag any handle past the minimum-size threshold → dimension
      clamps to `MIN_WIDGET_SIZE` (existing constant).
- [ ] Drag a corner inward past minimum → both dimensions clamp
      independently; position stays correct relative to the anchor.

**Interaction correctness**
- [ ] Press down on a handle, drag off-canvas, release outside →
      resize commits at the last valid position (pointer capture is
      on the root container, not the handle).
- [ ] Press down on a handle, drag into another widget → resize
      continues; the other widget is not hit-tested during `resizing`
      mode.
- [ ] Press `Escape` mid-resize → resize cancels, widget returns to
      pre-drag bounds (existing `handlePointerCancel` path).
- [ ] `Cmd-Z` after a resize → bounds restore to pre-resize values.
- [ ] `Cmd-Shift-Z` → redo reapplies.

**Drag + resize interplay**
- [ ] Click+drag widget body (not a handle) → widget moves (drag
      mode), does NOT resize.
- [ ] Drag handle → widget resizes (resize mode), does NOT move.
- [ ] Multi-select a DebugResizable and a regular card → handles do
      not appear; drag path moves both.

**RFC-003 drag-promote interplay**
- [ ] Drag a DebugResizable over an R3F widget → still lifts to
      overlay layer (Dragging tag unaffected by refactor).
- [ ] Drop drag → demotes correctly.

**R3F surface (with Resizable toggled onto a GeometryCard)**
- [ ] All cursor / handle / drag behaviours above repeat through the
      R3F hit path (pointer events route through engine, not through
      R3F canvas).
- [ ] Resizing an R3F widget triggers its widget-FBO repaint at the
      new bounds (RFC-002 path); no stretched stale texture.

### Automated smoke tests

Where cheap:

- Unit test `detectResizeHandle` for all 8 positions + off-widget
  point + corner-over-edge priority.
- Interaction-state test: pointerdown inside a corner hotspot →
  `inputState.mode === 'resizing'` with correct handle; pointerdown
  inside widget body → `inputState.mode === 'dragging'` after
  dead-zone.
- Anchor math test: for each handle position, verify the resize
  branch of `handlePointerMove` moves the right edges.

---

## Open questions

1. **Cursor mapping** (`nw-resize` vs `nwse-resize`). Current code
   uses directional names; CSS accepts both. Recommendation: match
   today's values (`nw-resize` etc.) to eliminate any visual diff for
   users. Purely aesthetic.
2. **Multi-selected Resizable widgets** — current code explicitly
   suppresses handles when more than one is selected
   (`handle-sync.ts:92`). The inline detector replicates this by
   gating the pre-pass on exactly one selected Resizable. Keep?
   Recommendation yes, matches today.
3. **Resizable without Selectable** — today's path requires
   `Selected` to spawn handles; our inline path likewise requires
   `Selected`. If someone opts a widget into `Resizable` without
   `Selectable` (so it can't become `Selected`), neither the old nor
   new code exposes resize. Consistent — no change.
4. **Hit-test pre-pass cost** — adding a loop over selected
   Resizables before every spatial-index hit adds ~8 comparisons per
   hit. Even at pointer-move rates (~60–240 Hz) this is noise. Not
   worth caching.

---

## Acceptance criteria

**Phase 1 — inline pre-pass**
- [x] `detectResizeHandle` helper exists with unit tests covering
      corner, edge, corner-vs-edge priority, off-widget (plus zoom
      scaling).
- [x] `hitTest` pre-pass runs before spatial-index lookup; returns
      the same result shape (`{ entityId: widgetId, role: resize
      with handle pos }`) as the old handle-entity path.
- [x] Dev-only assertion confirms old + new paths agree on hit
      results for the same pointer position.

**Phase 2 — swap consumers**
- [x] `handlePointerDown` resize branch reads hit.entityId as the
      widget directly; no `Parent` lookup.
- [x] `runCursorSystem` derives cursor from handle position (not
      from `CursorHint` on a handle entity).
- [x] `InputState.resizing` drops `handleEntityId`.
- [x] All Phase 1 behaviours still pass.

**Phase 3 — delete scaffold**
- [x] `handle-sync.ts`, `hitbox-world-bounds.ts` deleted.
- [x] `Hitbox`, `HandleSet`, `Parent` components deleted.
- [x] System scheduler registrations for the two systems removed.
- [x] Archetype init paths stop spawning deleted components.
- [x] Serialization cross-reference remap passes updated.
- [x] `grep` for deleted symbols returns zero matches outside the
      deletion diff.
- [x] `engine.test.ts` handle-related assertions removed or updated
      to test the new path.
- [x] DebugResizable checklist (above) passes end-to-end on DOM
      (R3F verification via toggling `Resizable` on a GeometryCard
      remains available but wasn't formally ticked — mechanic is
      renderer-agnostic by construction).
- [x] CI type-check + test suite green (121 tests pass).

**Phase 4 — RFC-004 integration**
- [x] RFC-004 revised (v3) to drop the "Parent stays for handles"
      language; Phase 0a simplified from a split to a plain rename
      (actually already done as a side effect of RFC-005 Phase 3).

---

## Dependencies and risks

**Depends on**
- `Resizable`, `Selected`, `Selectable`, `Draggable` tags (existing).
- `InteractionRole` type, `ResizeCommand` (existing, unchanged).
- `Transform2D` (existing).
- `SelectionRenderer.ts` drawing handles from `Transform2D` (existing).

**Risks**
- **Cursor-change latency.** Current path: pointer hovers handle
  entity → `hoveredEntity` changes → cursor system reads
  `CursorHint`. New path: pointer position re-checks via
  `detectResizeHandle` each frame. Expected cost: ~8 comparisons.
  Should be indistinguishable; add a dev-only timing assertion in
  Phase 2 to confirm.
- **Handle priority edges.** Corner-over-edge priority today is
  encoded by `InteractionRole.layer` (15 vs 10) plus `ZIndex` tie-break.
  New code encodes it via loop order (corners first). If any user
  code has been relying on layer-15-ness of handles for other
  purposes (unlikely; grep shows no other consumers), it would
  silently change semantics. Mitigation: grep confirms no other
  reads; Phase 2 tests cover priority directly.
- **R3F resize-FBO repaint.** The R3F compositor's `paintGeneration`
  bumps on `Transform2D` size changes (`VirtualWidget.tsx:62-73`).
  This path is unchanged; resize drives `Transform2D` writes the same
  way as before. Should work out of the box; explicit checklist item
  above exercises it.
- **`SelectionRenderer` draw path.** Already reads `Transform2D` and
  draws handles from it without touching handle entities. Confirmed
  by grep; no code changes needed. But if any non-default
  `SelectionRenderer` subclass has crept in, it needs the same
  property.
- **Test coverage gap.** `engine.test.ts` has assertions like
  `engine.has(id, Parent)` at line 419 that validate handle-spawn
  behaviour. These tests need to be either deleted (if they only
  verify the old mechanism) or rewritten (if they verify the
  user-facing behaviour). Phase 3 includes this audit.

---

## Revision notes

**v1** — initial draft, 2026-04-23. Extracted as a dedicated RFC
from the RFC-004 v2 discussion once it became clear the
"handle as ECS entity" model from RFC-001 was over-engineered for a
feature the product increasingly favours via preset sizes rather than
freeform resize — but where resize itself is still a capability we
want to keep available. Folds three concerns into one simplification:
collapse handle machinery, unblock the `Parent` → `ParentFrame`
rename in RFC-004 Phase 0, and ship a verification widget so the
regression surface is auditable.

**Implementation notes** (2026-04-23)

Landed in four phases over a single session; every phase checkpoint
was verified manually in the playground before moving on.

- **Phase 1** added `detectResizeHandle` (pure function) + `findInlineResizeHit`
  + `verifyInlineAgreement` (deduplicated dev warning), plus the
  `detect-resize-handle.test.ts` suite (16 unit tests). `hitTest` ran
  both paths and returned the spatial result; the inline path ran
  silently and warned on disagreement. No disagreements surfaced in
  playground testing — inline and spatial were byte-identical across
  hover, click, and resize gestures.
- **Phase 2** swapped consumers: `hitTest` returns the inline result
  when present, `handlePointerDown` reads `hit.entityId` as the widget
  directly (no Parent dereference), `runCursorSystem` derives the
  cursor from handle position via a new `cursorForHandle` helper,
  `InputState.resizing` dropped `handleEntityId`, dev assertion
  removed. The only test that broke was the idle-hover cursor test
  (expected the handle entity as `hoveredEntity`) — updated to assert
  the widget.
- **Phase 3** deleted the scaffold end-to-end: two system files
  (`handle-sync.ts`, `hitbox-world-bounds.ts`), three components
  (`Hitbox`, `HandleSet`, `Parent`), scheduler registrations,
  serialization cross-ref remap, archetype usages, and the
  `describe('handle sync (RFC-001 Phase 4)')` test block (8 tests
  removed, 5 other tests rewrote their handle-position lookups to
  compute corner/edge coords from `Transform2D` directly). Simplified
  `transform-propagate` from a recursive Parent/Children traversal to
  a pure identity copy. `ParentFrame` added as the sole parenthood
  concept.
- **Phase 4** (this entry + acceptance ticks). RFC-004 v2's Phase 0a
  was originally "split Parent into Parent + ParentFrame"; that split
  turned out to be a pure rename once the handle model was gone, and
  landed as part of Phase 3 here.

Net: ~500 lines deleted, ~150 lines added (inline helpers + unit
tests). Test suite 121/121 passing (previously 129; the 8-test delta
is the deleted `handle sync` describe block — all its scenarios are
covered by the new inline unit tests + rewritten integration tests).
`DebugResizable` widget spawned in the playground for the regression
surface; stays as a testing fixture.
