import type { GeometryCardRenderProps } from '@jamesyong42/infinite-canvas';
import {
	createGeometryCardWidget,
	useUpdateWidget,
	useWidgetAnimation,
} from '@jamesyong42/infinite-canvas';
import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { type Mesh, Vector3 } from 'three';
import { z } from 'zod';

// Demonstrates RFC-006 in-widget pointer interactions for R3F widgets.
//
// - `onPointerMove` on a backplate plane reads `event.point` (widget-local
//   coords) and feeds it into a tiny verlet-style physics loop that
//   repels the shapes from the cursor.
// - `onClick` on the backplate cycles the accent colour. No
//   `nativeEvent.stopPropagation()` is needed: R3F's click is synthesised
//   from a down/up pair without significant move, so a press-and-drag is
//   handled by the engine and never resolves to a click.
// - All shapes float in 3D inside the widget's own scene; raycast and
//   intersection coords come from the EventRouter's widget-local
//   raycaster (RFC-006 § 4c).
//
// Concept inspired by Lusion's "Shapes" demo (mixed primitives drifting
// toward centre, repelled by a pointer ball, click cycles accent). The
// physics, palette, layout, and rendering here are all original — no
// Rapier dependency, no GLB models, no transmission material.

const ACCENTS = ['#4060ff', '#20ffa0', '#ff4060', '#ffcc00'] as const;

type ShapeKind = 'sphere' | 'cube' | 'tet' | 'torus';
type BodyTone = 'graphite' | 'white' | 'accent';

interface ShapeSpec {
	kind: ShapeKind;
	tone: BodyTone;
	radius: number; // collision radius in widget-local world units
	roughness: number;
}

const PALETTE: readonly ShapeSpec[] = [
	{ kind: 'sphere', tone: 'graphite', radius: 36, roughness: 0.1 },
	{ kind: 'cube', tone: 'graphite', radius: 36, roughness: 0.65 },
	{ kind: 'tet', tone: 'graphite', radius: 36, roughness: 0.5 },
	{ kind: 'torus', tone: 'white', radius: 36, roughness: 0.1 },
	{ kind: 'tet', tone: 'white', radius: 36, roughness: 0.6 },
	{ kind: 'torus', tone: 'white', radius: 36, roughness: 0.1 },
	{ kind: 'tet', tone: 'accent', radius: 33, roughness: 0.1 },
	{ kind: 'torus', tone: 'accent', radius: 36, roughness: 0.5 },
	{ kind: 'sphere', tone: 'accent', radius: 36, roughness: 0.1 },
];

// Tunables. Units are widget-local world units (≈ pixels at 1× zoom).
const SPRING = 0.65;
const DAMPING = 3.6;
// Reach across most of the card so any cursor position pushes nearby
// bodies; bodies start ~72 units from centre and the card is 329×345.
const POINTER_REPEL_RADIUS = 130;
// Strong enough that a slow hover noticeably parts the swarm. Falls off
// quadratically with distance so the effect is concentrated near cursor.
const POINTER_REPEL_STRENGTH = 28000;
const COLLISION_STIFFNESS = 260;
const Z_RANGE = 30;

interface BodyState {
	pos: Vector3;
	vel: Vector3;
	spin: Vector3;
}

const schema = z.object({
	accentIdx: z.number().int().min(0).max(3).default(0),
});
type ShapesData = z.infer<typeof schema>;

function ShapesScene({ entityId, data, width, height }: GeometryCardRenderProps<ShapesData>) {
	useWidgetAnimation(entityId, true);
	const updateData = useUpdateWidget(entityId);

	// Physics state — one body per palette entry. Stored in a ref so the
	// useFrame loop mutates without re-rendering React.
	const bodies = useMemo<BodyState[]>(() => {
		const N = PALETTE.length;
		return PALETTE.map((_, i) => {
			const angle = (i / N) * Math.PI * 2;
			// Spread proportionally to body size so they don't start fully
			// overlapping after the size bump.
			const r = Math.min(width, height) * 0.32;
			const z = ((i % 3) - 1) * (Z_RANGE * 0.6);
			return {
				pos: new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z),
				vel: new Vector3(),
				spin: new Vector3(
					0.4 + 0.6 * Math.sin(i * 1.7),
					0.5 + 0.6 * Math.cos(i * 2.1),
					0.3 + 0.4 * Math.sin(i * 3.3),
				),
			};
		});
		// Recompute initial layout if the card is resized.
	}, [width, height]);

	const meshRefs = useRef<(Mesh | null)[]>([]);
	const pointerRef = useRef<Vector3 | null>(null);

	const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
		// `event.point` is in widget-local coords (origin at centre, X right,
		// Y up) thanks to the EventRouter's per-widget raycaster. Flatten Z
		// to the swarm centre so a cursor anywhere in the plane pushes
		// nearby bodies regardless of their depth.
		if (!pointerRef.current) pointerRef.current = new Vector3();
		pointerRef.current.set(e.point.x, e.point.y, 0);
	};
	const onPointerOut = () => {
		pointerRef.current = null;
	};

	useFrame((_, dt) => {
		const step = Math.min(dt, 0.033);
		const pointer = pointerRef.current;

		// Forces.
		for (const b of bodies) {
			b.vel.x += -b.pos.x * SPRING * step;
			b.vel.y += -b.pos.y * SPRING * step;
			b.vel.z += -b.pos.z * SPRING * step;

			if (pointer) {
				const dx = b.pos.x - pointer.x;
				const dy = b.pos.y - pointer.y;
				const dz = b.pos.z - pointer.z;
				const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (d < POINTER_REPEL_RADIUS && d > 0.001) {
					const t = 1 - d / POINTER_REPEL_RADIUS;
					const f = (POINTER_REPEL_STRENGTH * t * t) / Math.max(d, 4);
					b.vel.x += (dx / d) * f * step;
					b.vel.y += (dy / d) * f * step;
					b.vel.z += (dz / d) * f * step * 0.4;
				}
			}
		}

		// Pairwise collisions (O(N²); N=9 so the cost is trivial).
		for (let i = 0; i < bodies.length; i++) {
			const ba = bodies[i];
			const ra = PALETTE[i].radius;
			for (let j = i + 1; j < bodies.length; j++) {
				const bb = bodies[j];
				const rb = PALETTE[j].radius;
				const dx = bb.pos.x - ba.pos.x;
				const dy = bb.pos.y - ba.pos.y;
				const dz = bb.pos.z - ba.pos.z;
				const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
				const minD = ra + rb;
				if (d < minD && d > 0.001) {
					const overlap = minD - d;
					const nx = dx / d;
					const ny = dy / d;
					const nz = dz / d;
					const f = COLLISION_STIFFNESS * overlap * step;
					ba.vel.x -= nx * f;
					ba.vel.y -= ny * f;
					ba.vel.z -= nz * f;
					bb.vel.x += nx * f;
					bb.vel.y += ny * f;
					bb.vel.z += nz * f;
				}
			}
		}

		// Damping + integrate.
		const damp = Math.exp(-DAMPING * step);
		for (let i = 0; i < bodies.length; i++) {
			const b = bodies[i];
			b.vel.multiplyScalar(damp);
			b.pos.x += b.vel.x * step;
			b.pos.y += b.vel.y * step;
			b.pos.z += b.vel.z * step;

			// Soft Z clamp so the swarm stays close to the camera plane.
			if (b.pos.z > Z_RANGE) b.vel.z -= (b.pos.z - Z_RANGE) * step * 8;
			if (b.pos.z < -Z_RANGE) b.vel.z += (-Z_RANGE - b.pos.z) * step * 8;

			const m = meshRefs.current[i];
			if (m) {
				m.position.copy(b.pos);
				m.rotation.x += step * b.spin.x;
				m.rotation.y += step * b.spin.y;
				m.rotation.z += step * b.spin.z;
			}
		}
	});

	const accent = ACCENTS[data.accentIdx % ACCENTS.length];
	const colorFor = (tone: BodyTone) =>
		tone === 'graphite' ? '#3a3a3a' : tone === 'white' ? '#ececec' : accent;

	const onClick = (e: ThreeEvent<MouseEvent>) => {
		// Click cycles accent. R3F synthesises this from a down/up pair on
		// the same target without significant move — so a press-and-drag
		// handled by the engine never reaches here. No
		// `nativeEvent.stopPropagation()` needed.
		e.stopPropagation();
		updateData({ accentIdx: (data.accentIdx + 1) % ACCENTS.length });
	};

	const lightDist = Math.max(width, height) * 2;

	return (
		<group>
			<ambientLight intensity={0.55} />
			<directionalLight position={[width, height, width]} intensity={1.1} />
			<pointLight
				position={[0, 0, Math.max(width, height) * 0.6]}
				intensity={140}
				distance={lightDist}
				decay={1.6}
				color={accent}
			/>

			{/* Backplate captures pointer + click anywhere over the card.
			    Slightly behind the swarm so it never z-fights with the
			    shapes. invisible:false would still raycast — using
			    `meshBasicMaterial visible={false}` keeps the raycast hit
			    while staying invisible to render. */}
			{/* Backplate: invisible plane at the swarm centre that catches
			    pointer events. We sit it at z=0 so cursor → ray hit lands in
			    the middle of the body cloud, not behind it. The bodies have
			    no pointer handlers so they're not raycast candidates and
			    don't occlude this plane. */}
			<mesh
				position={[0, 0, 0]}
				onPointerMove={onPointerMove}
				onPointerOut={onPointerOut}
				onClick={onClick}
			>
				<planeGeometry args={[width, height]} />
				<meshBasicMaterial visible={false} />
			</mesh>

			{PALETTE.map((spec, i) => (
				<mesh
					// biome-ignore lint/suspicious/noArrayIndexKey: PALETTE order is stable
					key={i}
					ref={(m) => {
						meshRefs.current[i] = m;
					}}
					castShadow
					receiveShadow
				>
					{spec.kind === 'sphere' && <sphereGeometry args={[spec.radius, 28, 18]} />}
					{spec.kind === 'cube' && (
						<boxGeometry args={[spec.radius * 1.4, spec.radius * 1.4, spec.radius * 1.4]} />
					)}
					{spec.kind === 'tet' && <tetrahedronGeometry args={[spec.radius * 1.35]} />}
					{spec.kind === 'torus' && (
						<torusGeometry args={[spec.radius * 0.78, spec.radius * 0.32, 14, 28]} />
					)}
					<meshStandardMaterial
						color={colorFor(spec.tone)}
						roughness={spec.roughness}
						metalness={0.18}
					/>
				</mesh>
			))}
		</group>
	);
}

export const ShapesCard = createGeometryCardWidget<ShapesData>({
	type: 'shapes-card',
	size: 'large',
	schema,
	defaultData: { accentIdx: 0 },
	background: 'linear-gradient(135deg, #1F2333 0%, #14161F 60%, #0A0B12 100%)',
	geometry: ShapesScene,
	provides: ['widget'],
});
