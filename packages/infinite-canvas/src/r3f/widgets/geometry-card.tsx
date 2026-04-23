import type { EntityId } from '@jamesyong42/reactive-ecs';
import type * as React from 'react';
import type { Archetype } from '../../ecs/archetype.js';
import type { CardPreset } from '../../ecs/components.js';
import { Card } from '../../ecs/components.js';
import { DEFAULT_CARD_PRESET_SIZES } from '../../ecs/resources.js';
import type { StandardSchemaV1 } from '../../ecs/schema.js';
import { useWidgetData } from '../../react/hooks/widget.js';
import type { R3FChromeConfig, R3FWidget, R3FWidgetProps } from '../../react/widgets/registry.js';

/** Props passed to the user's geometry component. */
export interface GeometryCardRenderProps<T> {
	entityId: EntityId;
	data: T;
	/** Widget width in world units. */
	width: number;
	/** Widget height in world units. */
	height: number;
}

/** Options for `createGeometryCardWidget`. */
export interface CreateGeometryCardWidgetOptions<T> {
	/** Unique widget type id. Doubles as the archetype id. */
	type: string;
	/** iOS card preset size. */
	size: CardPreset;
	/** Standard Schema v1-compatible validator for the widget's data. */
	// biome-ignore lint/suspicious/noExplicitAny: schema Input is intentionally permissive
	schema: StandardSchemaV1<any, T>;
	/** Default data for new instances. */
	defaultData: T;
	/**
	 * DOM chrome rendered beneath the WebGL canvas (rounded background +
	 * box-shadow). Browser-native CSS produces a far better-looking shadow
	 * than any shader approximation we can write in WebGL.
	 *
	 *   `'card'` (default) — dark iOS-style card back with soft shadow.
	 *   `'none'`           — no chrome; geometry floats over canvas bg.
	 *   object             — custom background color and / or radius.
	 */
	chrome?: R3FChromeConfig;
	/** The 3D content rendered in local space (origin at centre). */
	geometry: React.ComponentType<GeometryCardRenderProps<T>>;
}

/**
 * Returns a paired R3F widget + archetype for a card-shaped 3D widget.
 * Behaves like {@link createCardWidget} — fixed preset size, non-resizable,
 * no engine-drawn selection frame, and lifts on drag (scale + z) — but
 * renders a three.js scene instead of DOM content.
 *
 * The card background and drop shadow are rendered as DOM `<CardChrome>`
 * beneath the WebGL canvas, not inside the FBO. The user's `geometry`
 * component renders ONLY the 3D content; the chrome layer handles the
 * iOS-style rounded body and lift-on-drag shadow.
 *
 * Lighting: this helper adds no lights. Declare your own in the `geometry`
 * component (typically a local `pointLight` scoped with `distance`).
 */
export function createGeometryCardWidget<T>(opts: CreateGeometryCardWidgetOptions<T>): {
	widget: R3FWidget<T>;
	archetype: Archetype;
} {
	const defaultSize = DEFAULT_CARD_PRESET_SIZES[opts.size];
	const Render = opts.geometry;
	const chrome = opts.chrome ?? 'card';

	const Component: React.ComponentType<R3FWidgetProps> = ({ entityId, width, height }) => {
		const data = useWidgetData<T>(entityId);
		// Drag-lift (scale + z) is applied at the composition layer, not
		// inside this widget's FBO — keeps rounded corners from clipping
		// against the FBO rectangle when the lift expands the content.
		return <Render entityId={entityId} data={data} width={width} height={height} />;
	};

	const widget: R3FWidget<T> = {
		type: opts.type,
		surface: 'webgl',
		schema: opts.schema,
		defaultData: opts.defaultData,
		defaultSize,
		component: Component,
		chrome,
	};

	const archetype: Archetype = {
		id: opts.type,
		widget: opts.type,
		components: [[Card, { preset: opts.size }]],
		interactive: {
			selectable: true,
			draggable: true,
			resizable: false,
			selectionFrame: false,
		},
		defaultSize,
	};

	return { widget, archetype };
}
