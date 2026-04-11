import { defineComponent, defineTag } from './ecs/index.js';
import type { EntityId } from './ecs/index.js';

// === Spatial ===
export const Transform2D = defineComponent('Transform2D', {
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	rotation: 0,
});

export const WorldBounds = defineComponent('WorldBounds', {
	worldX: 0,
	worldY: 0,
	worldWidth: 0,
	worldHeight: 0,
});

export const ZIndex = defineComponent('ZIndex', { value: 0 });

// === Hierarchy ===
export const Parent = defineComponent('Parent', { id: 0 as EntityId });
export const Children = defineComponent('Children', { ids: [] as EntityId[] });

// === Widget ===
export const Widget = defineComponent('Widget', {
	surface: 'dom' as 'dom' | 'webgl' | 'webview',
	type: '' as string,
});

export const WidgetData = defineComponent('WidgetData', {
	data: {} as Record<string, unknown>,
});

export const WidgetBreakpoint = defineComponent('WidgetBreakpoint', {
	current: 'normal' as 'micro' | 'compact' | 'normal' | 'expanded' | 'detailed',
	screenWidth: 0,
	screenHeight: 0,
});

// === Container ===
export const Container = defineComponent('Container', { enterable: true });

// === Tags ===
export const Selectable = defineTag('Selectable');
export const Draggable = defineTag('Draggable');
export const Resizable = defineTag('Resizable');
export const Locked = defineTag('Locked');
export const Selected = defineTag('Selected');
export const Active = defineTag('Active');
export const Visible = defineTag('Visible');
