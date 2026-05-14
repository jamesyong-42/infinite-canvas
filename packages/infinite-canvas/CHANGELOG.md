# Changelog

## [1.4.0](https://github.com/jamesyong-42/infinite-canvas/compare/infinite-canvas-v1.3.0...infinite-canvas-v1.4.0) (2026-05-14)


### Features

* **rfc-010:** swap to PhasedScheduler + ENGINE_PHASES (Phase 2) ([#12](https://github.com/jamesyong-42/infinite-canvas/issues/12)) ([307855b](https://github.com/jamesyong-42/infinite-canvas/commit/307855b9eac12ab9a505b8763f3843c90a893117))

## [1.3.0](https://github.com/jamesyong-42/infinite-canvas/compare/infinite-canvas-v1.2.0...infinite-canvas-v1.3.0) (2026-05-14)


### Features

* **camera:** gesturing flag + dynamic DPR + deferred band repaints ([76e7635](https://github.com/jamesyong-42/infinite-canvas/commit/76e7635b6a1009ff915f65a5d711f222dcd9b3bf))
* **ecs:** add Culled tag, complement of Visible for Active entities ([5e78ab3](https://github.com/jamesyong-42/infinite-canvas/commit/5e78ab3da092a2af6662e29963cd747bbf0b76a3))
* **ecs:** add Layer component + LayerOrderResource (RFC-003 Phase 1) ([7535cfa](https://github.com/jamesyong-42/infinite-canvas/commit/7535cfae09137fef7a9a41e6daadce3b94cb39fc))
* **engine:** drag-promote system (RFC-003 Phase 3) ([b0225a1](https://github.com/jamesyong-42/infinite-canvas/commit/b0225a1f0d47f462de49749925e4daf8a1847386))
* **grid:** tune dot grid for Freeform/FigJam aesthetic ([1ccd93e](https://github.com/jamesyong-42/infinite-canvas/commit/1ccd93e83b8a6e065482e4681e5551faf5075a06))
* **overlap-glow:** tunable inset-shadow glow + radial rim for drag-over ([e7dd75f](https://github.com/jamesyong-42/infinite-canvas/commit/e7dd75fe15c4c518ebc2887d767d0c5d09cf076b))
* **profiler:** extend R3FSample with compositor fields ([49811ce](https://github.com/jamesyong-42/infinite-canvas/commit/49811ce554df7e62b68c26cabbbf64b45ad1d99a))
* **r3f:** add widget state machine with Hot/Warm/Cold/Waking/Dormant phases ([5d4bf5d](https://github.com/jamesyong-42/infinite-canvas/commit/5d4bf5d36316fae6f60fbb034001a1da48d65784))
* **r3f:** add WidgetRenderTargetPool ([f33e712](https://github.com/jamesyong-42/infinite-canvas/commit/f33e7125e2491e1d21fe1e8899d2ffd1809a73e4))
* **r3f:** compositor drag-clip + renderOrder bump (RFC-003 Phase 4) ([919de5d](https://github.com/jamesyong-42/infinite-canvas/commit/919de5d5c8d88bea7448096c9a7da798f55fc4c2))
* **r3f:** drop-shadow on lifted composition quad (Phase 7) ([4874667](https://github.com/jamesyong-42/infinite-canvas/commit/4874667ab2a7e13f315088f61c56072995d85be2))
* **r3f:** pool eviction with phase-priority + Dormant protection (Phase 6) ([1087540](https://github.com/jamesyong-42/infinite-canvas/commit/108754028ea4326b0a1fe4e7fc978a217168080d))
* **r3f:** zoom-banded FBO resolution (Phase 5) ([e3e7be2](https://github.com/jamesyong-42/infinite-canvas/commit/e3e7be2af33c8e610b07754e7b1c92550eb181b6))
* **react:** three DOM layer containers in InfiniteCanvas (RFC-003 Phase 2) ([a3d9c23](https://github.com/jamesyong-42/infinite-canvas/commit/a3d9c2301f6bf283e3921a8f4902d46e1c3e9a7a))
* **rfc-004,rfc-005:** card interaction + container hierarchy + handle refactor ([e377a31](https://github.com/jamesyong-42/infinite-canvas/commit/e377a3120af2e2020902777d512aa7c91d883ea1))
* **rfc-006:** pointer event routing for DOM + R3F widgets ([cb4a9ff](https://github.com/jamesyong-42/infinite-canvas/commit/cb4a9ff62e05669802bf6f3733065c63496821d1))
* **rfc-007:** touch event routing — extract TouchEventBus, fix R3F drag ([6a59dcc](https://github.com/jamesyong-42/infinite-canvas/commit/6a59dcc0ccb8243d8cdc25b34fc6f8023449bd4d))
* **rfc-008:** phase 1 — InputManager skeleton + PointerAdapter ([4726719](https://github.com/jamesyong-42/infinite-canvas/commit/4726719d9aeb84e7b490115abd8c52bedfeb2e73))
* **rfc-008:** phase 2 — WheelAdapter replaces inline wheel useEffect ([041cd95](https://github.com/jamesyong-42/infinite-canvas/commit/041cd957097eddf0fe6340f03eeb74429f8b898f))
* **rfc-008:** phase 3a — all six recognizers + tests (not yet wired) ([dec874b](https://github.com/jamesyong-42/infinite-canvas/commit/dec874b64cd2d43009411465918121fcd9ecd839))
* **rfc-008:** phase 3b — engine input API split (begin/update/end Drag/Resize/Marquee) ([906ba52](https://github.com/jamesyong-42/infinite-canvas/commit/906ba52368dba7ee7f0df2c1e5a05f245e3fcd0e))
* **rfc-008:** phase 3c — R3FRouter + createR3FEventManager (not yet wired) ([ad20545](https://github.com/jamesyong-42/infinite-canvas/commit/ad205458532da4d72eac48e25adef0dacaf6eba4))
* **rfc-008:** phase 3d — the swap (delete buses, wire InputManager pipeline, bump 2.0) ([83053bf](https://github.com/jamesyong-42/infinite-canvas/commit/83053bf35efc25ca4675fbf4747e1a4fc94ab958))
* **rfc-008:** unify click/dblclick/contextmenu/pointerleave into InputManager (v6) ([ae0bee9](https://github.com/jamesyong-42/infinite-canvas/commit/ae0bee958201c0e83109640190270e0095f13109))
* **rfc-010:** drag-promote observers → dragPromoteSystem (Phase 1) ([#11](https://github.com/jamesyong-42/infinite-canvas/issues/11)) ([d4a7607](https://github.com/jamesyong-42/infinite-canvas/commit/d4a76072e036f3f4c855247ff226970fded67619))


### Bug Fixes

* **engine:** drag-promote skips R3F widgets — chrome was occluding 3D ([70ffc11](https://github.com/jamesyong-42/infinite-canvas/commit/70ffc116b618679a4020d030778acaeec1764da3))
* profiler WebGL capture, drag-cancel z-index restore, and cleanup ([365e4cd](https://github.com/jamesyong-42/infinite-canvas/commit/365e4cd462ae19f2c359c8b16469d078e5ae1656))
* **r3f, react:** post-Phase-4 fixes — colors + drag-promote zIndex ([1afbd97](https://github.com/jamesyong-42/infinite-canvas/commit/1afbd97115b4bde76762699a68c043154566cb8b))
* **r3f:** Compositor / widget lifecycle polish ([48e0c31](https://github.com/jamesyong-42/infinite-canvas/commit/48e0c313eb27ee5c55a5ebaf05651b3d8f745938))
* **r3f:** drag-lift in composition + opt-in continuous animation ([3cb6eb6](https://github.com/jamesyong-42/infinite-canvas/commit/3cb6eb6c1308a4d7d4411ecaecdbf069d5c7087d))
* **r3f:** kick the engine when useWidgetAnimation toggles ([3131096](https://github.com/jamesyong-42/infinite-canvas/commit/3131096ebe4ac9c0d14ce177515d213057c89fc9))
* **r3f:** match direct-render color output via sRGB FBO + MeshBasicMaterial ([4459ab4](https://github.com/jamesyong-42/infinite-canvas/commit/4459ab477ca0af7ca76d1f895d3925715424fbd6))
* **r3f:** mirror CSS lift scale on the WebGL composition quad ([7bca8b6](https://github.com/jamesyong-42/infinite-canvas/commit/7bca8b6f4de80f01b7e6ed92835a95c2e772108a))
* **r3f:** post-Phase-7 audit fixes ([aabb290](https://github.com/jamesyong-42/infinite-canvas/commit/aabb290bad052791019d2872285104e342ec5f0c))
* **r3f:** re-create disposed pool / registry on remount ([2910713](https://github.com/jamesyong-42/infinite-canvas/commit/2910713ff2329fe7da406b8dbd02ddd2117c49f1))
* **r3f:** share scene.environment across per-widget scenes ([29f6844](https://github.com/jamesyong-42/infinite-canvas/commit/29f6844f173dc2d1a437d826c7b54e649217dc58))
* **r3f:** tighten compositor GPU lifecycle ([eae7ee4](https://github.com/jamesyong-42/infinite-canvas/commit/eae7ee42e04de2748e4a52edda65d543f5827326))
* **r3f:** wire the Waking phase + add useWidgetInvalidate ([de7cfc8](https://github.com/jamesyong-42/infinite-canvas/commit/de7cfc85aabcc1343faa82255647a2d02b553b56))
* **react:** apply overlay zIndex via effect, not Tailwind class ([37e4f15](https://github.com/jamesyong-42/infinite-canvas/commit/37e4f15246f7b3b679782fc671ebc84e3c34d5fa))
* **react:** re-bucket slots on Layer change (drag-promote actually fires) ([e8b9981](https://github.com/jamesyong-42/infinite-canvas/commit/e8b998174fd8fca29cbf0c9c39f50df6aa2ef430))
* **rfc-008:** address audit findings on phases 1-3c ([5d015d0](https://github.com/jamesyong-42/infinite-canvas/commit/5d015d099ad3dc3e07a9deae9aac74d5451f967e))
* **rfc-008:** address phase 3d audit findings ([a1f88f4](https://github.com/jamesyong-42/infinite-canvas/commit/a1f88f46f00981f1c559cd78543c39e757409546))
* **rfc-008:** browser regressions — resize handles + R3F mesh onClick ([97fafeb](https://github.com/jamesyong-42/infinite-canvas/commit/97fafeb9831dc0ba767688f18c9d35409e4ffe95))
* **rfc-008:** widget pointer-capture claim mechanism ([5c8ac00](https://github.com/jamesyong-42/infinite-canvas/commit/5c8ac0097d8f22c82520c5d1697618ec1e83d87a))


### Performance Improvements

* **r3f:** share geometries / materials / textures across widget scenes ([ec331f5](https://github.com/jamesyong-42/infinite-canvas/commit/ec331f549d58f90e40d267b5e1334cab213f548f))
* **r3f:** switch canvas to frameloop=demand with invalidation wiring ([a13813c](https://github.com/jamesyong-42/infinite-canvas/commit/a13813ce8aba13dcc0376a59731ea87f379e0d27))

## [1.2.0](https://github.com/jamesyong-42/infinite-canvas/compare/infinite-canvas-v1.1.0...infinite-canvas-v1.2.0) (2026-04-22)


### Features

* iOS-style card widgets + R3F PBR cards + multi-layer profiler ([#8](https://github.com/jamesyong-42/infinite-canvas/issues/8)) ([92846f3](https://github.com/jamesyong-42/infinite-canvas/commit/92846f3fb38439328435a72d73cff8413651f775))
* **profiler:** engine WebGL fps + budget, total-frame stacked bar ([92846f3](https://github.com/jamesyong-42/infinite-canvas/commit/92846f3fb38439328435a72d73cff8413651f775))

## [1.1.0](https://github.com/jamesyong-42/infinite-canvas/compare/infinite-canvas-v1.0.0...infinite-canvas-v1.1.0) (2026-04-21)


### Features

* live ECS editor + engine mutation sugar ([#4](https://github.com/jamesyong-42/infinite-canvas/issues/4)) ([d71bc8d](https://github.com/jamesyong-42/infinite-canvas/commit/d71bc8d81c73d95eab10721c6ae5f655ac647141))

## [1.0.0](https://github.com/jamesyong-42/infinite-canvas/compare/infinite-canvas-v0.1.0...infinite-canvas-v1.0.0) (2026-04-13)


### ⚠ BREAKING CHANGES

* redesign widget API around schemas, archetypes, and engine.spawn

### Bug Fixes

* **ci:** consume @jamesyong42/reactive-ecs from npm, not sibling path ([2fa1927](https://github.com/jamesyong-42/infinite-canvas/commit/2fa1927fb7d222f03f4108c0190a6e3ec9cfecd9))


### Code Refactoring

* redesign widget API around schemas, archetypes, and engine.spawn ([eaadfd2](https://github.com/jamesyong-42/infinite-canvas/commit/eaadfd212108c525c36b9187914ccae85609ab96))

## [0.1.0](https://github.com/jamesyong-42/infinite-canvas/compare/infinite-canvas-v0.0.1...infinite-canvas-v0.1.0) (2026-04-12)


### Features

* ECS-native hitbox, interaction role & cursor system (RFC-001) ([#1](https://github.com/jamesyong-42/infinite-canvas/issues/1)) ([d073b42](https://github.com/jamesyong-42/infinite-canvas/commit/d073b42c3e462fbf14313889b8e57648fa561ea3))


### Bug Fixes

* comprehensive production-readiness fixes across ECS, React, WebGL, and build ([928b6a3](https://github.com/jamesyong-42/infinite-canvas/commit/928b6a31098f9adeedba0d6039c7a8d6f9993107))
