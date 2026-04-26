import type { EntityId } from '@jamesyong42/reactive-ecs';
import type * as React from 'react';
import type { Archetype } from '../../ecs/archetype.js';
import type { CardPreset } from '../../ecs/components.js';
import { Card } from '../../ecs/components.js';
import type { WidgetInteractionHandlers } from '../../ecs/engine/widget-binding.js';
import { DEFAULT_CARD_PRESET_SIZES } from '../../ecs/resources.js';
import type { StandardSchemaV1 } from '../../ecs/schema.js';
import { useWidgetData } from '../../react/hooks/widget.js';
import type { R3FWidget, R3FWidgetProps } from '../../react/widgets/registry.js';

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
	 * If false, the widget skips the `Card` component entirely — no DOM
	 * `<CardChrome>` (no rounded background, no drop shadow), no
	 * lift-on-drag CSS transition, no compositor discard rect for
	 * neighbours. The widget's 3D content floats over the canvas
	 * background and just stacks on top of overlapping R3F content
	 * during drag (via the compositor's renderOrder bump).
	 *
	 * Default true.
	 */
	withCard?: boolean;
	/**
	 * CSS background for the chrome's surface — only meaningful when
	 * `withCard` is true. Stored on the `Card` component so the chrome
	 * + any future tooling can read it. Defaults to the dark iOS card.
	 */
	background?: string;
	/** The 3D content rendered in local space (origin at centre). */
	geometry: React.ComponentType<GeometryCardRenderProps<T>>;
	/**
	 * Drop-to-consume contract — what this card accepts as a parent
	 * (RFC-004 § Phase 1). Only meaningful when `withCard` is true,
	 * since non-card widgets don't participate in the consume mechanic.
	 */
	accepts?: readonly string[];
	/**
	 * Drop-to-consume contract — what this card provides as a child.
	 * Only meaningful when `withCard` is true.
	 */
	provides?: readonly string[];
	/**
	 * Optional widget-type interaction handlers. Only meaningful when
	 * `withCard` is true; dispatch logic skips non-card widgets.
	 */
	interaction?: WidgetInteractionHandlers;
}

/**
 * Returns a paired R3F widget + archetype for a card-shaped 3D widget.
 * Behaves like {@link createCardWidget} — fixed preset size, non-resizable,
 * no engine-drawn selection frame, and lifts on drag (scale + z) — but
 * renders a three.js scene instead of DOM content.
 *
 * The card body and drop shadow are rendered as DOM `<CardChrome>`
 * beneath the WebGL canvas, not inside the FBO. The user's `geometry`
 * component renders ONLY the 3D content; chrome is provided by the
 * `Card` ECS component (the source of truth for all card-shaped
 * behavior — chrome, lift, drag-promote, compositor discard).
 *
 * Pass `withCard: false` to skip card behavior entirely (bare 3D
 * widget — no chrome, no lift, no discard).
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
	const withCard = opts.withCard ?? true;

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
		interaction: opts.interaction,
	};

	const archetype: Archetype = {
		id: opts.type,
		widget: opts.type,
		components: withCard
			? [
					[
						Card,
						{
							preset: opts.size,
							background: opts.background ?? '#1C1C1E',
							accepts: opts.accepts ?? [],
							provides: opts.provides ?? [],
						},
					],
				]
			: [],
		interactive: {
			selectable: true,
			draggable: true,
			resizable: false,
			selectionFrame: false,
			// Cards never snap themselves when dragged, but they ARE references
			// other widgets snap to. Asymmetric on purpose.
			snapSource: false,
			snapTarget: true,
		},
		defaultSize,
	};

	return { widget, archetype };
}
