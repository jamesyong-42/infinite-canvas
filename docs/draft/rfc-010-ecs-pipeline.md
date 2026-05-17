# RFC-010: Two-Pipeline ECS Refactor — Sync-Reactive Bus + Phased Tick Pipeline

- **Status**: Draft v2.3
- **Author**: James Yong
- **Date**: 2026-05-17 (v2.3: post-Phase-5 corrections; v2.2: post-Phase-4; v2.1: post-Phase-3; v2: pre-implementation; v1: initial)
- **Area**: ECS / Engine / Scheduler / `@jamesyong42/reactive-ecs` package
- **Related**: RFC-003 (`dragPromoteSystem` reference predates its existence as a system), RFC-004 (Phase 5 `ParentFrame` ↔ `Active` reconcile observer + mid-system `navStack.changed` reset), RFC-009 (state systems assume a stable scheduler contract — this RFC supplies it).
- **Supersedes**: The eight imperative observer wirings at `packages/infinite-canvas/src/ecs/engine/LayoutEngine.ts:130–248`, the two systems-in-disguise (`interaction.runFlyBackSystem`, `interaction.runCursorSystem`) called inline at lines 915–918, the inline tail of `engine.tick()` at lines 920–993 (visibility build, `FrameChanges` assembly, post-frame bookkeeping, tween keepalive), and ~6 redundant `engine.markDirty()` calls at the React boundary.

### Changes since v1

- **`reactive-ecs` ships zero phase vocabulary.** `Phase`, `PHASE_ORDER`, and `DEFAULT_PHASE` are no longer library-defined types/constants. `PhasedScheduler<P extends string>` now takes a `phases` array at construction time and validates phase membership at register time. The seven-phase vocabulary becomes an *infinite-canvas* decision, codified in `packages/infinite-canvas/src/ecs/engine/phases.ts`.
- **`PhasedScheduler` is generic over the phase string set.** `as const` on the consumer's `phases` literal flows through `getPhase()`, `getPhases()`, and profiler hook arguments.
- **No backwards-compat default.** v1 said "default phase is `'derive'` so existing systems work without modification." That conflated two things. The library no longer assumes any phase exists. Per-instance `defaultPhase?` option fills the same role for each consumer.
- **Phase 2 of the migration plan now bundles the consumer-side phase declaration** (`ENGINE_PHASES`) with the `SystemScheduler → PhasedScheduler` swap. The reactive-ecs work itself shipped as v0.3.0 ahead of consumer Phase 1.

### Corrections since v2 (post-Phase-3)

- **Phase 2 prose ↔ table conflict resolved.** The v2 prose said "Stamp `phase: 'derive'` on the existing six systems," but the same paragraph also said "Drop `after: 'navigationFilter'` from `cullSystem` (also implicit)." Both can't be true unless `navigationFilter` is in an earlier phase. The "What goes in each phase" table was always the authoritative source: `navigationFilterSystem → control`, `transformTweenSystem → simulate`, the rest → `derive`. The Phase 2 prose is now rewritten to enumerate the per-system mapping explicitly. Implementation already followed the table.
- **Pre-existing limitation documented in Appendix B.3.** `reactive-ecs` does not emit a change event on `removeComponent`, so the original `ParentFrame` observer never actually fired on remove despite a stale RFC-004 comment. The new `parentFrameActiveSystem` inherits the same gap (`queryChanged` skips removes). The "child returns to root" recovery happens via `navigationFilterSystem` on the next `navStack.changed`. Documented as a known limitation, not a regression.

### Corrections since v2.1 (post-Phase-4)

- **`flyBack` / `cursor` phase placement corrected.** The "What goes in each phase" table and the Phase 4 migration plan put both `flyBackSystem` and `cursorSystem` in `control`. That is wrong: `flyBackSystem` is the *completion poll* for the fly-back `TransformTween`, so it must run **after** `transformTweenSystem` (phase `simulate`) has had a chance to remove the finished tween this tick. Placed in `control` (which runs *before* `simulate`), it observed the pre-tween state and finalized the fly-back one tick late — `drop-outcome.test.ts` ("fly-back completion: after tween finishes, Dragging is removed") caught this during Phase 4 implementation. Corrected placement: `flyBackSystem` → `simulate`, `after: 'transformTween'`; `cursorSystem` → `present` (it derives the `CursorResource` *render output* from the post-flyBack interaction state; phase order alone sequences it after `flyBack`, and a cross-phase `after` would be rejected by the scheduler). The table, the architecture diagram, the Phase 4 plan, and the file-layout note below are all updated to match.
- **`Profiler.beginVisibility` / `endVisibility` retired.** Phase 4 drops the dedicated visibility timer; the `visibilityMs` stat field is now vestigial (no consumer reads it) and `systemAvg.visibility` from the scheduler profiler carries the same signal. Not a behavioural change.

### Corrections since v2.2 (post-Phase-5)

- **The `markDirty()` → `invalidatePresent()` rename had a wider blast radius than the spec scoped.** The Phase 5 plan said "Rename `engine.markDirty()` → `engine.invalidatePresent()`. Update the two legitimate external callers (`InfiniteCanvas.tsx:250, 262`)." That undercounted: `apps/playground/src/` had **13** more call sites (App.tsx ×5, SettingsPanel.tsx ×4, NavigationBreadcrumbs.tsx ×2, InspectorPanel.tsx ×1, CardContainer.tsx ×1). The initial Phase 5 commit broke the playground (runtime `TypeError`, `tsc` failure); a follow-up commit (`be5c543`) did the behaviour-preserving 1:1 rename across all 13 (`invalidatePresent()` is the verbatim rename of the old `markDirty()` — identical implementation). Caught by a post-implementation spec-review pass, not by CI (the lint/test gate never typechecked `apps/playground`). **Process note:** the migration-plan "what gets deleted / renamed" inventory must enumerate `apps/**` consumers, not just library-internal ones; a `tsc` step over the playground would have caught this pre-merge.
- **`engine.execute(command)` retains an explicit `markDirtyInternal()`.** The Phase 5 plan said "the 25 explicit `markDirtyInternal()` calls in `LayoutEngine.ts` collapse to zero." In practice `execute()` keeps one: `commandBuffer.execute(command, world)` mutates via the proxied world for any command that touches an entity/component/tag (so the proxy already auto-dirties), but the explicit call is retained as a correct fallback for a hypothetical zero-mutation command. This is harmless (idempotent double-set) and deliberate. The "collapse to zero" wording was aspirational; the accurate statement is "collapse to the resource-/closure-mutation paths the proxy cannot observe (camera in-place, `setResource` viewport/nav, snap closure flags) **plus** the `execute()` fallback."
- **`mutation-proxy.test.ts` gaps closed.** v2.2's test set proved per-mutation auto-dirty, read-only-doesn't-dirty, getter survival, and `invalidatePresent()`. Phase 5 review flagged two unpinned paths: (1) `undo()`/`redo()` flowing through the proxied world via `commandBuffer`, and (2) `setResource` deliberately *not* dirtying (recursion-safety contract). Both now have explicit tests so a future regression (e.g. adding `setResource` to `DIRTYING_METHODS`) fails loudly.

---

## Summary

The engine has two distinct execution loops smuggled into one `tick()` body. Imperative reactive observers wired at engine construction time fire synchronously on mutations, with no documented ordering. A topo-sorted system scheduler runs six systems per tick, with two more "systems" called inline afterwards (`runFlyBackSystem`, `runCursorSystem`) and a 70-line tail of glue (visibility, `FrameChanges`, frame events, tween keepalive). `markDirty()` is sprinkled across 56 call sites — about six of them dead-weight at the React boundary, calling APIs that already mark dirty internally.

The fix is to name the two loops, fix their contracts, and move everything else into the named loops.

1. **Sync-reactive bus** — fires synchronously on mutation. Membership rule: *the invariant must be true before any same-tick system reads it.* Shrinks from 8 handlers to **2** (spatial-index upsert / remove). Becomes one-shot (no cascading writes that re-trigger the bus).

2. **Phased per-tick pipeline** — runs once per dirty rAF in a phase order chosen by infinite-canvas: `input → react → control → simulate → derive → present → cleanup`. Within a phase, existing `after` / `before` constraints continue to topo-sort. Six current systems plus six ex-observers plus the inline tail of `tick()` all become phase-stamped systems registered in one place.

The phase mechanism is a small, additive change to `@jamesyong42/reactive-ecs` (v0.3.0): one optional `phase` field on `SystemDef`, one new generic `PhasedScheduler<P extends string>` that takes a phase list at construction time and buckets by phase before delegating to the existing within-phase topo sort. The library ships no phase vocabulary — the seven names above are infinite-canvas's choice, declared in `packages/infinite-canvas/src/ecs/engine/phases.ts`.

Net delta: roughly **−400 LOC, +250 LOC** across `LayoutEngine.ts`, `interaction.ts`, the React boundary, and `reactive-ecs`. The `tick()` body collapses from ~100 lines of inline glue to ~15. Six sync-reactive observers become per-tick `react`-phase systems with their own files, tests, and profiler entries. Behavioural parity with today, proven per migration via a synchronous-read audit (Appendix B).

---

## Motivation

### Smells addressed

| Smell | Location | Root cause | Resolution |
|---|---|---|---|
| 10.1 Eight observers wired imperatively at engine creation | `LayoutEngine.ts:130–248` | Side effects expressed as `world.onX` subscriptions, with no documented ordering, no profiler hooks, no test seam | Six become `react`-phase systems; two stay sync (spatial index) with a published one-shot contract |
| 10.2 Two systems-in-disguise called inline after `scheduler.execute` | `LayoutEngine.ts:915–918` | `runFlyBackSystem` and `runCursorSystem` bypass the scheduler — invisible to the system profiler, no `after`/`before` semantics, no registration | Become scheduled `SystemDef`s registered like the rest (`flyBack` → `simulate after transformTween`; `cursor` → `present` — see "Corrections since v2.1") |
| 10.3 Visibility, `FrameChanges`, tween-keepalive as inline tail logic | `LayoutEngine.ts:920–993` | ~70 LOC of bookkeeping wedged inside `tick()` | Become `present`/`cleanup`-phase systems |
| 10.4 56 `markDirty()` sites with no central contract | 25 inside engine APIs, 23 inside `interaction.ts`, 6 redundant at React boundary, 2 legit at React boundary | Every mutation site explicitly marks dirty | Engine APIs become implicit-mark-on-mutation; redundant boundary calls deleted; legit boundary calls (CSS-vars / shader-uniform external state) keep their explicit `markDirty()` |
| 10.5 Cross-loop ordering is undocumented | — | Spatial-index observer happens to fire before `cull` reads the index because mutations precede rAF; only a 7-line comment at line 127 acknowledges this | The sync-reactive bus contract makes this explicit; phase order makes within-tick ordering enforced |
| 10.6 `NavigationStackResource.changed` is reset mid-tick by a system, breaking same-tick reads | `LayoutEngine.ts:899–906`, `systems/navigation-filter.ts:55` | `navigationFilter` clears the flag while running; reading it after `scheduler.execute` always returns false | The `present`-phase `frameChanges` system captures `navigationChanged` from a snapshot taken in a new `input`-phase system; no more pre-`scheduler.execute` capture dance |

### Other wins

- **Phase order = contract.** A new system's home phase tells you what it can read and what reads it. `react` runs before `control`, so a `control`-phase system can rely on `dragPromote` having flipped `Layer` already. Today this is a `before: 'cull'` constraint scattered across system files.
- **Profiler covers the whole tick.** Today `runFlyBackSystem`, `runCursorSystem`, the visibility build, and the `FrameChanges` build are profiler-blind. After RFC-010 every cell of work is `profiler.beginSystem(name)`-bracketed.
- **Test seams.** Drag-promote, role-refresh, ContainerCamera-attach, ParentFrame-reconcile, fly-back, cursor-derive, visibility, `FrameChanges` — each becomes a function with one input (`World`) and one output (mutations). Unit tests pass a synthetic `World`, no engine.
- **Removes the `runFlyBackSystem`/`runCursorSystem` outliers.** Today new contributors don't see these in the system list; tomorrow `getSystemNames()` returns them like everything else.

### Observer inventory (today, 8 handlers)

| `LayoutEngine.ts` line | Trigger | Effect | Today's category | Tomorrow's home |
|---|---|---|---|---|
| 131 | `Transform2D` change | `spatialIndex.upsert(rectToAABB(t))` | Sync-mandatory — `cull` reads the index | **Sync-reactive bus** (stays) |
| 139 | `onEntityDestroyed` | `spatialIndex.remove` | Sync-mandatory | **Sync-reactive bus** (stays) |
| 150 | `Container` add | auto-attach `ContainerCamera` | Convenience — no sync reader | `react` phase — `containerCameraSystem` |
| 168 | `ParentFrame` change | `reconcileEntityActive` + `markDirty` | Convenience — already deferred | `react` phase — `parentFrameActiveSystem` |
| 212–215 | `Draggable`/`Selectable` add/remove | `refreshInteractionRole` (two-way) | Convenience | `react` phase — `roleRefreshSystem` |
| 225 | `Dragging` add | drag-promote `Layer = 'overlay'` (gated on `Card`, not `webgl`, no existing `PreDragLayer`) | Convenience — readers are post-tick | `react` phase — `dragPromoteSystem` |
| 241 | `Dragging` remove | restore `Layer` from `PreDragLayer`, remove stash | Convenience | `react` phase — same `dragPromoteSystem` (combined) |

Net: **8 observers → 2 (sync) + 4 systems (`react`).**

### `markDirty()` inventory (today, 56 sites)

- **25 inside `LayoutEngine.ts`** — every mutation API ends with `markDirtyInternal()`. Becomes implicit: a `MutationProxy` around the World marks dirty on any mutation method, removing 25 explicit calls.
- **23 inside `interaction.ts`** — every state-machine transition. Survives until RFC-009 lands; collapses naturally when interaction becomes phase-stamped state systems.
- **6 inside `react/InfiniteCanvas.tsx` and `r3f/compositor/hooks.ts`** — **redundant**. Each one wraps an engine API that already marks dirty (`panTo`, `zoomTo`, `zoomToFit`, `undo`, `redo`, `addTag(R3FAnimationSignal)`, `removeTag(R3FAnimationSignal)`). Delete.
- **2 inside `react/InfiniteCanvas.tsx` (lines 250, 262)** — **legit**. They signal that *external* state (CSS vars, shader uniforms) changed and the canvas should repaint. Keep, but rename intent: `engine.invalidatePresent()` or similar to disambiguate from "the ECS world mutated."

### What this RFC is *not*

- Not a rewrite of `interaction.ts`. The 23 `markDirty` calls inside it stay until RFC-009 lands; they collapse naturally when interaction becomes phase-stamped state systems.
- Not a change to widget authoring. `useComponent` / `useHasTag` hooks at `react/hooks/ecs.ts` continue to use `world.onComponentChanged` / `onTagAdded` directly — those are *consumer* subscriptions at the engine boundary, not part of the internal pipeline.
- Not a fixed-step simulation loop. Tick cadence remains rAF-gated by the engine's dirty bit. Phases describe ordering *within* a tick; they do not prescribe when a tick fires.
- Not multi-threaded systems. `reactive-ecs` stays single-threaded.
- Not a change to the World's reactive primitives. `onComponentChanged` / `onTagAdded` etc. survive — RFC-010 moves *which side of the boundary* uses them.
- Not a change to consumer hooks (`react/hooks/ecs.ts`). React-side `onFrame` and `onComponentChanged` subscriptions are part of the public read surface, not the engine's internal pipeline.

---

## Architecture overview

### Today

```
┌────────────────────────────────────────────────────────────────┐
│ engine.tick()                                                  │
│   profiler.beginFrame                                          │
│   const navStackPreTick = ...    // capture before mid-system  │
│                                  //   reset, see RFC-004 cmt   │
│   scheduler.execute(world)        // 6 systems, topo-sorted    │
│   interaction.runFlyBackSystem()  // inline                    │
│   interaction.runCursorSystem()   // inline                    │
│   <visibility computation>        // inline, ~25 LOC           │
│   <FrameChanges build>            // inline, ~10 LOC           │
│   profiler.endFrame                                            │
│   world.clearDirty / incrementTick / emitFrame                 │
│   <tween keepalive re-dirty>      // inline                    │
└────────────────────────────────────────────────────────────────┘

8 observers fire at unknown times relative to the above, depending
on which API call triggers them. ~3 of them call markDirty; the
other 5 mutate components which themselves mark dirty.
```

### After

```
┌────────────────────────────────────────────────────────────────┐
│ Sync-reactive bus (2 handlers)                                 │
│   Transform2D change       → spatialIndex.upsert               │
│   entity destroyed         → spatialIndex.remove               │
│ Contract: must hold before any same-tick system reads.         │
│ One-shot. No writes that re-trigger the bus.                   │
└────────────────────────────────────────────────────────────────┘
                              ⇣  (mutations from engine APIs,
                                  interaction.ts, devtools, ...)
┌────────────────────────────────────────────────────────────────┐
│ engine.tick()                                                  │
│   phasedScheduler.execute(world)                                │
│     phase: input      [navStackChangedCapture]                  │
│     phase: react      [containerCamera, parentFrameActive,      │
│                        roleRefresh, dragPromote]                │
│     phase: control    [navigationFilter]                        │
│     phase: simulate   [transformTween, flyBack]                 │
│     phase: derive     [card, cull, breakpoint, sort]            │
│     phase: present    [visibility, frameChanges, cursor]        │
│     phase: cleanup    [clearDirty, incrementTick, emitFrame,    │
│                        tweenKeepalive]                          │
└────────────────────────────────────────────────────────────────┘
```

### Phase definitions

| Phase | Purpose | Membership rule |
|---|---|---|
| `input` | Drain external intent into the world (gestures, raw nav-stack flag captures) | Reads come from outside the world or read flags about-to-be-reset by later phases |
| `react` | Maintain invariants in response to mutations from the previous tick | Reads `queryChanged(T)` / state intersection diffs; writes derived components/tags |
| `control` | Run state machines and intent resolution (selection, drag, navigation filter) | Owns higher-level transitions; reads `react`-phase output |
| `simulate` | Time-driven mutations (tweens, animation) | Writes `Transform2D`, `TransformTween` |
| `derive` | Compute frame-local derived state (visibility tags, sizes, sort) | Reads everything above; writes only output state consumed by `present` |
| `present` | Build outputs for renderers | Builds `FrameChanges`, the visible-entities array, anything `engine.getX()` returns |
| `cleanup` | End-of-frame bookkeeping | `clearDirty`, `incrementTick`, `emitFrame`, tween keepalive |

The phase order is total. Within a phase, the existing `after` / `before` constraints continue to apply.

### File layout

```
packages/infinite-canvas/src/ecs/
  systems/
   +  drag-promote.ts          (new — ex-observer; Phase 1)
   +  container-camera.ts      (new — ex-observer; Phase 3)
   +  parent-frame-active.ts   (new — ex-observer; Phase 3)
   +  role-refresh.ts          (new — ex-observer; Phase 3)
   +  nav-stack-capture.ts     (new — ex-pre-scheduler capture; Phase 4)
   +  visibility.ts            (new — ex-tail-of-tick; Phase 4)
   +  frame-changes.ts         (new — ex-tail-of-tick; Phase 4)
   +  cleanup.ts               (new — clearDirty/incrementTick/emitFrame/
                                tweenKeepalive, all four in one file; Phase 4)
      (no fly-back.ts / cursor.ts — `flyBackSystem` / `cursorSystem` are
       SystemDefs inside interaction.ts, capturing its closure; Phase 4)
      breakpoint.ts            (unchanged body, +phase: 'derive')
      card.ts                  (unchanged body, +phase: 'derive')
      cull.ts                  (unchanged body, +phase: 'derive')
      navigation-filter.ts     (unchanged body, +phase: 'control')
      sort.ts                  (unchanged body, +phase: 'derive')
      transform-tween.ts       (unchanged body, +phase: 'simulate')

  engine/
   +  phases.ts                 (new — `EnginePhase` type + `ENGINE_PHASES` const,
                                 infinite-canvas's chosen vocabulary)
      LayoutEngine.ts           (~−400 LOC: observers + tick tail extracted;
                                 instantiates `PhasedScheduler({ phases: ENGINE_PHASES,
                                 defaultPhase: 'derive' })`)

reactive-ecs/src/                (already shipped as v0.3.0, no further changes)
      scheduler.ts                (PhasedScheduler<P> + PhasedSchedulerOptions<P>)
      types.ts                    (SystemDef.phase?: string)
      __tests__/
        phased-scheduler.test.ts  (constructor validation + phase-membership +
                                   custom-vocabulary coverage)
```

---

## Pipeline A — Sync-reactive bus

### Contract

The sync-reactive bus is a synchronous side-effect bus that fires within the call frame of a world mutation. It exists for *one* purpose: maintain invariants that must be true before any same-tick system reads them.

A handler on the bus may **read** any world state. It may **write** components or tags only if those writes do not themselves trigger a sync-reactive handler. The bus is **one-shot per mutation** — no fixpoint iteration, no implicit cascading.

### Membership rule

A handler belongs on the bus if and only if some same-tick system reads the data it maintains, and reading stale data would produce a wrong answer in the same tick.

By that rule, today's eight observers reduce to two:

| Handler | Reader | Same-tick? | Stale-read consequence |
|---|---|---|---|
| `Transform2D` change → `spatialIndex.upsert` | `cullSystem` calls `spatialIndex.search()` | yes (same tick the move happens) | Card disappears or fails to be culled correctly the tick it moves |
| `onEntityDestroyed` → `spatialIndex.remove` | `cullSystem` (same as above) | yes | Ghost entry in the index |

The other six observers fail this test (see Appendix B for per-observer audits) and move to the per-tick `react` phase.

### Cascade rule

A bus handler that mutates components in a way that triggers another bus handler is a **cascade**. RFC-010 disallows cascades:

- Permitted: `Transform2D` change → `spatialIndex` update (the index is a non-ECS resource, so no further bus fires).
- Forbidden: `Transform2D` change → write to `WorldBounds` → triggers `WorldBounds` handler. (Today no such case exists; the rule is preventative.)

Enforcement: in dev builds, `world.addBusHandler` may set a per-frame "in-bus" flag and assert that no nested bus handler runs while it is set. Production builds do not enforce; the rule is a contract.

### Why two pipelines beats one

Could everything be a per-tick `react` system reading `queryChanged()`? In principle, yes — but `cullSystem` calls `spatialIndex.search()` directly, and the spatial index is not part of the World. To make spatial-index sync per-tick, `cull` would have to either: (a) iterate `world.queryChanged(Transform2D)` to update the index lazily before searching, or (b) accept a one-tick-stale spatial index. (a) violates separation of concerns (cull knows about index maintenance); (b) breaks correctness (drag a card and the same-tick cull call sees its old position).

The two-handler bus is a small price for keeping `cull`'s contract clean.

---

## Pipeline B — Phased per-tick pipeline

### Phase API (`@jamesyong42/reactive-ecs` v0.3.0)

The library extension is purely mechanism — no phase vocabulary. Phase names are passed in by the consumer and validated at register time.

**1. `SystemDef.phase` (optional, untyped string):**

```ts
// reactive-ecs/src/types.ts (delta)
export interface SystemDef {
  readonly name: string;
  readonly phase?: string;            // NEW — validated by PhasedScheduler against
                                      // its configured `phases` array
  readonly after?: string | string[];
  readonly before?: string | string[];
  execute: (world: World) => void;
}
```

**2. `PhasedScheduler<P>` — generic over the consumer's phase string set:**

```ts
// reactive-ecs/src/scheduler.ts (additions)
export interface PhasedSchedulerOptions<P extends string> {
  readonly phases: readonly P[];        // required, non-empty, no duplicates
  readonly defaultPhase?: P;            // optional; if unset, unstamped systems throw
}

export class PhasedScheduler<P extends string = string> {
  profiler: SystemProfiler | null = null;
  constructor(options: PhasedSchedulerOptions<P>) { /* validates phases */ }

  register(s: SystemDef) { /* validates s.phase ∈ phases or uses defaultPhase */ }
  remove(name: string)   { /* removes from owning bucket */ }
  execute(world: World)  { /* runs phases in configured order */ }

  getPhase(name: string): P | undefined;
  getPhases(): readonly P[];
  getSystemNames(): string[];
}
```

**3. infinite-canvas's chosen vocabulary** — declared once, imported everywhere:

```ts
// packages/infinite-canvas/src/ecs/engine/phases.ts (NEW)
export const ENGINE_PHASES = [
  'input', 'react', 'control', 'simulate', 'derive', 'present', 'cleanup',
] as const;

export type EnginePhase = (typeof ENGINE_PHASES)[number];
```

```ts
// packages/infinite-canvas/src/ecs/engine/LayoutEngine.ts (delta)
import { PhasedScheduler } from '@jamesyong42/reactive-ecs';
import { ENGINE_PHASES } from './phases.js';

const scheduler = new PhasedScheduler({
  phases: ENGINE_PHASES,
  defaultPhase: 'derive',
});
```

**Backwards compatibility.** `SystemScheduler` is unchanged. `PhasedScheduler` is purely additive in v0.3.0. Within `LayoutEngine.ts`, the `defaultPhase: 'derive'` option means existing systems registered without a `phase` field land in `'derive'` — same behaviour as v1's library-default. The change is *where* that default lives: per-instance config, not a library global.

### Within-phase ordering

`SystemScheduler` (existing) handles within-phase topo sort using Kahn's algorithm, falling back to registration order. Cross-phase `after` / `before` constraints are **invalid** — if you want X to run before Y across phases, put X in an earlier phase. Detection is lazy at first `execute()`, cached, invalidated on `register` / `remove`. If `s.after` names a system in a later phase (or `s.before` names one in an earlier phase), the scheduler throws with a message naming both systems and both phases.

The validation logic in v0.3.0 (excerpted):

```ts
// PhasedScheduler.ensureValidated() — runs once per dirty validation cycle
for (const [name, entry] of this.entries) {
  const sIdx = this.phaseToIndex.get(entry.phase) ?? -1;
  for (const dep of asArray(entry.system.after)) {
    const depEntry = this.entries.get(dep);
    if (!depEntry) continue; // unknown deps tolerated, matching SystemScheduler
    if ((this.phaseToIndex.get(depEntry.phase) ?? -1) > sIdx) {
      throw new Error(`System '${name}' (phase '${entry.phase}') declares after='${dep}', ` +
        `but '${dep}' is in later phase '${depEntry.phase}'. ...`);
    }
  }
  // symmetric check for `before`
}
```

### What goes in each phase

| Phase | Systems | Notes |
|---|---|---|
| `input` | `navStackCaptureSystem` | Snapshots `NavigationStackResource.changed` into `TickFlagsResource.navigationChangedSnapshot`; needed because `navigationFilter` resets the flag during `control`. RFC-009 will populate this phase further with input-event-drain systems. |
| `react` | `containerCameraSystem`, `parentFrameActiveSystem`, `roleRefreshSystem`, `dragPromoteSystem` | Six ex-observers consolidated. |
| `control` | `navigationFilterSystem` | `flyBack`/`cursor` were *here* in v2.1; corrected — see `simulate`/`present` and "Corrections since v2.1". |
| `simulate` | `transformTweenSystem`, `flyBackSystem` (`after: 'transformTween'`) | `flyBackSystem` is the completion poll for the fly-back tween, so it runs in the same phase right after `transformTween` removes a finished tween. |
| `derive` | `cardSystem`, `cullSystem`, `breakpointSystem`, `sortSystem` | Unchanged bodies. `cull` keeps `after: 'navigationFilter'`? **No** — `navigationFilter` is now in an earlier phase, so the constraint is implicit. Remove the explicit `after`. Same for `breakpoint`'s `after: 'cull'` (within-phase, keep) and `sort`'s `after: 'breakpoint'` (within-phase, keep). |
| `present` | `visibilitySystem`, `frameChangesSystem` (`after: 'visibility'`), `cursorSystem` | First two build the `VisibleEntitiesResource` / `FrameChangesResource` that `engine.getVisibleEntities()` / `getFrameChanges()` return. `cursorSystem` derives the `CursorResource` render output from post-flyBack interaction state; runs after `flyBack` purely by phase order (`simulate` < `present`) — no cross-phase `after` (the scheduler rejects those). |
| `cleanup` | `clearDirtySystem`, `incrementTickSystem` (`after: 'clearDirty'`), `emitFrameSystem` (`after: 'incrementTick'`), `tweenKeepaliveSystem` (`after: 'emitFrame'`) | `clearDirty` resets the World dirty buffers + `EngineDirtyResource`; `tweenKeepaliveSystem` runs last and re-sets `EngineDirtyResource.dirty` if any `TransformTween` is alive, so the rAF loop keeps the animation going. |

---

## `markDirty()` consolidation

### Today

56 sites. Every engine mutation API explicitly calls `markDirtyInternal()`. Every interaction state-machine transition explicitly calls `markDirty()`. The React boundary calls `engine.markDirty()` after some calls and not others, with no documented rule.

### After

Three classes:

**Class 1 — Implicit (engine internal).** Every `world.addComponent` / `setComponent` / `addTag` / `removeTag` / `destroyEntity` mutation flips a per-engine dirty bit. Implementation: a thin proxy on the World inside `LayoutEngine.ts` that observes mutation method calls and sets `dirty = true`. The 25 explicit `markDirtyInternal()` calls in `LayoutEngine.ts` collapse to zero. Camera and viewport mutations (which are resource changes, not component changes) keep an explicit `dirty = true` — this is fine, they're three sites.

**Class 2 — Implicit (interaction internal).** `interaction.ts` mutates the World through the same proxy; no explicit calls needed. The 23 `markDirty()` calls collapse to ~2 (the few cases that change non-ECS state, e.g., snap-guide visibility flag in a closure).

**Class 3 — Explicit external.** `react/InfiniteCanvas.tsx:250, 262` — these mutate non-ECS external state (CSS vars on the container element, shader uniforms in a module-scoped registry) and need to invalidate the present pipeline. Renamed to `engine.invalidatePresent()` for clarity. The other six React-boundary `markDirty()` calls (lines 155, 159, 163, 167, 171; `r3f/compositor/hooks.ts:30, 33, 38`) are deleted because they wrap APIs that already mark dirty.

**Net: 56 sites → ~5 sites.**

### Why not implicit-everywhere

Three remaining classes of mutation can't be auto-detected by a World proxy:

1. **Resource setters** (`setResource`) when callers mutate the returned object directly (e.g., `camera.x -= dx` at `LayoutEngine.ts:526`). The World can't know an external mutation happened. These keep explicit `dirty = true`.
2. **External-state changes** (CSS vars, shader uniforms). The World doesn't know about them; the explicit invalidate API is correct.
3. **Engine-public `markDirty()` API** (`LayoutEngine.ts:890`) survives for embedders who write to engine-adjacent state. Renamed to `invalidatePresent()` to match Class 3.

---

## Migration plan

The migration ships in five phases. Each phase is independently mergeable, independently rollback-able, and behaviour-preserving by Appendix-B audit.

### Phase 1 — Drag-promote → system (no scheduler change)

Smallest first step. Migrate the drag-promote observer to a regular `SystemDef` registered with `before: 'cull'`. No reactive-ecs API changes. Validates the migration pattern on the simplest observer.

- New file: `packages/infinite-canvas/src/ecs/systems/drag-promote.ts` (~30 LOC).
- `LayoutEngine.ts`: register `dragPromoteSystem` alongside the existing six. Delete observers at lines 224–248 (~24 LOC).
- New test: `packages/infinite-canvas/src/__tests__/drag-promote.test.ts`.
- Audit: Appendix B.1.

**Rollback:** revert one commit; one file.

### Phase 2 — `PhasedScheduler` in reactive-ecs + consumer-side `ENGINE_PHASES`

The reactive-ecs piece is done — `PhasedScheduler<P>` + `PhasedSchedulerOptions<P>` shipped in v0.3.0 with `SystemScheduler` unchanged. This phase does the consumer-side adoption:

- New file: `packages/infinite-canvas/src/ecs/engine/phases.ts` — declares `ENGINE_PHASES = ['input', 'react', 'control', 'simulate', 'derive', 'present', 'cleanup'] as const` and the derived `EnginePhase` type.
- `package.json`: bump `@jamesyong42/reactive-ecs` from `^0.2.0` to `^0.3.0`; `pnpm install`.
- `LayoutEngine.ts`: swap `new SystemScheduler()` for `new PhasedScheduler({ phases: ENGINE_PHASES, defaultPhase: 'derive' })`. Stamp each existing system with the phase it belongs in per § "What goes in each phase":
  - `cardSystem`, `cullSystem`, `breakpointSystem`, `sortSystem` → `phase: 'derive'`
  - `transformTweenSystem` → `phase: 'simulate'`
  - `navigationFilterSystem` → `phase: 'control'`
  - `dragPromoteSystem` → `phase: 'react'`
- Drop `before: 'cull'` from `dragPromoteSystem` (now implicit: `react < derive`). Drop `after: 'navigationFilter'` from `cullSystem` (now implicit: `control < derive`). Keep within-phase constraints `breakpoint after: 'cull'` and `sort after: 'breakpoint'`.
- New test: `packages/infinite-canvas/src/__tests__/engine-phases.test.ts` — verifies the phase order matches the documented vocabulary and that `getPhase('cull')` returns `'derive'`.

**Rollback:** revert engine PR; pin `@jamesyong42/reactive-ecs` back to `^0.2.0` if needed (the v0.3.0 publish itself is non-revocable but is purely additive, so older callers continue to work against it).

### Phase 3 — Migrate remaining observers

Five more observer migrations, one PR per observer. Each PR follows the Phase 1 pattern:

1. `containerCameraSystem` (LayoutEngine.ts:149–157)
2. `parentFrameActiveSystem` (LayoutEngine.ts:167–172) — also subsumes the `markDirty()` call at line 170
3. `roleRefreshSystem` (LayoutEngine.ts:212–215; absorbs the `refreshInteractionRole` helper at lines 177–211)

Each migration includes its Appendix-B audit, a focused test file, and deletion of the corresponding observer block.

**Rollback:** revert one PR; one observer worth of behaviour.

### Phase 4 — Inline tail of `tick()` → systems

Shipped as **one PR** (#17), not five — same rationale as Phase 3's single PR.

1. `flyBackSystem` (**`simulate` phase, `after: 'transformTween'`** — *not* `control`; see "Corrections since v2.1") — replaces `interaction.runFlyBackSystem()`. Exposed from `interaction.ts` as a `SystemDef` capturing the runtime closure; registered after `createInteractionRuntime`.
2. `cursorSystem` (**`present` phase** — *not* `control`) — replaces `interaction.runCursorSystem()`. Derives `CursorResource` from post-flyBack state; sequenced after `flyBack` by phase order alone.
3. `visibilitySystem` (`present` phase) — replaces the inline visible-entity build. Writes `VisibleEntitiesResource` (`{ current, prev }`) that `engine.getVisibleEntities()` reads.
4. `frameChangesSystem` (`present` phase, `after: 'visibility'`) — replaces the inline `FrameChanges` assembly. Writes `FrameChangesResource` that `engine.getFrameChanges()` reads; resets the per-tick camera/selection flags. The `navStackCaptureSystem` lives in the `input` phase (not subsumed here) and snapshots `navigationChanged` into `TickFlagsResource` before `control` resets it.
5. `clearDirtySystem` / `incrementTickSystem` / `emitFrameSystem` / `tweenKeepaliveSystem` (`cleanup` phase, chained via within-phase `after:`) — replace `world.clearDirty/incrementTick/emitFrame` + the tween-keepalive re-dirty. `clearDirty` also resets `EngineDirtyResource`; the 6 closure vars (`dirty`, `cameraChangedThisTick`, `selectionChangedThisTick`, `prevVisible`, `currentVisible`, `frameChanges`) are gone, replaced by `EngineDirtyResource` / `TickFlagsResource` / `VisibleEntitiesResource` / `FrameChangesResource`.

After phase 4, `tick()` body is:

```ts
tick() {
  profiler.beginFrame(world.currentTick);
  phasedScheduler.execute(world);
  profiler.endFrame(world.entityCount, getVisibleEntitiesCount());
}
```

**Rollback:** PRs are independent; each migration can be reverted.

### Phase 5 — `markDirty()` consolidation

1. Add a mutation-observing proxy over `world` inside `createLayoutEngine`.
2. Delete the explicit `markDirtyInternal()` calls inside `LayoutEngine.ts` mutation APIs (CRUD, undo/redo). Keep the ones the proxy *cannot* observe: camera in-place `CameraResource` mutation, `setViewport`/navigation via `setResource`, snap closure flags, and the `execute()` fallback for a hypothetical zero-mutation command (see "Corrections since v2.2" — "collapse to zero" was aspirational).
3. Delete the 6 redundant React-boundary calls (`InfiniteCanvas.tsx:155, 159, 163, 167, 171`; `compositor/hooks.ts:30, 33, 38`).
4. Rename `engine.markDirty()` → `engine.invalidatePresent()`. Update **all** callers — the two legit `InfiniteCanvas.tsx` sites **plus the 13 in `apps/playground/src/`** (the v2.2 plan undercounted; see "Corrections since v2.2"). A `tsc` pass over `apps/**` is the gate that should catch a missed consumer.
5. `interaction.ts` is left for RFC-009; the mutation proxy already handles its ~23 calls implicitly, so they become dead code that RFC-009 deletes.

**Rollback:** revert proxy commit; explicit calls remain valid.

### Phase ordering table

| Phase | Mergeable independently? | Reactive-ecs change? | Engine change? | Observer count | Tick LOC |
|---|---|---|---|---|---|
| (today) | — | — | — | 8 | ~100 inline |
| 1 | ✓ | no | yes | 7 | ~100 |
| 2 | ✓ | dep bump only (v0.3.0 already shipped) | yes | 7 | ~100 |
| 3 | ✓ × 3 PRs | no | yes | 4, 3, 2 | ~100 |
| 4 | ✓ × 5 PRs | no | yes | 2 | ~50, ~25, ~15, ~15, ~15 |
| 5 | ✓ | no | yes | 2 | ~15 |

---

## What gets deleted

- `LayoutEngine.ts` lines 130–142 stay (sync-reactive bus, two handlers).
- `LayoutEngine.ts` lines 149–157 → `containerCameraSystem` file (~−9 LOC engine, +20 LOC system).
- `LayoutEngine.ts` lines 167–172 → `parentFrameActiveSystem` file (~−7 LOC engine, +18 LOC system).
- `LayoutEngine.ts` lines 177–215 → `roleRefreshSystem` file (~−39 LOC engine, +50 LOC system).
- `LayoutEngine.ts` lines 224–248 → `dragPromoteSystem` file (~−25 LOC engine, +30 LOC system).
- `LayoutEngine.ts` lines 899–906 → `navStackCaptureSystem` file (~−8 LOC engine, +15 LOC system).
- `LayoutEngine.ts` lines 915–918 → `flyBackSystem` + `cursorSystem` files (~−4 LOC engine, +20 LOC each).
- `LayoutEngine.ts` lines 920–947 → `visibilitySystem` (~−28 LOC engine, +40 LOC system).
- `LayoutEngine.ts` lines 949–968 → `frameChangesSystem` (~−20 LOC engine, +30 LOC system).
- `LayoutEngine.ts` lines 977–993 → `cleanupSystems` (~−17 LOC engine, +35 LOC across four systems).
- `LayoutEngine.ts` 25 `markDirtyInternal()` calls deleted; one mutation-proxy added (~−25 LOC, +20 LOC).
- `react/InfiniteCanvas.tsx` 5 redundant `engine.markDirty()` deleted; 2 renamed to `invalidatePresent()`.
- `r3f/compositor/hooks.ts` 3 redundant `engine.markDirty()` deleted.

**Estimated totals:** `LayoutEngine.ts` shrinks by ~400 LOC; ~250 LOC added across 11 new system files; reactive-ecs gained ~200 LOC in v0.3.0 for `PhasedScheduler<P>` + tests (already shipped); infinite-canvas gains ~10 LOC for `engine/phases.ts`.

---

## Decisions

### Decided

1. **Two pipelines, not one.** Keeping a small sync-reactive bus is correct because `cullSystem`'s clean contract depends on a live spatial index. Collapsing everything into per-tick reactive systems would either leak index-maintenance into `cull` or accept correctness regressions.
2. **`react` phase before `control` phase.** A `control`-phase system can rely on `react`-phase invariants (drag-promote ran, ContainerCamera attached, etc.).
3. **Phases are consumer-defined, not library-defined.** `reactive-ecs` ships `PhasedScheduler<P extends string>` with no phase vocabulary; consumers declare their own via the `phases` constructor option. infinite-canvas's seven phases live in `packages/infinite-canvas/src/ecs/engine/phases.ts`. Rationale: the same library should serve a UI tool, a game engine, and an agent simulator without imposing one project's vocabulary on the others.
4. **Per-instance `defaultPhase`, not a library default.** Each `PhasedScheduler` instance can declare a `defaultPhase` for unstamped systems. infinite-canvas sets this to `'derive'` so existing migration is gradual; other consumers pick whatever fits their pipeline.
5. **Cross-phase `after` / `before` is an error.** Phase order is the only mechanism for cross-phase ordering; mixing the two creates a second source of truth.
6. **Bus cascades are forbidden.** One mutation, at most one bus handler chain. Dev-mode reentrancy assertion to enforce.
7. **`SystemProfiler.beginPhase` / `endPhase`.** Optional hooks on `SystemProfiler` (already shipped in v0.3.0). `PhasedScheduler` brackets each non-empty phase; existing profilers without these methods continue to work.
8. **`engine.markDirty()` → `engine.invalidatePresent()`.** The remaining external callers signal "the present output is stale because non-ECS state changed." The new name reflects this.

### Open

1. **`world.queryAddedTag` / `queryRemovedTag` primitives.** RFC-010 uses stash-component diff signals (e.g., `PreDragLayer` for drag-promote) to avoid needing tag-change queries. If a future system genuinely needs "tags added this tick", reactive-ecs grows a primitive then.
2. **Engine-level dirty bit as a resource.** Today it's a closure variable (`let dirty = false` in `createLayoutEngine`). Moving it to a resource (`EngineDirtyResource`) makes `tweenKeepaliveSystem` a normal system instead of a closure-mutating outlier. Phase 5 does this; the alternative is keeping the closure and exposing setters to the cleanup systems.
3. **Should `present` phase own DOM/WebGL writes?** Today they live in `react/InfiniteCanvas.tsx:319–480` (rAF loop tail). Moving them into engine systems would require the engine to know about React refs and the WebGL manager. RFC-010 says **no, leave them in React** — the boundary stays clean. `present` phase's responsibility ends at building output state (`VisibleEntitiesResource`, `FrameChangesResource`); React reads those after `tick()` returns.

### Rejected

1. **Phase as a string array on each system (e.g., `phases: ['react', 'derive']`).** Allowing a system to declare multiple phases creates a second scheduling problem (which phase wins when `after` constraints disagree?). One-phase-per-system is simpler.
2. **Removing `SystemScheduler` from the public API.** It's used inside `PhasedScheduler` per phase. Keeping it public means embedders can run a single phase manually if they need to (e.g., for testing).
3. **Library-default phase vocabulary.** v1 of this RFC shipped `Phase`, `PHASE_ORDER`, and `DEFAULT_PHASE = 'derive'` from reactive-ecs. Withdrawn — wrong abstraction layer, see Decided #3. The constants now live in infinite-canvas.
4. **A `late` phase between `present` and `cleanup`.** Speculative. Add only if a concrete need surfaces.
5. **Per-system `enabled` flag.** RFC-009 can do this via state-system gating. Don't bake it into the scheduler.

---

## Appendix A — `dragPromoteSystem` walkthrough

The canonical migration. Demonstrates the diff-signal pattern: a stash component (`PreDragLayer`) acts as the "currently promoted" flag, removing the need for a `queryAddedTag` primitive.

### Today (LayoutEngine.ts:224–248)

```ts
unsubscribers.push(
  world.onTagAdded(Dragging, (entity) => {
    if (world.hasComponent(entity, PreDragLayer)) return;
    if (!world.hasComponent(entity, Card)) return;
    const widget = world.getComponent(entity, WidgetComp);
    if (widget?.surface === 'webgl') return;
    const prev = world.getComponent(entity, Layer)?.name ?? 'base';
    world.addComponent(entity, PreDragLayer, { name: prev });
    if (world.hasComponent(entity, Layer)) {
      world.setComponent(entity, Layer, { name: 'overlay' });
    } else {
      world.addComponent(entity, Layer, { name: 'overlay' });
    }
    markDirtyInternal();
  }),
);
unsubscribers.push(
  world.onTagRemoved(Dragging, (entity) => {
    const stash = world.getComponent(entity, PreDragLayer);
    if (!stash) return;
    world.setComponent(entity, Layer, { name: stash.name });
    world.removeComponent(entity, PreDragLayer);
    markDirtyInternal();
  }),
);
```

### After (`packages/infinite-canvas/src/ecs/systems/drag-promote.ts`)

```ts
import type { World } from '@jamesyong42/reactive-ecs';
import { defineSystem } from '@jamesyong42/reactive-ecs';
import { Card, Dragging, Layer, PreDragLayer, Widget as WidgetComp } from '../components.js';

/**
 * Promotes a dragged DOM card to the 'overlay' layer so it visually pops above
 * its siblings. Reverses on drag end. R3F cards opt out — the compositor
 * handles their stacking via uDraggedRect + renderOrder bump.
 *
 * Diff signal: presence of `PreDragLayer` is the "currently promoted" flag.
 *   Dragging present, no PreDragLayer  → promote
 *   PreDragLayer present, no Dragging  → restore
 */
export const dragPromoteSystem = defineSystem({
  name: 'dragPromote',
  phase: 'react',
  execute: (world: World) => {
    for (const entity of world.queryTagged(Dragging)) {
      if (world.hasComponent(entity, PreDragLayer)) continue;
      if (!world.hasComponent(entity, Card)) continue;
      if (world.getComponent(entity, WidgetComp)?.surface === 'webgl') continue;
      const prev = world.getComponent(entity, Layer)?.name ?? 'base';
      world.addComponent(entity, PreDragLayer, { name: prev });
      if (world.hasComponent(entity, Layer)) {
        world.setComponent(entity, Layer, { name: 'overlay' });
      } else {
        world.addComponent(entity, Layer, { name: 'overlay' });
      }
    }

    for (const entity of world.query(PreDragLayer)) {
      if (world.hasTag(entity, Dragging)) continue;
      const stash = world.getComponent(entity, PreDragLayer);
      if (!stash) continue;
      world.setComponent(entity, Layer, { name: stash.name });
      world.removeComponent(entity, PreDragLayer);
    }
  },
});
```

LOC: ~30 (vs. 25 inline). No `markDirtyInternal()` — the system runs *inside* a tick, so we are by definition not idle. Profiler-instrumented for free.

---

## Appendix B — Per-observer behavioural-parity audits

For each migrated observer, the question is: does any code synchronously read the observer's output between the trigger mutation and the next rAF tick? If no, the migration is behaviour-preserving.

### B.1 `dragPromoteSystem`

- **Trigger**: `addTag(Dragging)` / `removeTag(Dragging)`.
- **Output**: `Layer.name`, `PreDragLayer` component.
- **Mutation sites**: `interaction.ts:501, 578, 674, 730, 931`.
- **Synchronous readers of `Layer` after mutation**:
  - `LayoutEngine.ts:967` — `world.queryChanged(Layer).length > 0` for `frameChanges.layersChanged`. Runs **at the end of the same tick** in the `present` phase, after `dragPromoteSystem` has already flipped `Layer`. Captures the change.
  - `react/InfiniteCanvas.tsx:516` — `engine.get(id, Layer)?.name` inside a `useMemo` keyed on `[visibleEntities, engine]`. `visibleEntities` is React state set by the rAF loop (line 421), which runs *after* `engine.tick()` returns. The read is post-tick, post-system. Same answer as today.
  - `interaction.ts` — zero synchronous reads of `Layer`. Confirmed by `grep -n "Layer\|PreDragLayer" interaction.ts` returning only doc-comment matches.
- **Verdict**: behaviour-preserving.

### B.2 `containerCameraSystem`

- **Trigger**: `addComponent(entity, Container)`.
- **Output**: `ContainerCamera` component (default `{ x: 0, y: 0, zoom: 1 }`).
- **Synchronous readers of `ContainerCamera` after `Container` is added**: `enterContainer` at `LayoutEngine.ts:798–842` reads `getComponent(entity, ContainerCamera)`. But `enterContainer` is a public API, not called immediately after `addComponent(Container)` in the same call frame; users add a Container in one tick, enter it in another.
- **Edge case**: a serialization round-trip that adds `Container` and immediately calls `enterContainer` in the same tick would today see the auto-attached `ContainerCamera`. After migration, `enterContainer` falls through to its own default `{ x: 0, y: 0, zoom: 1 }` (line 830) — same observable value.
- **Verdict**: behaviour-preserving.

### B.3 `parentFrameActiveSystem`

- **Trigger**: `addComponent` / `setComponent` of `ParentFrame`. **Not `removeComponent`** — see pre-existing limitation below.
- **Output**: `Active` tag (toggled via `reconcileEntityActive`), and an engine-dirty flag.
- **Synchronous readers of `Active` after `ParentFrame` mutation**: `cullSystem` reads `queryTagged(Active)` — but cull is in `derive` phase, two phases after `react`. Same-tick read sees the updated `Active` tag.
- **Edge case**: a command that mutates `ParentFrame` and immediately reads `queryTagged(Active)` in the same call frame (e.g., a custom command implementation). Today: observer fires sync, read sees the new `Active`. After: `Active` is updated in the next tick's `react` phase. **Behavioural change.** Mitigation: search for any same-frame `queryTagged(Active)` after `ParentFrame` mutation; today there are none in the codebase. Add an assertion in dev mode if one shows up.
- **Pre-existing limitation — `ParentFrame` *remove* is not handled**: `reactive-ecs` does not emit a change event on `removeComponent`. The original `onComponentChanged(ParentFrame)` observer therefore never fired on remove, despite a stale RFC-004 § Phase 5 comment claiming otherwise. The new system inherits the same gap (`queryChanged` also skips removes). The "child returns to root" recovery path runs via `navigationFilterSystem` on the next `navStack.changed`. To fix properly, either (a) push `navStack.changed = true` from the remover, or (b) add `world.queryRemoved` to reactive-ecs.
- **Verdict**: behaviour-preserving for current callers; documented one-tick latency for hypothetical future same-frame readers; the remove-path gap is a pre-existing bug, not a regression.

### B.4 `roleRefreshSystem`

- **Trigger**: `addTag` / `removeTag` of `Draggable` or `Selectable`.
- **Output**: `InteractionRole`, `CursorHint` components.
- **Synchronous readers**: `interaction.ts` reads `InteractionRole` during pointer dispatch. Pointer events fire from React handlers, which post markDirty and wait for the rAF tick. By the time the next pointer event arrives, the `react` phase has run and `InteractionRole` is up to date.
- **Edge case**: a component listing UI that toggles `Draggable` and reads `InteractionRole` in the same React render. Today: sync, sees new role. After: one tick later. Mitigation: same as B.3 — none of these patterns exist today.
- **Verdict**: behaviour-preserving for current callers.

### B.5 Spatial index (stays sync)

- **Trigger**: `addComponent` / `setComponent` of `Transform2D`, `onEntityDestroyed`.
- **Output**: spatial index entries.
- **Synchronous readers**: `cullSystem` calls `spatialIndex.search()` in the `derive` phase, *same tick* as the mutation that triggered the bus. **Must be live.**
- **Verdict**: stays in the sync-reactive bus.

---

## Appendix C — Open questions

1. Should `engine.invalidatePresent()` and the engine-internal dirty bit converge into one mechanism, or stay distinct? Today they are the same flag; after the refactor they could remain so, but naming the public API differently from the internal state may aid clarity.

2. Should `reactive-ecs` ship `PhasedScheduler` as the default exported scheduler, demoting `SystemScheduler` to a per-phase implementation detail? Risks breaking embedders who built their own pipelines on top of the simpler scheduler. Defer to RFC-010 v2 once production usage is observable.

3. Do consumer hooks (`react/hooks/ecs.ts`) need a `present`-phase equivalent? Today they subscribe to `engine.onFrame` and read state directly. If the engine moves visibility/`FrameChanges` into resources, hooks could read those resources directly — but the boundary is already clean enough.
