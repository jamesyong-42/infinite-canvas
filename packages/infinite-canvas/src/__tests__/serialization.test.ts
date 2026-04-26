import { createWorld, type defineTag } from '@jamesyong42/reactive-ecs';
import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld } from '../ecs/serialization.js';
import {
	CameraResource,
	Card,
	Container,
	ContainerCamera,
	ParentFrame,
	RootCameraResource,
	Transform2D,
} from '../index.js';

/**
 * Minimal set of component / tag types the tests need. `serializeWorld`
 * requires explicit lists rather than discovering them at runtime so
 * downstream libraries can control exactly what ends up in the document.
 */
function typeLists() {
	return {
		componentTypes: [Transform2D, Card, Container, ContainerCamera, ParentFrame],
		tagTypes: [] as ReturnType<typeof defineTag>[],
	};
}

describe('serialization — RFC-004 Phase 0c round-trip', () => {
	it('persists and restores RootCameraResource', () => {
		const world = createWorld();
		world.setResource(RootCameraResource, { x: 150, y: 250, zoom: 1.75 });

		const { componentTypes, tagTypes } = typeLists();
		const doc = serializeWorld(
			world,
			componentTypes,
			tagTypes,
			{ x: 0, y: 0, zoom: 1 },
			{
				x: 150,
				y: 250,
				zoom: 1.75,
			},
		);

		// Fresh world to prove the round-trip.
		const fresh = createWorld();
		deserializeWorld(fresh, doc, componentTypes, tagTypes);

		expect(fresh.getResource(RootCameraResource)).toEqual({ x: 150, y: 250, zoom: 1.75 });
	});

	it('restores the live camera (stripping `gesturing` to false)', () => {
		const world = createWorld();
		const { componentTypes, tagTypes } = typeLists();
		const doc = serializeWorld(
			world,
			componentTypes,
			tagTypes,
			{ x: 42, y: 84, zoom: 2.5 },
			{ x: 0, y: 0, zoom: 1 },
		);

		const fresh = createWorld();
		deserializeWorld(fresh, doc, componentTypes, tagTypes);

		const camera = fresh.getResource(CameraResource);
		expect(camera.x).toBe(42);
		expect(camera.y).toBe(84);
		expect(camera.zoom).toBe(2.5);
		// Transient interaction state always resets on load.
		expect(camera.gesturing).toBe(false);
	});

	it('persists ContainerCamera as part of each container entity', () => {
		const world = createWorld();
		const id = world.createEntity();
		world.addComponent(id, Transform2D, { x: 0, y: 0, width: 400, height: 300, rotation: 0 });
		world.addComponent(id, Container, { enterable: true });
		world.addComponent(id, ContainerCamera, { x: 99, y: 77, zoom: 3 });

		const { componentTypes, tagTypes } = typeLists();
		const doc = serializeWorld(
			world,
			componentTypes,
			tagTypes,
			{ x: 0, y: 0, zoom: 1 },
			{ x: 0, y: 0, zoom: 1 },
		);

		const fresh = createWorld();
		deserializeWorld(fresh, doc, componentTypes, tagTypes);

		// Entity ids may be remapped; find the one container that exists.
		const containerIds = fresh.query(Container);
		expect(containerIds.length).toBe(1);
		const restored = fresh.getComponent(containerIds[0], ContainerCamera);
		expect(restored).toEqual({ x: 99, y: 77, zoom: 3 });
	});

	it('persists Card accepts / provides contract arrays (RFC-004 Phase 1)', () => {
		const world = createWorld();
		const id = world.createEntity();
		world.addComponent(id, Card, {
			preset: 'medium',
			background: '#fff',
			accepts: ['widget', 'image'],
			provides: ['widget'],
		});

		const { componentTypes, tagTypes } = typeLists();
		const doc = serializeWorld(
			world,
			componentTypes,
			tagTypes,
			{ x: 0, y: 0, zoom: 1 },
			{ x: 0, y: 0, zoom: 1 },
		);

		const fresh = createWorld();
		deserializeWorld(fresh, doc, componentTypes, tagTypes);

		const cardIds = fresh.query(Card);
		expect(cardIds.length).toBe(1);
		const restored = fresh.getComponent(cardIds[0], Card);
		expect(restored?.accepts).toEqual(['widget', 'image']);
		expect(restored?.provides).toEqual(['widget']);
		expect(restored?.preset).toBe('medium');
		expect(restored?.background).toBe('#fff');
	});
});
