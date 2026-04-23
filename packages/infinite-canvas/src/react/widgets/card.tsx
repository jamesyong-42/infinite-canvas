import type { EntityId } from '@jamesyong42/reactive-ecs';
import type * as React from 'react';
import type { Archetype } from '../../ecs/archetype.js';
import type { CardPreset } from '../../ecs/components.js';
import { Card, Dragging } from '../../ecs/components.js';
import { DEFAULT_CARD_PRESET_SIZES } from '../../ecs/resources.js';
import type { StandardSchemaV1 } from '../../ecs/schema.js';
import { useTag } from '../hooks/ecs.js';
import { useWidgetData } from '../hooks/widget.js';
import { CardChrome } from './CardChrome.js';
import type { DomWidget, DomWidgetProps } from './registry.js';

/** Props accepted by `<CardFrame>`. */
export interface CardFrameProps {
	entityId: EntityId;
	children?: React.ReactNode;
	className?: string;
	/** Merged into the frame div's style (wins over defaults). */
	style?: React.CSSProperties;
}

/**
 * Visual chrome for an iOS-style card. Reads the entity's `Dragging` tag
 * and forwards `lifted` to {@link CardChrome}, which owns the actual
 * appearance (rounded corners, hairline ring, soft drop shadow, lift
 * transition). Same chrome is used by R3F geometry cards via a DOM slot
 * beneath the WebGL canvas, so DOM and 3D cards stay visually identical.
 */
export function CardFrame({ entityId, children, className, style }: CardFrameProps) {
	const dragging = useTag(entityId, Dragging);
	return (
		<CardChrome lifted={dragging} className={className} style={style}>
			{children}
		</CardChrome>
	);
}

/** Options passed to `createCardWidget`. */
export interface CreateCardWidgetOptions<T> {
	/** Unique widget type id. Doubles as the archetype id. */
	type: string;
	/** Which iOS preset the card sits at. Fixed for the widget's lifetime (change via `engine.set(id, Card, { preset })`). */
	size: CardPreset;
	/** Standard Schema v1-compatible validator for the widget's data. */
	// biome-ignore lint/suspicious/noExplicitAny: schema Input is intentionally permissive
	schema: StandardSchemaV1<any, T>;
	/** Default data for new instances; merged with user-supplied data at spawn. */
	defaultData: T;
	/** The card's rendered content. Receives entityId + typed data. */
	render: React.ComponentType<{ entityId: EntityId; data: T }>;
}

/**
 * Returns a paired widget + archetype for an iOS-style card. Register both
 * with `createLayoutEngine({ widgets: [card.widget], archetypes: [card.archetype] })`
 * (or via `engine.registerWidget` / `engine.registerArchetype`) and spawn with
 * `engine.spawn('your-card-type', { at, data })`.
 *
 * The produced widget is non-resizable (Selectable + Draggable only), wrapped
 * in `<CardFrame>`, and spawns with a `Card` component so `cardSystem` enforces
 * the preset size each tick.
 */
export function createCardWidget<T>(opts: CreateCardWidgetOptions<T>): {
	widget: DomWidget<T>;
	archetype: Archetype;
} {
	const defaultSize = DEFAULT_CARD_PRESET_SIZES[opts.size];
	const Render = opts.render;

	const Component: React.ComponentType<DomWidgetProps> = ({ entityId }) => {
		const data = useWidgetData<T>(entityId);
		return (
			<CardFrame entityId={entityId}>
				<Render entityId={entityId} data={data} />
			</CardFrame>
		);
	};

	const widget: DomWidget<T> = {
		type: opts.type,
		schema: opts.schema,
		defaultData: opts.defaultData,
		defaultSize,
		component: Component,
	};

	const archetype: Archetype = {
		id: opts.type,
		widget: opts.type,
		components: [[Card, { preset: opts.size }]],
		interactive: {
			selectable: true,
			draggable: true,
			resizable: false,
			// Cards render their own chrome via CardFrame — opt out of the
			// engine-drawn selection/hover outline.
			selectionFrame: false,
		},
		defaultSize,
	};

	return { widget, archetype };
}
