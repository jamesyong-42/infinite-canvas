# RFC-004: Card Interaction & Hierarchy

- **Status**: Draft v3
- **Author**: James Yong
- **Date**: 2026-04-23
- **Area**: Interaction / Hierarchy / ECS / Rendering
- **Related**: RFC-002 (R3F compositor — adds three uniforms to
  `CompositionMaterial`), RFC-003 (Card as single source of truth;
  reuses `Dragging` / layer / `uDraggedRect` machinery verbatim),
  **RFC-005 (prerequisite — deleted the handle sub-entity model,
  which collapsed Phase 0a's planned `Parent` split into a pure rename
  to `ParentFrame`; already landed)**
- **Supersedes**: RFC-004 v2 (post-RFC-005 revision — Phase 0a
  reduced to a completed rename, Phase 0b simplifies. RFC-004 v1
  was the pre-hierarchy-foundation draft; v2 folded in the hierarchy
  and navigation foundation. See "Revision notes")

---

## Summary

A drag-and-drop mechanic for `Card`-tagged widgets, plus the ECS
foundation for an **infinite hierarchy of nested canvases** that
containers live in. One coherent RFC because consume-into-container is
the canonical use case of the hierarchy, and implementing either half
without the other leaves the engine in an awkward intermediate state.

Three cooperating layers, each independently meaningful:

1. **Hierarchy foundation (Phase 0).** Rename `Parent` (now used only
   for container hierarchy) to `ParentFrame` — already done as part
   of RFC-005 Phase 3, since RFC-005's deletion of the handle
   sub-entity model left `Parent` with only one remaining consumer.
   Delete `WorldBounds` and `transform-propagate`; unify every
   rect-shaped entity on `Transform2D`. Move per-container camera
   state onto a serialized `ContainerCamera` component. Drop the
   per-frame camera from `NavigationStackResource`. The existing
   `Container` / `enterContainer` / `exitContainer` /
   `navigationFilterSystem` code keeps working — just reading from
   a cleaner data model.
2. **Drop-to-consume mechanic.** When the user drags one card over
   others:
   - Every overlapped card shows a **position-dependent radial glow**
     centred on the intersection area (Layer 1 — proximity detected).
   - The card closest by centre-to-centre distance becomes the
     **primary**. If contracts match, the primary gets a second,
     stronger cue (Layer 2 — drop now to consume).
   - On release:
     - **Consume** if primary exists and contracts match — primary's
       handler describes the mutation (re-parent, destroy, merge…).
     - **Fly back** to pre-drag position if primary exists and
       contracts don't match, via a new generic `TransformTween`.
     - **Normal move** otherwise.
3. **Worked example — `CardContainer`.** A first-class widget whose
   `onReceiveChild` handler adopts the dropped card into its
   `ContainerChildren` set. Double-click enters the container via
   `engine.enterContainer(...)`; the hierarchy filter makes the
   container's children the new active set. Back navigation restores
   the parent frame; the container's camera state persists via its
   `ContainerCamera`. Containers nested inside containers work the same
   way with no special handling.

Non-card widgets don't participate in the consume mechanic. Non-card
overlap is still allowed at rest. Spawn/paste empty-area placement is
deferred to a follow-up RFC.

---

## Motivation

### Today

Cards don't interact with each other. Dragging a card across others
produces silent overlaps at rest. Simultaneously, the codebase has a
pre-emptive hint of a container hierarchy — `Container` component,
`engine.enterContainer(...)`, `NavigationStackResource`,
`navigationFilterSystem` — wired through an overloaded `Parent`
component whose coord-space accumulation behaviour was designed for
handles (RFC-001) but silently applies to container children as well.

Both problems resolve with the same architectural move: **treat every
container as its own canvas, with its own camera and its own local
coord system, reached through a stack of navigation frames.** Handles
remain coord-space children of their parent widget; container children
are independent entities that happen to be filtered in/out by the
current frame. Two different parenthood semantics, two components.

Once the foundation is clean, drop-to-consume falls out naturally —
it's just a drop handler that writes `ParentFrame` on the child and
appends to `ContainerChildren` on the parent. Navigation does the rest.

### What this RFC is not

- **Not an arbitrary relationship graph between widgets.** Only
  drop-to-consume. Other inter-widget wirings (pipes, links,
  subscriptions) are separate features.
- **Not spawn-time empty-area placement.** The "fly-back on mismatch"
  rule gives card-on-card cleanliness without a solver. Spawn/paste
  placement is its own follow-up.
- **Not tied to a specific container implementation.** `CardContainer`
  is the worked example; other authors can write containers with
  different consume semantics (merge, destroy, transform) or different
  body UI (thumbnail preview, count badge, mini-map).
- **Not a change to undo semantics.** Data edits (including consume)
  stay in the command buffer and are undoable. Navigation (push/pop
  frame) is view-state and deliberately separate from the undo stack,
  following the Figma / Finder / iOS model.

---

## Proposal

### Phase 0 — ECS foundation (hierarchy, Transform2D unification, container camera)

#### `ParentFrame` (done via RFC-005)

v2 of this RFC specced a split of the overloaded `Parent` component
into `Parent` (handles) + `ParentFrame` (container children). RFC-005
landed first and deleted the handle sub-entity model entirely —
which left `Parent` with only one remaining consumer (container
hierarchy) and collapsed the split into a pure rename. That rename
landed as part of RFC-005 Phase 3.

State as of RFC-004 v3:

- `ParentFrame` exists and means "this entity lives in the container's
  sub-canvas frame." Its `Transform2D` is in the container's local
  coord system; no accumulation.
- `Parent`, `Hitbox`, `HandleSet` are gone — no code path references
  them.
- `navigation-filter.ts`, `engine.create({ parent })`, serialization,
  and container tests all read/write `ParentFrame`.

No further work needed for this subsection — tick the box.

#### Delete `WorldBounds` and `transform-propagate`; unify on `Transform2D`

After RFC-005, `transform-propagate` is a pure identity copy from
`Transform2D` to `WorldBounds` (its recursive parent-chain
accumulation was removed when `Parent` went away). That leaves
`WorldBounds` as a redundant shadow of `Transform2D` with no distinct
role. Phase 0b finishes the job.

Every rect-shaped ECS entity carries `Transform2D` directly. Handles
no longer exist as entities (RFC-005), so there's nothing to derive
— no `handleBoundsSystem`, no `Hitbox + Parent` query.

Everything that reads `WorldBounds` today switches to `Transform2D`.
Field renames: `worldX` → `x`, `worldY` → `y`, `worldWidth` → `width`,
`worldHeight` → `height`.

Consumers to migrate (all mechanical):

- `LayoutEngine.ts` spatial-index observer —
  `onComponentChanged(WorldBounds, …)` → `onComponentChanged(Transform2D, …)`.
- `systems/cull.ts` — read `Transform2D`; `worldBoundsToAABB` helper
  renamed to `transformToAABB` or inlined.
- R3F `Compositor.tsx` — `getComponent(eid, WorldBounds)` →
  `getComponent(eid, Transform2D)`.
- DOM slot rAF updater in `InfiniteCanvas.tsx` — reads position from
  `Transform2D`.
- `spatial/snap.ts` snap-guide ref collection — reads `Transform2D`.
- `engine/interaction.ts` hit-test already uses the spatial index, not
  `WorldBounds` directly — no change.

Delete: `components.ts` `WorldBounds` export,
`systems/transform-propagate.ts`, the `transformPropagate` entry in
the system scheduler. Remove any residual `after: 'transformPropagate'`
scheduler deps.

#### `ContainerCamera` + simplified `NavigationStackResource`

Today each `NavigationFrame` carries `{ containerId, camera }` — the
camera state is stored in the stack. v2 moves the camera onto the
container entity itself, where it naturally belongs:

```typescript
export interface ContainerCameraData { x: number; y: number; zoom: number; }
export const ContainerCamera = defineComponent<ContainerCameraData>(
  'ContainerCamera', { x: 0, y: 0, zoom: 1 },
);
```

Serialized (persistent — containers remember their view state across
reloads). Present on every `Container`-tagged entity; default-added via
an archetype observer when `Container` is added.

Root-canvas camera state lives on its own resource, symmetric with
`ContainerCamera` but for the one-and-only root:

```typescript
export const RootCameraResource = defineResource<ContainerCameraData>(
  'RootCamera', { x: 0, y: 0, zoom: 1 },
);
```

Serialized.

`NavigationStackResource.frames` drops its camera field:

```typescript
export interface NavigationFrame { containerId: EntityId | null; }
export const NavigationStackResource = defineResource<{
  frames: NavigationFrame[];
  changed: boolean;
}>('NavigationStack', {
  frames: [{ containerId: null }],
  changed: false,
});
```

`NavigationStackResource` is **not** serialized — on load, the user
returns to the root canvas. (A "restore last-session view" feature can
be added later as a separate serialized `NavigationHistoryResource` if
product wants it.)

`enterContainer` / `exitContainer` logic is reshaped around the new
storage:

```typescript
enterContainer(entity: EntityId) {
  if (!world.hasComponent(entity, Container)) return;

  // Persist outgoing frame's camera to its home.
  const outgoing = navStack.frames[navStack.frames.length - 1].containerId;
  const live = world.getResource(CameraResource);
  if (outgoing === null) {
    world.setResource(RootCameraResource, { ...live });
  } else {
    world.setComponent(outgoing, ContainerCamera, { ...live });
  }

  // Push.
  navStack.frames.push({ containerId: entity });
  navStack.changed = true;

  // Restore incoming container's camera.
  const incoming = world.getComponent(entity, ContainerCamera)
                ?? { x: 0, y: 0, zoom: 1 };
  world.setResource(CameraResource, { ...incoming });

  interaction.clearSelection();
  markDirtyInternal();
}

exitContainer() {
  if (navStack.frames.length <= 1) return;

  // Persist outgoing container's camera.
  const outgoing = navStack.frames[navStack.frames.length - 1].containerId!;
  const live = world.getResource(CameraResource);
  world.setComponent(outgoing, ContainerCamera, { ...live });

  // Pop.
  navStack.frames.pop();
  navStack.changed = true;

  // Restore parent frame's camera.
  const parent = navStack.frames[navStack.frames.length - 1].containerId;
  const incoming = parent === null
    ? world.getResource(RootCameraResource)
    : (world.getComponent(parent, ContainerCamera)
       ?? { x: 0, y: 0, zoom: 1 });
  world.setResource(CameraResource, { ...incoming });

  interaction.clearSelection();
  cameraChangedThisTick = true;
  markDirtyInternal();
}
```

Runtime pan/zoom continues to mutate `CameraResource` directly; the
snapshot happens on `enterContainer` / `exitContainer`. No per-frame
component writes.

#### Cycle prevention for container consume

`ParentFrame` makes an ancestor walk trivial:

```typescript
export function isFrameAncestorOf(
  world: World,
  ancestor: EntityId,
  candidate: EntityId,
): boolean {
  let cur: EntityId | null = candidate;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = world.getComponent(cur, ParentFrame)?.id ?? null;
  }
  return false;
}
```

`CardContainer`'s default `canAccept` uses this: reject if the dragged
entity is an ancestor of the parent in the frame tree. Other container
widgets compose their own gates over the default.

### Phase 1 — extend `Card` with contract data

```typescript
export interface CardData {
  background: string;                // existing
  accepts: readonly string[];        // NEW — contracts this card receives as parent
  provides: readonly string[];       // NEW — contracts this card offers as child
}

export const Card = defineComponent<CardData>('Card', {
  background: '#fff',
  accepts: [],
  provides: [],
});
```

Defaults preserve today's behaviour. Cards with empty `accepts` /
`provides` participate in the visual overlap pass (they glow when
another card hovers them) but never consume and are never consumed —
contract match always fails. Decorative cards stay "alive" without
committing to a mechanic.

### Phase 1 — widget-type interaction handlers

Handlers live on the widget type, not the entity — keeps `Card`
serializable and shares behaviour across instances.

```typescript
export interface WidgetInteractionHandlers {
  /** Parent-side: what happens when a child is dropped on me. */
  onReceiveChild?(ctx: {
    parent: EntityId;
    child: EntityId;
    world: World;
  }): { consume: boolean; mutation?: unknown };

  /** Child-side: side effects or veto. */
  onDroppedOnParent?(ctx: {
    child: EntityId;
    parent: EntityId;
    world: World;
  }): { veto: boolean } | void;

  /** Optional parent-side runtime gate on top of the static `accepts`
   *  / `provides` intersection. Example: "container is full." */
  canAccept?(ctx: {
    parent: EntityId;
    child: EntityId;
    world: World;
  }): boolean;

  /** Apply the mutation returned by onReceiveChild (forward). */
  applyMutation?(world: World, mutation: unknown): void;

  /** Reverse the mutation (undo). */
  revertMutation?(world: World, mutation: unknown): void;
}
```

Registered alongside `component` / `surface` / `card` at
`registerWidget(...)` time.

### Phase 2 — `TransformTween` component + system

Generic animated transition of `Transform2D`. Used for fly-back here,
reusable for any future animated position transition.

```typescript
export type TweenEasing = 'linear' | 'ease-out' | 'ease-in-out' | 'spring';

export interface TransformTweenData {
  fromX: number; fromY: number;
  toX: number; toY: number;
  startMs: number;
  durationMs: number;
  easing: TweenEasing;
  /** Discriminator for downstream observers ('flyback', 'snap', 'spawn'). */
  kind: string;
}

export const TransformTween = defineComponent<TransformTweenData>(
  'TransformTween',
  {
    fromX: 0, fromY: 0, toX: 0, toY: 0,
    startMs: 0, durationMs: 250, easing: 'ease-out', kind: 'generic',
  },
);
```

System (replaces the deleted `transform-propagate`):

```typescript
export const transformTweenSystem = defineSystem({
  name: 'transformTween',
  execute: (world) => {
    const nowMs = performance.now();
    for (const entity of world.queryComponents(TransformTween)) {
      const t = world.getComponent(entity, TransformTween);
      const x2d = world.getComponent(entity, Transform2D);
      if (!t || !x2d) {
        if (t) world.removeComponent(entity, TransformTween);
        continue;
      }
      const elapsed = nowMs - t.startMs;
      if (elapsed >= t.durationMs) {
        world.setComponent(entity, Transform2D, {
          ...x2d, x: t.toX, y: t.toY,
        });
        world.removeComponent(entity, TransformTween);
        continue;
      }
      const p = applyEasing(elapsed / t.durationMs, t.easing);
      world.setComponent(entity, Transform2D, {
        ...x2d,
        x: t.fromX + (t.toX - t.fromX) * p,
        y: t.fromY + (t.toY - t.fromY) * p,
      });
    }
  },
});
```

Runs before `handleSync` so a tweened widget's handles track the tween
positions live. One tween per entity at a time — a new tween on an
entity with one already active overwrites. Runtime-only; not serialized.

### Phase 3 — overlap detection

Driven from the interaction runtime's pointermove handler, not
auto-scheduled. The state is drag-scoped and belongs next to the drag
state machine.

Trigger: `inputState.mode === 'dragging'` AND the dragged entity has
`Card`. Otherwise the overlap pass is skipped entirely.

Per pointermove:

```
draggedAABB = transformToAABB(dragged.Transform2D)
candidates  = spatialIndex.search(draggedAABB)
                .filter(c => c.id !== dragged && world.hasComponent(c.id, Card))

// Tag diff.
prev = world.queryTagged(OverlapCandidate)
enter = candidates \ prev
exit  = prev \ candidates
for c in enter:
  world.addTag(c, OverlapCandidate)
  world.addComponent(c, CardOverlapHotPoint, { x: 0.5, y: 0.5, strength: 0 })
for c in exit:
  world.removeTag(c, OverlapCandidate)
  scheduleFadeOut(c)    // strength → 0 over ~150 ms, component removed at 0

// Hot point + strength per candidate.
for c in candidates:
  isect = intersect(draggedAABB, transformToAABB(c.Transform2D))
  cx = (isect.minX + isect.maxX) / 2
  cy = (isect.minY + isect.maxY) / 2
  hotX = (cx - c.Transform2D.x) / c.Transform2D.width    // always in [0,1]
  hotY = (cy - c.Transform2D.y) / c.Transform2D.height
  world.setComponent(c, CardOverlapHotPoint, {
    x: hotX, y: hotY,
    strength: approach(current.strength, 1, dtMs, 150),
  })

// Primary + match.
primary = candidates.minBy(c => centreDistance(dragged, c)) ?? null
  // Tie-break: higher ZIndex wins; then entity id asc as deterministic tail.

match = primary
  && intersection(dragged.Card.provides, primary.Card.accepts).length > 0
  && (handlers(primary).canAccept?.({ parent: primary, child: dragged, world }) ?? true)

// OverlapTarget reconcile.
currentTarget = world.queryTagged(OverlapTarget)[0] ?? null
if match && currentTarget !== primary:
  if currentTarget: world.removeTag(currentTarget, OverlapTarget)
  world.addTag(primary, OverlapTarget)
elif !match && currentTarget:
  world.removeTag(currentTarget, OverlapTarget)
```

The intersection centroid is always inside both AABBs, so `hotX` /
`hotY` ∈ [0, 1] without clamping. The dragged entity is excluded from
`candidates` by construction, so it never carries any of the three
overlap markers.

Tag/component churn per move: `O(k)` where `k` = overlapping card
count (typically ≤ 5). Cheap at 60–120 Hz.

### Phase 3 — two-layer visual state

- **`OverlapCandidate` tag** — "a dragged card is hovering me." Layer
  1. Set on every card in the current overlap set.
- **`OverlapTarget` tag** — "I'm the primary and contracts match."
  Layer 2. Set on at most one card at a time.

Both transient — added and removed during drag, never serialized.

**`CardOverlapHotPoint` component** — the glow-position data for each
candidate card. Runtime-only.

```typescript
export interface CardOverlapHotPointData {
  x: number;        // intersection centroid, local (0..1)
  y: number;
  strength: number; // 0..1, ramped in on enter, out on exit over ~150 ms
}
export const CardOverlapHotPoint = defineComponent<CardOverlapHotPointData>(
  'CardOverlapHotPoint', { x: 0.5, y: 0.5, strength: 0 },
);
```

No third "rejection" state. A card with `OverlapCandidate` but no
`OverlapTarget` tells the user "you're over me but release won't
consume." Release confirms via fly-back.

**DOM rendering — `CardChrome`** reads `CardOverlapHotPoint` via an ECS
hook and writes CSS custom properties + data attributes:

```tsx
<div
  className="card-chrome"
  data-overlap-candidate={hasOverlapCandidate || undefined}
  data-overlap-target={hasOverlapTarget || undefined}
  style={{
    '--hot-x': `${(hot?.x ?? 0.5) * 100}%`,
    '--hot-y': `${(hot?.y ?? 0.5) * 100}%`,
    '--hot-strength': hot?.strength ?? 0,
  }}
>
  {children}
</div>
```

```css
.card-chrome { position: relative; overflow: hidden; }

/* Layer 1 — glow */
.card-chrome::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    circle 240px at var(--hot-x, 50%) var(--hot-y, 50%),
    rgba(255, 255, 255, 0.28),
    transparent 70%
  );
  opacity: var(--hot-strength, 0);
  mix-blend-mode: screen;
  border-radius: inherit;
  transition: opacity 150ms ease;
}

/* Layer 2 — match confirmed */
.card-chrome[data-overlap-target]::after {
  content: '';
  position: absolute;
  inset: -2px;
  pointer-events: none;
  border-radius: inherit;
  box-shadow:
    0 0 0 2px rgba(99, 179, 237, 0.9),
    0 0 24px 4px rgba(99, 179, 237, 0.55);
  animation: overlap-target-pulse 1.2s ease-in-out infinite;
}

@keyframes overlap-target-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1;    }
}
```

**R3F rendering — `CompositionMaterial`** gains three uniforms per
quad, alongside existing `uDraggedRect` / `uIsDragged`:

```glsl
uniform vec2  uHotPoint;          // normalized 0..1, same frame as vUv
uniform float uHotStrength;       // 0..1
uniform float uIsOverlapTarget;   // 0 or 1
```

Fragment body after the existing sample + `uDraggedRect` discard:

```glsl
vec4 c = texture2D(map, vUv);
if (c.a < 0.001) discard;

// Layer 1 — intersection glow.
vec2  toHot = vUv - uHotPoint;
float d     = length(toHot);
float glow  = smoothstep(0.45, 0.0, d) * uHotStrength;
c.rgb = min(c.rgb + vec3(0.22) * glow, vec3(1.0));

// Layer 2 — match rim.
if (uIsOverlapTarget > 0.5) {
  float rim = smoothstep(0.48, 0.5, d) * 0.7;
  c.rgb = min(c.rgb + vec3(0.35) * rim, vec3(1.0));
}

gl_FragColor = c;
```

Compositor `useFrame` reads each quad's entity's
`CardOverlapHotPoint` and `OverlapTarget` state and writes the uniforms
in the same loop that already writes `uDraggedRect` / `uIsDragged`.

### Phase 4 — drop outcome + fly-back

Inside the existing dragging-mode branch of `handlePointerUp`:

```
if (!world.hasComponent(dragged, Card) || overlapping.length === 0) {
  // Normal move — commit the existing MoveCommand path.
  commitDragMove()
  return
}

primary = <computed by last pointermove>
match   = <computed by last pointermove>

if (primary && match) {
  // Consume — grouped with a MoveCommand so single undo restores pre-drag state.
  const h = handlers(primary)
  const r = h.onReceiveChild!({ parent: primary, child: dragged, world })
  if (!r.consume) { flyBack(); return }

  commandBuffer.beginGroup()
  commandBuffer.execute(new MoveCommand(dragged, startPos, dropPos))
  commandBuffer.execute(new ConsumeCommand(
    primary,
    dragged,
    snapshotEntity(world, dragged),
    r.mutation,
  ))
  commandBuffer.endGroup()

  clearOverlapState()
  world.removeTag(dragged, Dragging)   // cascades layer / ZIndex / uDraggedRect restore
  inputState = { mode: 'idle' }
} else {
  flyBack()
}
```

`flyBack()`:

```
world.addComponent(dragged, TransformTween, {
  fromX: current.x, fromY: current.y,
  toX:   startPos.x, toY:   startPos.y,
  startMs: performance.now(),
  durationMs: 250,
  easing: 'ease-out',
  kind: 'flyback',
})
clearOverlapState()
// Dragging stays set — widget must remain visually on top for the animation.
inputState = { mode: 'flyingBack', entityId: dragged }
```

Per-tick completion poll in the interaction runtime (runs after
`transformTweenSystem`):

```
if (inputState.mode === 'flyingBack') {
  if (!world.hasComponent(inputState.entityId, TransformTween)) {
    world.removeTag(inputState.entityId, Dragging)
    inputState = { mode: 'idle' }
    markDirty()
  }
}
```

Removing `Dragging` cascades:

- `dragPromoteSystem` restores `Layer` to its pre-drag value (RFC-003).
- The interaction runtime restores the pre-drag `ZIndex`.
- The compositor clears `uDraggedRect` / `uIsDragged` / `renderOrder`.
- Chrome's CSS lift transition reverses.

**Fly-back interruption.** If the user presses down on the flying card
mid-animation, the pointerdown path:

1. Detects `inputState.mode === 'flyingBack'` on this entity.
2. Removes the `TransformTween` (the current animated position becomes
   the new drag start).
3. Transitions `inputState` to `'tracking'` / `'dragging'` as usual.
4. `Dragging` is already set — no layer churn, no ZIndex churn, no
   compositor flicker. Seamless.

### Phase 4 — `ConsumeCommand`

```typescript
export class ConsumeCommand implements Command {
  constructor(
    public readonly parentId: EntityId,
    public readonly childId: EntityId,
    public readonly childSnapshot: EntitySnapshot,   // components + tags
    public readonly mutation: unknown,               // opaque payload
  ) {}

  execute(world: World, registry: WidgetRegistry) {
    const type = world.getComponent(this.parentId, Widget)?.type;
    registry.get(type)?.interaction?.applyMutation?.(world, this.mutation);
  }

  undo(world: World, registry: WidgetRegistry) {
    const type = world.getComponent(this.parentId, Widget)?.type;
    registry.get(type)?.interaction?.revertMutation?.(world, this.mutation);
    if (!world.entityExists(this.childId)) {
      rehydrateEntity(world, this.childId, this.childSnapshot);
    }
  }
}
```

`applyMutation` / `revertMutation` are author-supplied. A container
widget's mutation re-parents the child (sets `ParentFrame`, appends to
`ContainerChildren`); a trash-bin widget's mutation destroys the child
(snapshot stored in the command for undo). The framework doesn't
privilege either pattern — it just wraps whatever the author writes
and captures a defensive snapshot for undo.

Grouping with a preceding `MoveCommand` means one undo press returns
the user to the exact pre-drag state (child visible at starting
position, parent unchanged).

---

## Alternatives considered

### Alt A — keep `Parent` overloaded, gate `transform-propagate` on `Container` tag

Single component, two modes, handled by a runtime check in
`transform-propagate`. **Rejected** — preserves the dual use in the
type system and in serialization; adds a magic gate that future readers
will miss; doesn't simplify `WorldBounds` away. Clean component split
makes the semantics explicit, deletes more code than it adds.

### Alt B — keep `WorldBounds` as a shadow of `Transform2D`

Run an identity system writing `WorldBounds = Transform2D`. Zero
consumer-side churn. **Rejected** — two components with identical
content is exactly the kind of dead abstraction this RFC is supposed
to clear out. The consumer migration (~15 call sites) is straight
field renames, all mechanical.

### Alt C — `Interactable` as a separate component, not on `Card`

Decouples the interaction mechanic from `Card`. **Rejected.** RFC-003 v3
explicitly made `Card` the single source of truth for card-shaped
behaviour. Drop-to-consume is card-shaped. Allowing non-card
interactables would fragment the visual vocabulary (what does the
glow look like on a non-card?). If a future non-card widget needs
drop-to-consume, add `Card` with `chrome: 'none'` — still cheaper than
a second mechanic.

### Alt D — centre-in-parent primary rule

Only cards whose AABB contains the dragged card's centre are eligible
primaries. **Rejected** — pure closest-centre is simpler, edge-drops
still work, fewer "I almost had it" misses. If accidental consumes
show up in telemetry, add a minimum overlap-area gate rather than
reintroduce the stricter rule.

### Alt E — nearest-empty-spot on mismatch

Auto-relocate the dragged card on non-match. **Rejected.** Search
algorithm is complex (obstacles, cascading, edge behaviour); UX is
surprising; undo awkward. Fly-back preserves spatial memory and makes
failed interactions trivially recoverable.

### Alt F — cursor-style hot point (track dragged-card centre)

Glow follows the dragged card's centre in the overlapped card's local
frame. **Rejected** — when overlap is small, the dragged card's centre
can fall outside the overlapped card, producing no glow or
off-surface gradient origin. Intersection-centroid hot point is always
inside both cards and naturally tracks where they meet.

### Alt G — global `NonOverlapping` invariant at rest

Every widget is forcibly non-overlapping after every mutation (drop,
resize, spawn, paste, undo). **Rejected** — creates cascading solver
problems and surprising drop behaviour. The narrow card-on-card rule
in this RFC gives the perceived "cleanliness" benefit without the
solver.

---

## Worked example — `CardContainer`

Demonstrates the full lifecycle: hierarchy foundation + drop-to-consume
+ navigation into a sub-canvas + back-up + undo. This is the canonical
container implementation; other authors' containers differ only in
their card body, their `accepts` contracts, and any runtime gates.

### Contract

- **`CardContainer`** — `accepts: ['widget']`; `provides: []`.
  Non-nested case. A container container (one that accepts other
  containers) would add `provides: ['widget']` — nothing else changes.
- **Consumable cards** (WeatherCard, FitnessCard, etc.) —
  `provides: ['widget']`; `accepts: []`.

### Widget registration

```typescript
registerWidget({
  type: 'card-container',
  surface: 'dom',
  component: CardContainer,
  card: {
    background: '#2a2a2a',
    accepts: ['widget'],
    provides: [],
  },
  tags: [Container],                  // opts into navigation
  interaction: {
    canAccept: ({ parent, child, world }) =>
      !isFrameAncestorOf(world, child, parent),

    onReceiveChild: ({ parent, child, world }) => {
      const current = world.getComponent(parent, ContainerChildren)
                   ?? { ids: [] };
      return {
        consume: true,
        mutation: {
          kind: 'adopt',
          parentId: parent,
          childId: child,
          before: current.ids,
          after:  [...current.ids, child],
        },
      };
    },

    applyMutation: (world, m) => {
      world.setComponent(m.childId, ParentFrame, { id: m.parentId });
      world.setComponent(m.parentId, ContainerChildren, { ids: m.after });
    },

    revertMutation: (world, m) => {
      world.removeComponent(m.childId, ParentFrame);
      world.setComponent(m.parentId, ContainerChildren, { ids: m.before });
    },
  },
});
```

Each consumable card's registration gets `provides: ['widget']` in its
`card` config. No interaction handlers needed — consumables are the
child side of the contract.

### New component — `ContainerChildren`

```typescript
export interface ContainerChildrenData { ids: EntityId[]; }
export const ContainerChildren = defineComponent<ContainerChildrenData>(
  'ContainerChildren', { ids: [] },
);
```

Serialized. Redundant with `ParentFrame` (could be derived) but
materialised for fast "give me this container's children" reads from
UI / compositor paths. Kept consistent by `applyMutation` /
`revertMutation`. A reactive consistency check in tests validates the
two stay in sync.

### Consume flow

User drags WeatherCard toward a `CardContainer`:

1. First frame AABBs intersect — interaction runtime's overlap pass
   adds `OverlapCandidate` + `CardOverlapHotPoint` on the container;
   computes primary = container; checks match → `['widget'] ∩ ['widget']`
   non-empty, `canAccept` returns true (WeatherCard is not an ancestor
   of the container) → match = true → adds `OverlapTarget` on container.
2. `CardChrome` re-renders with `data-overlap-candidate` +
   `data-overlap-target` + hot-point CSS vars. Glow appears at the
   overlap corner; match rim fades in over ~150 ms.
3. User continues dragging; each pointermove updates the hot-point
   (intersection centroid moves as cards realign). Match rim stays.
4. User releases:
   - Grouped `MoveCommand(startPos → dropPos)` + `ConsumeCommand`
     committed.
   - `applyMutation` runs: WeatherCard gets `ParentFrame.id = container`;
     container's `ContainerChildren.ids` gets WeatherCard appended.
   - `navigationFilterSystem` reacts to the `ParentFrame` add on
     WeatherCard: the user is currently at root (or in some parent
     frame where the container is `Active`), so WeatherCard's frame
     is now the container, not the current frame — `Active` removed.
   - R3F compositor state machine sees WeatherCard lose `Active` →
     transitions to `Dormant` (RFC-002 Phase 6), FBO preserved and
     eviction-protected.
   - DOM layer bucket re-computes: WeatherCard unmounts from the
     current frame's DOM tree.
5. Container shows a count badge (via an ECS hook reading
   `ContainerChildren.ids.length`).

### Navigate into the container

`CardContainer`'s React body wires a double-click handler on
non-dragging, non-resize regions:

```tsx
const onDoubleClick = () => engine.enterContainer(entityId);
```

`enterContainer`:

- Saves `CameraResource` into the current frame's camera home
  (`RootCameraResource` if we were at root, or the previous
  container's `ContainerCamera`).
- Pushes `{ containerId: entityId }` onto `NavigationStackResource.frames`.
- Loads `ContainerCamera` of the target into `CameraResource` (or
  default `{ 0, 0, 1 }` for a fresh container).
- `navigationFilterSystem` sees the stack change and re-evaluates
  `Active` for every widget: now only entities with `ParentFrame.id
  === entityId` are active — including the just-consumed WeatherCard.
- All rendering layers (DOM buckets, R3F compositor, cull, spatial
  index) react to the new active set automatically — no additional
  wiring.

WeatherCard mounts in the sub-canvas at whatever `Transform2D` it had
at drop time, translated into the container's local coord system at
`applyMutation` time (optional; MVP can simply keep the drop Transform2D
verbatim — the visual shift is a polish concern).

### Back navigation

Breadcrumb / back-button / Escape / swipe gesture calls
`engine.exitContainer()`:

- Saves current `CameraResource` into the container's
  `ContainerCamera` component.
- Pops the stack.
- Loads the incoming frame's camera (parent container's
  `ContainerCamera`, or `RootCameraResource` if back at root).
- `navigationFilterSystem` re-evaluates `Active`. Container becomes
  `Active` again in the parent frame; its children go back to
  `Dormant`.

### Undo

Immediately after consume, user hits `Cmd-Z`:

- Group undo fires.
- `ConsumeCommand.undo`:
  - `revertMutation` → `ContainerChildren.ids` reverts to `before`;
    WeatherCard loses `ParentFrame`.
  - `rehydrateEntity` is a no-op if the entity already exists (this
    container consume didn't destroy it — it just re-parented).
- `MoveCommand.undo` — moves WeatherCard from drop position back to
  pre-drag position.
- Net result: canvas identical to pre-drag state. WeatherCard `Active`
  again in whatever frame the user was in; container's child count
  back to zero. No residual overlap, no orphaned entities, no count
  mismatch.

### Nested containers

A `CardContainer` inside another `CardContainer` works with no special
handling:

- Outer container's `ContainerChildren.ids` includes the inner
  container.
- Inner container has `ParentFrame.id = outerId`.
- Navigate into outer → inner container becomes visible (it's a
  normal card inside outer's canvas).
- Double-click inner → `enterContainer(inner)` — the nav stack now
  has three frames (root, outer, inner). Inner's children become
  `Active`.
- `ContainerCamera` persists at each level independently.

Cycle prevention via `canAccept` in `CardContainer` rejects dragging
an ancestor container onto a descendant — the static check replaces
what would otherwise be an undoable bug.

### End-to-end user sequence

| Step | DOM state | R3F state | Inputs |
|---|---|---|---|
| 1 — cards on canvas | WeatherCard + CardContainer in `base` layer | — | — |
| 2 — drag start | WeatherCard promotes to `overlay` (RFC-003); `Dragging` set | `uDraggedRect` set | pointer down |
| 3 — overlap begins | Container gets `OverlapCandidate` + `CardOverlapHotPoint`; glow fades in | (if container were R3F) glow uniforms update | pointer move |
| 4 — match rim appears | Container gets `OverlapTarget`; rim pulses | rim uniform = 1 | pointer move |
| 5 — release | Consume: `ParentFrame` set, `ContainerChildren.ids` appended; hover tags cleared; `Dragging` removed; WeatherCard goes Dormant | `uDraggedRect` clears | pointer up |
| 6 — double-click container | Nav push; sub-canvas renders WeatherCard as `Active` | WeatherCard Warm-re-activates from FBO | double click |
| 7 — back | Nav pop; container `Active` again | WeatherCard → Dormant | back affordance |
| 8 — undo step 5 | WeatherCard re-created at pre-drag position | R3F re-activates | Cmd-Z |

### What widget authors learn

- The interaction contract is two string arrays on `Card` plus a
  handler triple (`onReceiveChild` / `applyMutation` /
  `revertMutation`) in the widget registry. No reactive wiring, no
  subscriptions, no per-frame logic.
- Parent-side state (`ContainerChildren`) is a normal ECS component —
  standard serialization, standard queries, standard selectors.
- Undo falls out of the command pattern plus the two mutation
  functions. No per-widget undo bookkeeping beyond that.
- Navigation is orthogonal — any `Container` widget is navigable
  regardless of whether it consumes children. Non-consuming
  containers (empty, always) are valid.
- Cycle prevention is a single helper call in `canAccept`.

---

## Migration path

### Phase 0 — ECS foundation

0a. **✅ Done — `ParentFrame` rename.** Originally specced as a split
of `Parent` into `Parent` (handles) + `ParentFrame` (container
children). RFC-005 deleted the handle sub-entity model entirely,
which made `Parent` unused except by container children — the split
collapsed to a straight rename of `Parent` → `ParentFrame` and landed
as part of RFC-005 Phase 3. Call sites migrated:
`navigation-filter.ts`, `engine.create({ parent })`, serialization
cross-ref pass, container-hierarchy tests. No further work here.

0b. **Drop `WorldBounds`, delete `transform-propagate`, unify on
`Transform2D`.** After RFC-005 `transform-propagate` is a pure
identity copy from `Transform2D` to `WorldBounds`, and `WorldBounds`
has no distinct role from `Transform2D` for any consumer. Finish the
migration: delete the component, delete the system, and migrate every
consumer (spatial index observer, cull, R3F compositor, DOM slot
updater, snap guides) to read `Transform2D` directly. Field renames
only: `worldX` → `x`, `worldY` → `y`, `worldWidth` → `width`,
`worldHeight` → `height`. No derived-bounds system needed since
handles (the only previous consumer of derivation) no longer exist.

0c. **`ContainerCamera` + `RootCameraResource`.** Add both. Drop
`camera` from `NavigationFrame`. Rewrite `enterContainer` /
`exitContainer` to persist/restore via the component / resource.
`NavigationStackResource` no longer serialized; default-reset to root
on load. Archetype observer auto-adds `ContainerCamera` when
`Container` is added so new containers start with a usable default.

Acceptance:
- All existing tests pass after the rename + system reshape.
- Handles render at correct positions (verified visually + via
  snapshot tests on `Transform2D` values).
- Enter/exit container preserves and restores the per-container
  camera state as expected.
- Nested container round-trip (enter A → enter B → exit → exit) leaves
  the root camera at its pre-navigation state.
- No references to `WorldBounds` / `transformPropagate` remain.
- Load a serialized canvas: user arrives at root frame regardless of
  where the previous session ended.

### Phase 1 — `Card` contract fields + widget-registry handlers

Extend `CardData` with `accepts` / `provides` (default empty arrays).
Extend `WidgetRegistry` entry with the optional `interaction` block
(`onReceiveChild`, `onDroppedOnParent`, `canAccept`, `applyMutation`,
`revertMutation`). Existing widgets migrate with no behaviour change.

Acceptance:
- Existing widget registrations build and render unchanged.
- A card with `accepts: ['x']` serializes to/from JSON faithfully.

### Phase 2 — `TransformTween`

Define the component, register the system (schedules before
`handleSync`). `applyEasing` helper with `linear` / `ease-out` /
`ease-in-out`. Unit tests: zero-duration snap, partial elapsed,
overrun, missing `Transform2D`, auto-removal on completion.

Acceptance:
- Dropping a `TransformTween` onto any entity with `Transform2D`
  animates the position over `durationMs` with the given easing.
- Component auto-removed at completion.

### Phase 3 — Overlap detection + two-layer visual state

Define `OverlapCandidate`, `OverlapTarget`, `CardOverlapHotPoint`;
serialization skip list updated. Overlap pass invoked from interaction
runtime's `handlePointerMove`, gated on dragged entity having `Card`.
`CardChrome` reads the state and writes CSS vars + data attributes.
`CompositionMaterial` gains `uHotPoint` / `uHotStrength` /
`uIsOverlapTarget`; fragment shader updated.

Acceptance:
- Dragging a card over other cards: every overlapped card shows
  Layer 1 glow at the intersection centroid.
- The dragged card never glows.
- Closest matching card additionally shows Layer 2 rim when contracts
  match.
- Layer 2 vanishes instantly when match breaks (primary changes, or
  gate flips to false).
- Glow fades in / out smoothly at overlap enter / exit (~150 ms).

### Phase 4 — Drop outcome branching + fly-back

Extend `handlePointerUp` dragging branch with the primary/match
decision. Implement `ConsumeCommand`, `snapshotEntity`,
`rehydrateEntity`. Implement fly-back path using `TransformTween`,
per-tick completion poll, interruption-by-new-pointerdown.

Acceptance:
- Normal move: no-card dragged, or card with no card-overlap. Existing
  move behaviour unchanged.
- Consume: primary match. Group command committed; undo restores full
  pre-drag state.
- Fly-back: primary mismatch. Card animates to pre-drag position; stays
  visually on top throughout; no command committed on completion.
- Interruption: pressing down on a flying card cancels the tween and
  resumes dragging from the current animated position with no visual
  stutter.

### Phase 5 — `CardContainer` worked example

Implement `ContainerChildren` component. Implement `CardContainer`
widget + its handler triple + default `canAccept` cycle-guard.
Double-click binding in the widget body. Breadcrumb UI in the
playground showing the nav stack (root / container name / ...).

Acceptance:
- End-to-end flow (the eight-step user sequence above) works in the
  playground.
- Undo reverts consume atomically; canvas returns to exact pre-drag
  state.
- Serialization round-trip preserves `ParentFrame` and
  `ContainerChildren` across save/reload; the nav stack resets to
  root.
- Nested containers (A contains B contains C): navigating in then
  back out preserves each level's `ContainerCamera` state.
- Cycle guard: dragging `A` (which transitively contains `B`) onto
  `B` does not match; drop flies back.

---

## Open questions

1. **Grouped undo for `MoveCommand` + `ConsumeCommand`.** Single-step
   undo (grouped) is recommended — one press returns to the pre-drag
   state. Two-step is more granular but less ergonomic. Committing
   grouped.
2. **Tie-break at identical centre distance.** ZIndex desc, then
   entity id asc. Deterministic, unlikely to ever matter.
3. **Accidental consumes on slight overlap.** MVP allows any overlap +
   match to consume. If telemetry shows accidents, add a minimum
   overlap-area gate (≥ 20% of dragged's area) before ranking.
4. **Parent-mutation shape.** Opaque `mutation: unknown` with per-widget
   `applyMutation` / `revertMutation`. Maximally flexible; requires
   widget authors to write reverse logic. A generic "component-diff"
   default could eliminate the boilerplate; defer until a second
   consume example motivates it.
5. **Consume animation polish.** MVP: child vanishes on next frame
   (for destroy-kind consumes) or unmounts via navigation filter (for
   re-parent-kind consumes). `TransformTween` plus a scale/alpha tween
   could drive a "shrink into parent" effect later without architecture
   changes.
6. **Multi-select drag.** Out of scope. When added: each child resolves
   independently against the same primary; one `ConsumeCommand` per
   child; group moves as today.
7. **`engine.create(x, y)` inside a container.** Direct
   `ContainerChildren.ids` push with `ParentFrame` set, no consume
   path. Keeps the consume mechanic strictly a drag concern.
8. **"Move to parent frame" affordance (drag-out).** Out of scope.
   When added: a specific gesture (drag to frame edge, menu action,
   keyboard shortcut) emits a command that removes `ParentFrame` and
   sets `Transform2D` in the outer frame's coord space.
9. **Session-resume of nav state.** `NavigationStackResource` is
   currently reset to root on load. If product wants "return to where
   I was," add a serialized `NavigationHistoryResource` separately;
   don't conflate with the current-frame stack.

---

## Acceptance criteria

**Phase 0 — Hierarchy foundation**
- [x] `ParentFrame` added for container children; `Parent` deleted
      entirely (handles no longer exist as ECS entities — RFC-005);
      all call sites migrated.
- [x] `WorldBounds` deleted; `transform-propagate` deleted; every
      consumer reads `Transform2D`. (No derived-bounds system needed —
      handles are not entities.)
- [x] `ContainerCamera` component defined, serialized as part of the
      container entity's component set.
- [x] `RootCameraResource` defined, serialized via `CanvasDocument.resources.rootCamera`.
- [x] `NavigationStackResource.frames` shape is `{ containerId }`;
      resource is not serialized (navigation state resets to root on load).
- [x] `enterContainer` / `exitContainer` persist + restore camera
      state via `ContainerCamera` / `RootCameraResource`.
- [x] No references to `WorldBounds` / `transformPropagate` /
      `worldBoundsToAABB` remain; all existing tests pass.

**Phase 1 — Card contract fields**
- [x] `CardData` extended with `accepts: readonly string[]`,
      `provides: readonly string[]`.
- [x] Widget registry accepts optional `interaction` block with
      `onReceiveChild`, `onDroppedOnParent`, `canAccept`,
      `applyMutation`, `revertMutation`.
- [x] Existing widgets render unchanged; new fields round-trip via
      serialization.

**Phase 2 — TransformTween**
- [x] `TransformTween` component defined; serialization skip list
      updated.
- [x] `transformTweenSystem` registered on the scheduler. (No
      `handleSync` ordering needed — handles were deleted by RFC-005
      and the spatial-index observer fires inline on Transform2D
      writes, so system ordering is irrelevant.)
- [x] `applyEasing` supports `linear`, `ease-out`, `ease-in-out`
      (`spring` falls back to `ease-out` until its tuning is speced).
- [x] Tween auto-removes on completion; final value matches `toX` /
      `toY` exactly; width / height / rotation preserved via partial
      setComponent.
- [x] Starting a new tween on an entity with an active tween
      overwrites.

**Phase 3 — Overlap detection + visual state**
- [x] `OverlapCandidate`, `OverlapTarget`, `CardOverlapHotPoint`
      defined; serialization skip list updated.
- [x] Overlap pass invoked from interaction runtime's
      `handlePointerMove` only when dragged entity has `Card`.
- [x] Every card whose AABB intersects the dragged card's AABB gets
      `OverlapCandidate` + `CardOverlapHotPoint`.
- [x] `CardOverlapHotPoint.{x,y}` = intersection centroid in local
      (0..1) coords of the overlapped card.
- [x] `OverlapTarget` set on at most one card, iff that card is the
      primary (closest centre distance, `ZIndex` + entity-id tie-break)
      AND contracts match AND `canAccept` passes.
- [x] DOM `CardChrome` renders Layer 1 glow (radial gradient at
      `(hotX, hotY)`); Layer 2 rim appears when `data-overlap-target`
      is set.
- [x] R3F `CompositionMaterial` renders equivalent glow + rim via
      `uHotPoint` / `uHotStrength` / `uIsOverlapTarget`.
- [x] Dragged card never carries any of the three overlap
      tags/components (filtered by `c.id !== draggedId` in the pass).
- [x] Glow strength fades in/out at overlap enter/exit (opacity
      `transition` on DOM; strength uniform write on R3F; 150 ms ease).

**Phase 4 — Drop outcome + fly-back**
- [x] Normal-move branch commits a standard `MoveCommand` (non-card
      drag, or card drag without overlap candidates).
- [x] Consume branch emits grouped `MoveCommand` + `ConsumeCommand`;
      `applyMutation` runs when the widget registers one (default
      behaviour without a handler: destroy child); undo restores the
      full pre-drag state atomically.
- [x] Fly-back branch creates a `TransformTween` with `kind: 'flyback'`;
      `Dragging` tag retained; card returns to pre-drag position;
      `Dragging` removed on completion via `runFlyBackSystem`; no
      commands committed.
- [x] During fly-back, card stays visually on top — layer / ZIndex /
      `uDraggedRect` / chrome lift all remain because `Dragging` is
      still set until the tween finishes.
- [x] Fly-back interruption by new pointerdown on the flying entity
      cancels the tween, re-snapshots start positions from the current
      animated position, and transitions to a fresh `dragging` state
      without removing `Dragging` (no visual stutter).

**Phase 5 — `CardContainer` worked example**
- [x] `CardContainer` widget registered with `accepts: ['widget']`,
      `Container` tag, and the full handler triple.
- [x] Default `canAccept` rejects frame-ancestor drops (cycle guard).
- [x] `ContainerChildren` component defined; serialized faithfully
      alongside `ParentFrame`.
- [x] Consuming a card appends its id to the container's
      `ContainerChildren.ids` and sets the child's `ParentFrame.id`.
- [x] Double-click on container invokes `engine.enterContainer`;
      children become `Active`.
- [x] Back navigation restores the parent frame; children become
      `Dormant`.
- [x] Single-step undo immediately after consume restores the pre-drag
      canvas exactly.
- [x] Nested containers round-trip: enter outer → enter inner → exit →
      exit preserves each level's camera state.
- [x] Serialization round-trip preserves the full hierarchy; nav state
      resets to root.

---

## Dependencies and risks

**Depends on**
- `Card` component + chrome plumbing (RFC-003 v3).
- `Dragging` tag + state machine in `interaction.ts` (existing).
- Reactive spatial index observer in `LayoutEngine.ts` — moves from
  `WorldBounds` observation to `Transform2D` observation in Phase 0.
- R3F `CompositionMaterial` ShaderMaterial (RFC-003 Phase 4).
- Existing `Container` / `Children` / `NavigationStackResource` /
  `enterContainer` / `exitContainer` machinery, reshaped in Phase 0.

**Risks**
- **Phase 0 blast radius (remaining).** Post-RFC-005, Phase 0 touches
  ~8 files: spatial-index observer, cull system, R3F compositor, DOM
  slot rAF updater, snap guides, `LayoutEngine.ts` (camera
  persistence), `NavigationStackResource` shape, and `components.ts`
  (`ContainerCamera` addition). All changes are mechanical.
  Mitigation: land 0b and 0c in separate commits so each step is
  bisectable, and keep the test suite green at every commit.
- **Per-move ECS churn.** Tag + component add/remove per overlap
  enter/exit at 60–120 Hz. Bounded by `k` (~5 typical, ≤ 20 worst);
  still worth measuring in Phase 3 with a 100-card dense scene.
- **Shader program count.** Three extra uniforms on
  `CompositionMaterial` won't fork the program (uniforms don't vary
  structure). Verify with `renderer.info.programs.length` in Phase 3.
- **CSS `mix-blend-mode: screen` + `overflow: hidden`** — Safari
  historically has subtle regressions. Fallback to flat additive
  overlay if testing shows issues in Phase 3.
- **`ConsumeCommand` snapshot completeness.** `rehydrateEntity` must
  restore every component + tag, including ones referencing other
  entities (e.g., `ParentFrame`, `HandleSet`). Phase 4 tests include
  a consume of an entity with nested children + handles to stress
  snapshot depth.
- **Fly-back / re-drag race.** One-tick ambiguity if pointerdown
  lands on the same frame a tween snaps complete. Mitigation:
  pointerdown explicitly removes any active `TransformTween` on the
  target before consulting `inputState`.
- **Small-corner glow saturation.** The radial gradient centred near
  a corner can look like a bright spot instead of a hover glow. Tune
  gradient radius / intensity in Phase 3; acceptable to clamp minimum
  strength below e.g. 4 px of overlap.

---

## Revision notes

**v1** — initial draft, 2026-04-23. Established the drop-to-consume
mechanic tied to `Card`, two-layer visual state (glow + match rim),
closest-centre primary, fly-back on mismatch via a new `TransformTween`,
and a "Debug Container" worked example.

**v1 → v2** (same-day revision after hierarchy-foundation design pass)

- **Renamed the worked example.** "Debug Container" → "`CardContainer`",
  reflecting its role as a general first-class widget rather than a
  debug scaffold.
- **Folded in the ECS foundation as Phase 0.** The hierarchy and
  navigation primitives (`Parent`, `Container`, `NavigationStackResource`,
  `enterContainer`/`exitContainer`, `navigationFilterSystem`) already
  existed in the codebase but shared `Parent` between handles and
  container-children, causing the coord-space accumulation bug in
  `transform-propagate` to silently affect container children. v2
  splits `Parent` (handles) and `ParentFrame` (container children),
  which makes the accumulation branch dead code.
- **Deleted `WorldBounds` and `transform-propagate` entirely
  (Path 2b).** Every rect-shaped entity now carries `Transform2D`.
  Handles get a derived `Transform2D` from the renamed
  `handleBoundsSystem` (née `hitboxWorldBoundsSystem`). All consumers
  (spatial index observer, cull, R3F compositor, DOM slot updater,
  snap guides) migrate to reading `Transform2D`.
- **Moved per-container camera state onto the container entity.**
  `ContainerCamera` component replaces the `camera` field on
  `NavigationFrame`. `RootCameraResource` holds the root frame's
  camera symmetrically. `NavigationStackResource.frames` simplifies
  to `{ containerId }`. The resource itself is no longer serialized —
  users arrive at the root frame on load.
- **Added cycle prevention.** `isFrameAncestorOf` helper; default
  `canAccept` on `CardContainer` uses it to reject dragging an
  ancestor container onto a descendant.
- **Expanded the worked example.** Now demonstrates nested containers,
  per-level camera persistence, and the full migration from consume →
  Dormant → re-Active via navigation — end-to-end coverage of the
  hierarchy system together with the consume mechanic.

**v3 → v4** (Phase 5 implementation)

- **Phase 5 landed.** `CardContainer` widget + `ContainerChildren`
  component + `isFrameAncestorOf` cycle guard all implemented;
  serialization round-trips the hierarchy; nested-container enter/exit
  preserves per-level `ContainerCamera` state.
- **`navigationFilterSystem` clarified.** The system stays
  nav-stack-driven; mid-session `ParentFrame` mutations (consume / undo
  / re-parent) are reconciled out of band by a reactive observer in
  `LayoutEngine.ts` that calls the exported `reconcileEntityActive`
  helper per changed entity. Without this, a consumed child retained
  `Active` at root until the next navigation and rendered on top of
  its own container for one tick.
- **Overlap pass gated on `Active`.** `updateCardOverlap` now skips
  non-`Active` candidates. Consumed children still occupy a spatial-
  index slot at their drop-world coords, so without this filter they
  would register as overlap targets for any subsequent drag, letting
  the user "consume into" a card that isn't visible in the current
  frame.

**v2 → v3** (after RFC-005 landed)

- **Phase 0a collapsed from a split to a rename.** RFC-005 deleted
  the handle sub-entity model (`handleSyncSystem`,
  `hitboxWorldBoundsSystem`, `Hitbox`, `HandleSet`, and `Parent`
  itself) and moved resize hotspot detection inline into
  `interaction.ts`. That left `Parent` unused except by container
  children, so v2's planned `Parent` → `Parent` + `ParentFrame` split
  became a pure rename — and landed as a side effect of RFC-005
  Phase 3. Phase 0a acceptance ticks as done here; no further work.
- **Phase 0b simplifies.** v2 specced a `handleBoundsSystem` rename
  (née `hitboxWorldBoundsSystem`) that would write a derived
  `Transform2D` for handle entities. With handles gone entirely, no
  derived-bounds system is needed — Phase 0b is now pure deletion of
  `WorldBounds` + `transform-propagate` plus consumer migration to
  `Transform2D`. Smaller diff, same outcome.
- **Phase 0c unchanged.** `ContainerCamera` component,
  `RootCameraResource`, simplified `NavigationFrame`, reshaped
  `enterContainer` / `exitContainer`. Still TODO in this RFC.
- **Blast radius estimate updated.** v2 noted ~15 files for Phase 0
  total; after RFC-005's contribution, the remaining Phase 0 work
  touches ~8 files — the spatial index observer, cull, R3F
  compositor, DOM slot updater, snap guides, `LayoutEngine.ts`
  (camera persistence), `NavigationStackResource` shape, and
  `components.ts` (`ContainerCamera`).
