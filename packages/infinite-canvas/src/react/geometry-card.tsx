import type { EntityId } from '@jamesyong42/reactive-ecs';
import { useFrame } from '@react-three/fiber';
import type * as React from 'react';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { ExtrudeGeometry, Shape } from 'three';
import type { Archetype } from '../archetype.js';
import type { CardPreset } from '../components.js';
import { Card, Dragging } from '../components.js';
import type { StandardSchemaV1 } from '../schema.js';
import { useTag } from './hooks.js';
import type { R3FWidget, R3FWidgetProps } from './registry.js';
import { useWidgetData } from './widget-hooks.js';

/** Must match {@link CardPresetsResource} defaults. */
const DEFAULT_CARD_PRESET_SIZES: Record<CardPreset, { width: number; height: number }> = {
	small: { width: 155, height: 155 },
	medium: { width: 329, height: 155 },
	large: { width: 329, height: 345 },
	xl: { width: 329, height: 535 },
};

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
	const geometry = useMemo(() => makeRoundedCardGeometry(width, height, 21.67, 3), [width, height]);
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
		const dragging = useTag(entityId, Dragging);
		const groupRef = useRef<Group>(null);

		// Spring-lerp the group scale + z on drag for the iOS lift feel.
		useFrame(() => {
			const g = groupRef.current;
			if (!g) return;
			const targetScale = dragging ? 1.05 : 1;
			const targetZ = dragging ? 8 : 0;
			const s = g.scale.x;
			g.scale.setScalar(s + (targetScale - s) * 0.2);
			g.position.z += (targetZ - g.position.z) * 0.2;
		});

		return (
			<group ref={groupRef}>
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
