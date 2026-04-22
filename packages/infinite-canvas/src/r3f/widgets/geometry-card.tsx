import type { EntityId } from '@jamesyong42/reactive-ecs';
import type * as React from 'react';
import { ExtrudeGeometry, Shape } from 'three';
import type { Archetype } from '../../ecs/archetype.js';
import type { CardPreset } from '../../ecs/components.js';
import { Card } from '../../ecs/components.js';
import { DEFAULT_CARD_PRESET_SIZES } from '../../ecs/resources.js';
import type { StandardSchemaV1 } from '../../ecs/schema.js';
import { useWidgetData } from '../../react/hooks/widget.js';
import type { R3FWidget, R3FWidgetProps } from '../../react/widgets/registry.js';
import { useSharedGeometry } from '../compositor/hooks.js';

/**
 * Pure-three rounded-rect extrude geometry — avoids a drei dependency.
 * Rounded corners match the DOM CardFrame radius (21.67 px).
 */
function makeRoundedCardGeometry(
	width: number,
	height: number,
	radius: number,
	depth: number,
): ExtrudeGeometry {
	const shape = new Shape();
	const r = Math.min(radius, Math.min(width, height) / 2);
	const x = -width / 2;
	const y = -height / 2;
	shape.moveTo(x, y + r);
	shape.lineTo(x, y + height - r);
	shape.quadraticCurveTo(x, y + height, x + r, y + height);
	shape.lineTo(x + width - r, y + height);
	shape.quadraticCurveTo(x + width, y + height, x + width, y + height - r);
	shape.lineTo(x + width, y + r);
	shape.quadraticCurveTo(x + width, y, x + width - r, y);
	shape.lineTo(x + r, y);
	shape.quadraticCurveTo(x, y, x, y + r);

	return new ExtrudeGeometry(shape, {
		depth,
		bevelEnabled: true,
		bevelSegments: 3,
		bevelSize: 0.6,
		bevelThickness: 0.6,
	});
}

interface CardBackProps {
	width: number;
	height: number;
	color: string;
	roughness: number;
	metalness: number;
}

function CardBack({ width, height, color, roughness, metalness }: CardBackProps) {
	// Cards of the same preset size share one geometry instance via the
	// compositor's ResourceRegistry. With many widgets of one archetype, GPU
	// geometry memory stays O(1) instead of O(N).
	const geometry = useSharedGeometry(`card-back:${width}x${height}:r21.67:d3`, () =>
		makeRoundedCardGeometry(width, height, 21.67, 3),
	);
	return (
		<mesh geometry={geometry} position={[0, 0, -6]} receiveShadow>
			<meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
		</mesh>
	);
}

/** Background options for a geometry card widget. */
export type GeometryCardBackground =
	| 'card'
	| 'transparent'
	| {
			/** Hex color for the card back (e.g. '#1C1C1E' dark, '#F2F2F7' light). */
			color: string;
			/** PBR roughness. Default 0.55. */
			roughness?: number;
			/** PBR metalness. Default 0. */
			metalness?: number;
	  };

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
	 * `'card'` (default) renders a dark iOS-style card back behind the geometry.
	 * `'transparent'` skips the card so the geometry floats over the canvas.
	 * Object form customises the back's color and PBR parameters.
	 */
	background?: GeometryCardBackground;
	/** The 3D content rendered in local space (origin at centre). */
	geometry: React.ComponentType<GeometryCardRenderProps<T>>;
}

/**
 * Returns a paired R3F widget + archetype for a card-shaped 3D widget.
 * Behaves like {@link createCardWidget} — fixed preset size, non-resizable,
 * no engine-drawn selection frame, and lifts on drag (scale + z) — but
 * renders a three.js scene instead of DOM content.
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
	const backgroundConfig = opts.background ?? 'card';

	const resolvedBack =
		backgroundConfig === 'transparent'
			? null
			: backgroundConfig === 'card'
				? { color: '#1C1C1E', roughness: 0.55, metalness: 0 }
				: {
						color: backgroundConfig.color,
						roughness: backgroundConfig.roughness ?? 0.55,
						metalness: backgroundConfig.metalness ?? 0,
					};

	const Component: React.ComponentType<R3FWidgetProps> = ({ entityId, width, height }) => {
		const data = useWidgetData<T>(entityId);
		// Drag-lift (scale + z) is applied at the composition layer, not
		// inside this widget's FBO — keeps rounded corners from clipping
		// against the FBO rectangle when the lift expands the content.

		return (
			<group>
				{resolvedBack && (
					<CardBack
						width={width}
						height={height}
						color={resolvedBack.color}
						roughness={resolvedBack.roughness}
						metalness={resolvedBack.metalness}
					/>
				)}
				<Render entityId={entityId} data={data} width={width} height={height} />
			</group>
		);
	};

	const widget: R3FWidget<T> = {
		type: opts.type,
		surface: 'webgl',
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
			selectionFrame: false,
		},
		defaultSize,
	};

	return { widget, archetype };
}
