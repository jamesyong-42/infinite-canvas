# Infinite Canvas

[![CI](https://github.com/jamesyong-42/infinite-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/jamesyong-42/infinite-canvas/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jamesyong42/infinite-canvas)](https://www.npmjs.com/package/@jamesyong42/infinite-canvas)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Build Figma-style infinite canvases in React -- drag, resize, snap, zoom, nested containers, and WebGL widgets from a single composable component.

**[Live Demo](https://jamesyong-42.github.io/infinite-canvas/)** | **[npm](https://www.npmjs.com/package/@jamesyong42/infinite-canvas)**

## Features

- **Figma-style interactions** -- Snap alignment (edge + center), equal spacing detection, multi-select with group bounding box
- **Mobile-first gestures** -- Pinch-to-zoom, single-finger pan, tap-to-select, double-tap to enter containers
- **Responsive widgets** -- Breakpoint system adapts widget rendering based on screen-space size (micro / compact / normal / expanded / detailed)
- **Dual rendering** -- DOM and WebGL (React Three Fiber) widgets on the same canvas
- **Undo / redo** -- Command buffer with grouped operations (an entire drag is one undo step)
- **Hierarchical navigation** -- Enter and exit nested containers with camera state preservation
- **ECS architecture** -- Extensible via custom components, tags, and systems with topologically-sorted scheduling
- **Performance** -- SDF shaders for grid and selection chrome, RBush spatial indexing, viewport culling, per-system profiling
- **Dark mode** -- Full dark mode support across canvas, widgets, and UI chrome

## Quick Start

```bash
npm install @jamesyong42/infinite-canvas react react-dom
# For WebGL widgets (optional):
npm install three @react-three/fiber
```

```tsx
import { useMemo } from 'react';
import { createLayoutEngine, InfiniteCanvas, useWidgetData } from '@jamesyong42/infinite-canvas';

function MyCard({ entityId }) {
  const data = useWidgetData(entityId);
  return <div style={{ padding: 16, background: 'white', borderRadius: 8 }}>{data.title}</div>;
}

const widgets = [
  { type: 'card', component: MyCard, defaultSize: { width: 250, height: 180 } },
];

export default function App() {
  const engine = useMemo(() => {
    const e = createLayoutEngine({ zoom: { min: 0.05, max: 8 } });
    e.addWidget({
      type: 'card',
      position: { x: 100, y: 100 },
      size: { width: 250, height: 180 },
      data: { title: 'Hello World' },
    });
    return e;
  }, []);

  return (
    <InfiniteCanvas
      engine={engine}
      widgets={widgets}
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
```

## Package

Everything ships in a single package: **`@jamesyong42/infinite-canvas`**. It exposes three entry points:

| Import | Purpose |
|--------|---------|
| `@jamesyong42/infinite-canvas` | Main API -- `<InfiniteCanvas>`, `createLayoutEngine`, hooks, built-in components |
| `@jamesyong42/infinite-canvas/ecs` | ECS primitives for advanced users (`defineComponent`, `defineSystem`, `World`) |
| `@jamesyong42/infinite-canvas/advanced` | WebGL renderers, serialization, profiler, spatial index |

## Why This Library?

| | Infinite Canvas | React Flow | Konva | Excalidraw |
|---|---|---|---|---|
| **Use case** | Freeform spatial positioning of arbitrary React components | Node-edge graphs and flowcharts | Imperative canvas-mode rendering | Whiteboard application |
| **Rendering** | React DOM + WebGL widgets | React DOM | HTML5 Canvas | HTML5 Canvas |
| **Extension model** | ECS components, tags, and systems | Plugins and custom nodes | Shapes and layers | Not designed as a library |

**What makes this library unique:** ECS extension system, mixed DOM + WebGL widgets on the same canvas, responsive breakpoint system that adapts widgets to their screen-space size, and SDF-rendered chrome (grid, selection, snap guides) in a single draw call.

## API Reference

### Hooks

| Hook | Description |
|------|-------------|
| `useWidgetData<T>(entityId)` | Custom data attached to a widget |
| `useBreakpoint(entityId)` | Responsive breakpoint (`'micro'` / `'compact'` / `'normal'` / `'expanded'` / `'detailed'`) |
| `useIsSelected(entityId)` | Whether the entity is currently selected |
| `useUpdateWidget(entityId)` | Returns a function to patch widget data |
| `useChildren(entityId)` | Child entity IDs of a container |
| `useComponent<T>(entityId, type)` | Read any ECS component reactively |
| `useTag(entityId, type)` | Check if an entity has a tag |
| `useQuery(...types)` | Entity IDs matching component/tag types |
| `useTaggedEntities(type)` | All entity IDs with a specific tag |
| `useResource<T>(type)` | Read an ECS resource reactively |
| `useLayoutEngine()` | Access the `LayoutEngine` instance from context |

### InfiniteCanvas Props

| Prop | Type | Description |
|------|------|-------------|
| `engine` | `LayoutEngine` | Engine instance (required) |
| `widgets` | `WidgetDef[]` | Widget type definitions |
| `grid` | `Partial<GridConfig> \| false` | Grid configuration, or `false` to disable |
| `selection` | `Partial<SelectionConfig>` | Selection style overrides |
| `onSelectionChange` | `(ids: EntityId[]) => void` | Called when selected entities change |
| `onCameraChange` | `(camera) => void` | Called on pan/zoom |
| `onNavigationChange` | `(depth, containerId) => void` | Called when entering/exiting containers |
| `style` | `CSSProperties` | Inline styles for the root element |
| `className` | `string` | CSS class for the root element |
| `ref` | `Ref<InfiniteCanvasHandle>` | Imperative handle for `panTo`, `zoomToFit`, `undo`, `redo` |

## Widget Development

Widgets are React components that receive an `entityId` prop and use hooks to read/write ECS data:

```tsx
import type { WidgetProps } from '@jamesyong42/infinite-canvas';
import {
  Transform2D,
  useBreakpoint,
  useComponent,
  useIsSelected,
  useUpdateWidget,
  useWidgetData,
} from '@jamesyong42/infinite-canvas';

function MyWidget({ entityId }: WidgetProps) {
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

The `WidgetProps` interface provides `entityId`, `width`, `height`, and `zoom`.

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
  snap: { enabled: true, threshold: 5 },
});
```

## Serialization

Save and restore canvas state with the serialization API:

```tsx
import { serializeWorld, deserializeWorld } from '@jamesyong42/infinite-canvas/advanced';
import {
  Transform2D, Widget, WidgetData, WidgetBreakpoint, ZIndex,
  Parent, Children, Container, Hitbox, InteractionRole, HandleSet, CursorHint,
  Selectable, Draggable, Resizable, Locked, Selected, Active, Visible,
} from '@jamesyong42/infinite-canvas';

const componentTypes = [
  Transform2D, Widget, WidgetData, WidgetBreakpoint, ZIndex,
  Parent, Children, Container, Hitbox, InteractionRole, HandleSet, CursorHint,
];
const tagTypes = [Selectable, Draggable, Resizable, Locked, Selected, Active, Visible];

// Save
const camera = engine.getCamera();
const doc = serializeWorld(engine.world, componentTypes, tagTypes, camera, []);
localStorage.setItem('canvas', JSON.stringify(doc));

// Load
const saved = JSON.parse(localStorage.getItem('canvas'));
deserializeWorld(engine.world, saved, componentTypes, tagTypes);
engine.markDirty();
```

## Programmatic Control

### Camera

```tsx
engine.panTo(500, 300);          // pan to world coordinates
engine.zoomTo(1.5);             // set zoom level
engine.zoomToFit();             // fit all entities in viewport
engine.zoomToFit([id1, id2]);   // fit specific entities
engine.markDirty();             // schedule a re-render
```

### Undo / Redo

```tsx
engine.undo();
engine.redo();
engine.markDirty();
```

### Imperative Handle

Use a ref on `<InfiniteCanvas>` for imperative control from outside:

```tsx
const canvasRef = useRef<InfiniteCanvasHandle>(null);

<InfiniteCanvas ref={canvasRef} engine={engine} widgets={widgets} />

// Later:
canvasRef.current?.zoomToFit();
canvasRef.current?.undo();
```

### Keyboard Shortcuts

Wire up shortcuts in your app (this pattern is from the playground):

```tsx
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); engine.undo(); engine.markDirty(); }
    if (mod && e.shiftKey && e.key === 'z')  { e.preventDefault(); engine.redo(); engine.markDirty(); }
    if (e.key === 'Escape' && engine.getNavigationDepth() > 0) {
      engine.exitContainer(); engine.markDirty();
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const selected = engine.getSelectedEntities();
      for (const id of selected) engine.destroyEntity(id);
      if (selected.length > 0) engine.markDirty();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [engine]);
```

## Custom ECS Extensions

Define custom components and systems to extend the canvas:

```tsx
import { defineComponent, defineSystem } from '@jamesyong42/infinite-canvas/ecs';
import { Visible } from '@jamesyong42/infinite-canvas';

const Health = defineComponent('Health', { hp: 100, maxHp: 100 });

const healthSystem = defineSystem({
  name: 'health',
  after: 'breakpoint',
  execute: (world) => {
    for (const id of world.queryChanged(Health)) {
      const h = world.getComponent(id, Health);
      if (h && h.hp <= 0) world.removeTag(id, Visible);
    }
  },
});

// Register with the engine
engine.registerSystem(healthSystem);
```

Systems are topologically sorted based on `after` and `before` constraints, so you can insert custom logic at any point in the pipeline.

## Architecture

```
@jamesyong42/infinite-canvas
+-- Main API        (InfiniteCanvas, createLayoutEngine, hooks, components)
+-- /ecs            (ECS primitives: defineComponent, defineSystem, World)
+-- /advanced       (WebGL renderers, serialization, profiler, spatial index)
```

### Rendering Stack

```
z:0  WebGL canvas (Three.js)
     +-- GridRenderer        -- multi-level dot grid (SDF shader)
     +-- SelectionRenderer   -- outlines, handles, hover, snap guides (SDF shader)

z:1  R3F canvas (React Three Fiber, lazy)
     +-- WebGL widgets       -- 3D content with synced orthographic camera

z:2  DOM layer
     +-- WidgetSlots         -- DOM widget content + pointer events
     +-- SelectionOverlays   -- invisible pointer event layer for WebGL widgets

z:3  UI chrome
     +-- Panels, buttons, toggles
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
| `Hitbox` | Hit-test geometry |
| `InteractionRole` | Interaction behavior (drag, select, resize, etc.) |
| `HandleSet` | Child handle entity references |
| `CursorHint` | Cursor style on hover/active |

### ECS Tags

`Selectable` `Draggable` `Resizable` `Locked` `Selected` `Active` `Visible`

### Systems (execution order)

1. `transformPropagate` -- Propagate transforms down hierarchy, compute WorldBounds
2. `handleSync` -- Synchronize resize handle entities with parent widgets
3. `hitboxWorldBounds` -- Compute world-space hitbox bounds
4. `navigationFilter` -- Filter entities to active navigation layer
5. `cull` -- Mark viewport-visible entities
6. `breakpoint` -- Compute responsive breakpoints
7. `sort` -- Z-index ordering

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

## SSR / Next.js

This library requires browser APIs (WebGL, ResizeObserver, requestAnimationFrame). For Next.js, use dynamic import with SSR disabled or ensure the component only mounts client-side:

```tsx
import dynamic from 'next/dynamic';

const Canvas = dynamic(() => import('./MyCanvas'), { ssr: false });
```

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+. Requires WebGL 2.

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

- **React 18 / 19** -- Compatible with both versions
- **Three.js** -- WebGL rendering (grid, selection chrome, WebGL widgets via R3F)
- **RBush** -- Spatial indexing for hit testing and viewport culling

## Contributing

Contributions are welcome! See the [live demo](https://jamesyong-42.github.io/infinite-canvas/) for an overview of the features, then check out the playground at `apps/playground/` to experiment with changes locally.

## License

[MIT](./LICENSE)
