import type { EntityId } from '@jamesyong42/reactive-ecs';
import type * as React from 'react';
import type { Archetype } from '../archetype.js';
import type { CardPreset } from '../components.js';
import { Card, Dragging } from '../components.js';
import type { StandardSchemaV1 } from '../schema.js';
import { useTag } from './hooks.js';
import type { DomWidget, DomWidgetProps } from './registry.js';
import { useWidgetData } from './widget-hooks.js';

/**
 * Built-in preset sizes, matching `CardPresetsResource` defaults.
 * Used by `createCardWidget` to set `defaultSize` at widget-registration
 * time (before the engine is constructed).
 */
const DEFAULT_CARD_PRESET_SIZES: Record<CardPreset, { width: number; height: number }> = {
	small: { width: 155, height: 155 },
	medium: { width: 329, height: 155 },
	large: { width: 329, height: 345 },
	xl: { width: 329, height: 535 },
};

/** Props accepted by `<CardFrame>`. */
export interface CardFrameProps {
	entityId: EntityId;
	children?: React.ReactNode;
	className?: string;
	/** Merged into the frame div's style (wins over defaults). */
	style?: React.CSSProperties;
}

/**
 * Visual chrome for an iOS-style card: rounded corners, hairline ring,
 * soft drop shadow, and a subtle lift (scale + stronger shadow) while
 * the entity carries the `Dragging` tag.
 *
 * Uses CSS transitions — no animation library dependency.
 */
export function CardFrame({ entityId, children, className, style }: CardFrameProps) {
	const dragging = useTag(entityId, Dragging);

	const baseStyle: React.CSSProperties = {
		width: '100%',
		height: '100%',
		borderRadius: '21.67px',
		overflow: 'hidden',
		boxShadow: dragging
			? '0 30px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)'
			: '0 20px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
		transform: dragging ? 'scale(1.05)' : 'scale(1)',
		transformOrigin: 'center center',
		transition:
			'transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
		willChange: dragging ? 'transform, box-shadow' : undefined,
		...style,
	};

	return (
		<div className={className} style={baseStyle}>
			{children}
		</div>
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
