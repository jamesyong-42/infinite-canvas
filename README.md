# Infinite Canvas

[![CI](https://github.com/jamesyong-42/infinite-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/jamesyong-42/infinite-canvas/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jamesyong42/infinite-canvas)](https://www.npmjs.com/package/@jamesyong42/infinite-canvas)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**[Live Demo](https://jamesyong-42.github.io/infinite-canvas/)** | **[npm](https://www.npmjs.com/org/jamesyong42)**

A high-performance infinite canvas library for React, built on an Entity Component System (ECS) architecture with WebGL-accelerated rendering.

## Features

- **ECS-powered** — Decoupled entity/component architecture with spatial indexing (RBush), change detection, and topologically-sorted system scheduling
- **Dual rendering surfaces** — DOM widgets and WebGL (R3F) widgets on the same canvas
- **GPU-rendered chrome** — Dot grid, selection outlines, resize handles, hover highlights, and snap guides all rendered via SDF shaders in a single draw call
- **Figma-style interactions** — Snap alignment (edge/center), equal spacing detection, multi-select group bounding box
- **Mobile-first gestures** — iOS Freeform-style touch: single-finger pan, pinch-to-zoom, tap-to-select, double-tap to enter containers
- **Responsive widgets** — Breakpoint system adapts widget rendering based on screen-space size (micro/compact/normal/expanded/detailed)
- **Undo/redo** — Command buffer with grouped operations (entire drag = one undo step)
- **Hierarchical navigation** — Enter/exit nested containers with camera state preservation
- **Performance profiling** — Built-in profiler with User Timing API integration, per-system timing, percentile stats
- **Dark mode** — Full dark mode support across canvas, widgets, and UI panels
- **Configurable** — Grid, selection, snap, zoom, and breakpoint parameters all exposed

## Package

Everything ships in a single package: **`@jamesyong42/infinite-canvas`**. It exposes three entry points:

| Import | Purpose |
|--------|---------|
| `@jamesyong42/infinite-canvas` | Main API — `<InfiniteCanvas>`, `createLayoutEngine`, hooks, built-in components |
| `@jamesyong42/infinite-canvas/ecs` | ECS primitives for advanced users (`defineComponent`, `defineSystem`, `World`) |
| `@jamesyong42/infinite-canvas/advanced` | WebGL renderers, serialization, profiler, spatial index |

## Quick Start

```bash
npm install @jamesyong42/infinite-canvas react react-dom
# For WebGL widgets (optional):
npm install three @react-three/fiber
```

```tsx
import { createLayoutEngine, InfiniteCanvas, useWidgetData } from '@jamesyong42/infinite-canvas';

// 1. Define your widget component
function MyCard({ entityId }) {
  const data = useWidgetData(entityId);
  return <div className="p-4 bg-white rounded shadow">{data.title}</div>;
}

// 2. Create the layout engine
const engine = createLayoutEngine({ zoom: { min: 0.05, max: 8 } });

// 3. Add widgets
engine.addWidget({
  type: 'card',
  position: { x: 100, y: 100 },
  size: { width: 250, height: 180 },
  data: { title: 'Hello World' },
});

// 4. Render — widgets prop wires up the widget types
function App() {
  return (
    <InfiniteCanvas
      engine={engine}
      widgets={[
        { type: 'card', component: MyCard, defaultSize: { width: 250, height: 180 } },
      ]}
      className="h-screen w-screen"
    />
  );
}
```

## WebGL Widgets (R3F)

Register widgets with `surface: 'webgl'` to render 3D content via React Three Fiber:

```tsx
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

function My3DWidget({ entityId, width, height }) {
  const meshRef = useRef();
  useFrame((_, delta) => { meshRef.current.rotation.y += delta; });
  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[width * 0.5, height * 0.5, 50]} />
      <meshBasicMaterial color="hotpink" wireframe />
    </mesh>
  );
}

<InfiniteCanvas
  engine={engine}
  widgets={[
    { type: 'my-3d', surface: 'webgl', component: My3DWidget, defaultSize: { width: 250, height: 250 } },
  ]}
/>
```

WebGL widgets get a transparent R3F canvas layered between the grid and DOM layers. The R3F camera is synced with the engine camera every frame. Widget components receive `entityId`, `width`, and `height` props and work in centered local coordinates.

## Widget Development

Widgets are React components that receive `entityId` and use hooks to read/write ECS data:

```tsx
import {
  Transform2D,
  useBreakpoint,
  useComponent,
  useIsSelected,
  useUpdateWidget,
  useWidgetData,
} from '@jamesyong42/infinite-canvas';

function MyWidget({ entityId }) {
  const data = useWidgetData(entityId);            // custom widget data
  const breakpoint = useBreakpoint(entityId);      // 'micro' | 'compact' | 'normal' | 'expanded' | 'detailed'
  const isSelected = useIsSelected(entityId);      // selection state
  const transform = useComponent(entityId, Transform2D);  // position/size
  const updateWidget = useUpdateWidget(entityId);  // update widget data

  if (breakpoint === 'micro') return <div>...</div>;   // minimal view
  if (breakpoint === 'compact') return <div>...</div>; // condensed view
  return <div>...</div>;                                // full view
}
```

## Configuration

### Grid

```tsx
<InfiniteCanvas
  engine={engine}
  grid={{
    spacings: [8, 64, 512],       // world-px grid levels [fine, medium, coarse]
    dotColor: [0, 0, 0],          // RGB 0-1
    dotAlpha: 0.18,               // base opacity
    fadeIn: [4, 12],              // CSS-px fade in range
    fadeOut: [250, 500],          // CSS-px fade out range
    dotRadius: [0.5, 1.4],       // CSS-px dot size range
    levelWeight: [1.0, 0.4],     // opacity weight per grid level
  }}
/>

// Disable grid
<InfiniteCanvas engine={engine} grid={false} />
```

### Selection

```tsx
<InfiniteCanvas
  engine={engine}
  selection={{
    outlineColor: [0.051, 0.6, 1.0],  // Figma blue
    outlineWidth: 1.5,
    handleSize: 8,
    handleFill: [1, 1, 1],
    handleBorder: [0.051, 0.6, 1.0],
    handleBorderWidth: 1.5,
    hoverColor: [0.051, 0.6, 1.0],
    hoverWidth: 1.0,
    groupDash: 4,
  }}
/>
```

### Engine

```tsx
const engine = createLayoutEngine({
  zoom: { min: 0.05, max: 8 },
  breakpoints: { micro: 40, compact: 120, normal: 500, expanded: 1200 },
});

// Snap guides
engine.setSnapEnabled(true);
engine.setSnapThreshold(5); // world pixels
```

## Architecture

```
@jamesyong42/infinite-canvas
├── Main API        (InfiniteCanvas, createLayoutEngine, hooks, components)
├── /ecs            (ECS primitives: defineComponent, defineSystem, World)
└── /advanced       (WebGL renderers, serialization, profiler, spatial index)
```

### Rendering Stack

```
z:0  WebGL canvas (Three.js)
     ├── GridRenderer        — multi-level dot grid (SDF shader)
     └── SelectionRenderer   — outlines, handles, hover, snap guides (SDF shader)

z:1  R3F canvas (React Three Fiber, lazy)
     └── WebGL widgets       — 3D content with synced orthographic camera

z:2  DOM layer
     ├── WidgetSlots         — DOM widget content + pointer events
     └── SelectionOverlays   — invisible pointer event layer for WebGL widgets

z:3  UI chrome
     └── Panels, buttons, toggles
```

### ECS Components

| Component | Description |
|-----------|-------------|
| `Transform2D` | Position, size, rotation |
| `WorldBounds` | Computed world-space bounds (propagated from parent) |
| `Widget` | Surface (`'dom'`/`'webgl'`) and type identifier |
| `WidgetData` | Arbitrary widget-specific data |
| `WidgetBreakpoint` | Computed responsive breakpoint |
| `ZIndex` | Rendering order |
| `Parent` / `Children` | Hierarchy |
| `Container` | Marks entity as enterable |

### ECS Tags

`Selectable` `Draggable` `Resizable` `Locked` `Selected` `Active` `Visible`

### Systems (execution order)

1. `transformPropagate` — Propagate transforms down hierarchy, compute WorldBounds
2. `spatialIndex` — Update RBush spatial index
3. `navigationFilter` — Filter entities to active navigation layer
4. `cull` — Mark viewport-visible entities
5. `breakpoint` — Compute responsive breakpoints
6. `sort` — Z-index ordering

## Keyboard Shortcuts (Playground)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Escape` | Exit container |
| `Delete` / `Backspace` | Delete selected |
| Double-click | Enter container |

## Performance Profiling

Enable the built-in profiler via the Inspector panel or programmatically:

```tsx
engine.profiler.setEnabled(true);

// After some frames:
const stats = engine.profiler.getStats();
console.log(stats.fps);              // frames per second
console.log(stats.frameTime.p95);    // 95th percentile frame time (ms)
console.log(stats.systemAvg);        // per-system average timing
console.log(stats.budgetUsed);       // % of 16.67ms budget used
```

All timing data integrates with Chrome DevTools Performance tab via the User Timing API (`performance.mark`/`performance.measure`).

## Development

```bash
# Clone and install
git clone https://github.com/jamesyong-42/infinite-canvas.git
cd infinite-canvas
pnpm install

# Build the library
pnpm build

# Run the playground demo
pnpm dev

# Run tests
pnpm test

# Typecheck
pnpm exec tsc --noEmit -p packages/infinite-canvas/tsconfig.json
```

## Tech Stack

- **TypeScript** — Strict mode, fully typed public API
- **React 18 / 19** — Compatible with both versions
- **Three.js** — WebGL rendering (grid, selection chrome)
- **React Three Fiber** — WebGL widget rendering (optional peer dependency)
- **RBush** — Spatial indexing for hit testing and viewport culling
- **tsup** — Library bundling (ESM + CJS + DTS)
- **Vite** — Playground bundling
- **Tailwind CSS v4** — Playground styling
- **Biome** — Linting and formatting
- **Vitest** — Testing
- **pnpm** — Workspace management

## Contributing

Contributions are welcome! See the [live demo](https://jamesyong-42.github.io/infinite-canvas/) for an overview of the features, then check out the playground at `apps/playground/` to experiment with changes locally.

## License

[MIT](./LICENSE)
