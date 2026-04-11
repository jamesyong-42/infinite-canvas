import { describe, expect, it, vi } from 'vitest';
import { defineComponent, defineResource, defineTag } from '../define.js';
import { createWorld } from '../world.js';

const Position = defineComponent('Position', { x: 0, y: 0 });
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 });
const Label = defineComponent('Label', { text: '' });
const Selected = defineTag('Selected');
const Visible = defineTag('Visible');
const Camera = defineResource('Camera', { x: 0, y: 0, zoom: 1 });

describe('World', () => {
	describe('entities', () => {
		it('creates entities with unique ids', () => {
			const world = createWorld();
			const a = world.createEntity();
			const b = world.createEntity();
			expect(a).not.toBe(b);
			expect(world.entityExists(a)).toBe(true);
			expect(world.entityExists(b)).toBe(true);
		});

		it('destroys entities', () => {
			const world = createWorld();
			const e = world.createEntity();
			world.addComponent(e, Position, { x: 10, y: 20 });
			world.addTag(e, Selected);
			world.destroyEntity(e);
			expect(world.entityExists(e)).toBe(false);
			expect(world.getComponent(e, Position)).toBeUndefined();
			expect(world.hasTag(e, Selected)).toBe(false);
		});
	});

	describe('components', () => {
		it('adds and gets components with defaults merged', () => {
			const world = createWorld();
			const e = world.createEntity();
			// Use a Partial cast: runtime merges with defaults, but the type
			// signature requires the full shape. See note in addComponent.
			world.addComponent(e, Position, { x: 42 } as { x: number; y: number });
			const pos = world.getComponent(e, Position);
			expect(pos).toBeDefined();
			if (!pos) throw new Error('Position component missing');
			expect(pos.x).toBe(42);
			expect(pos.y).toBe(0); // default
		});

		it('sets partial component data', () => {
			const world = createWorld();
			const e = world.createEntity();
			world.addComponent(e, Position, { x: 10, y: 20 });
			world.setComponent(e, Position, { x: 99 });
			const pos = world.getComponent(e, Position);
			expect(pos).toBeDefined();
			if (!pos) throw new Error('Position component missing');
			expect(pos.x).toBe(99);
			expect(pos.y).toBe(20); // unchanged
		});

		it('removes components', () => {
			const world = createWorld();
			const e = world.createEntity();
			world.addComponent(e, Position, { x: 1, y: 2 });
			expect(world.hasComponent(e, Position)).toBe(true);
			world.removeComponent(e, Position);
			expect(world.hasComponent(e, Position)).toBe(false);
			expect(world.getComponent(e, Position)).toBeUndefined();
		});

		it('handles string/object data in components', () => {
			const world = createWorld();
			const e = world.createEntity();
			world.addComponent(e, Label, { text: 'Hello World' });
			expect(world.getComponent(e, Label)?.text).toBe('Hello World');
		});
	});

	describe('tags', () => {
		it('adds and checks tags', () => {
			const world = createWorld();
			const e = world.createEntity();
			expect(world.hasTag(e, Selected)).toBe(false);
			world.addTag(e, Selected);
			expect(world.hasTag(e, Selected)).toBe(true);
		});

		it('removes tags', () => {
			const world = createWorld();
			const e = world.createEntity();
			world.addTag(e, Selected);
			world.removeTag(e, Selected);
			expect(world.hasTag(e, Selected)).toBe(false);
		});

		it('adding tag twice is idempotent', () => {
			const world = createWorld();
			const e = world.createEntity();
			world.addTag(e, Selected);
			world.addTag(e, Selected);
			expect(world.hasTag(e, Selected)).toBe(true);
		});
	});

	describe('queries', () => {
		it('queries entities by component', () => {
			const world = createWorld();
			const e1 = world.createEntity();
			const e2 = world.createEntity();
			const e3 = world.createEntity();
			world.addComponent(e1, Position, { x: 0, y: 0 });
			world.addComponent(e2, Position, { x: 1, y: 1 });
			world.addComponent(e2, Velocity, { dx: 1, dy: 0 });
			world.addComponent(e3, Velocity, { dx: 2, dy: 2 });

			const withPosition = world.query(Position);
			expect(withPosition).toHaveLength(2);
			expect(withPosition).toContain(e1);
			expect(withPosition).toContain(e2);

			const withBoth = world.query(Position, Velocity);
			expect(withBoth).toHaveLength(1);
			expect(withBoth).toContain(e2);
		});

		it('queries entities by tag', () => {
			const world = createWorld();
			const e1 = world.createEntity();
			const e2 = world.createEntity();
			world.addTag(e1, Selected);
			world.addTag(e1, Visible);
			world.addTag(e2, Visible);

			const selected = world.query(Selected);
			expect(selected).toEqual([e1]);

			const visible = world.query(Visible);
			expect(visible).toHaveLength(2);
		});

		it('queries with mixed components and tags', () => {
			const world = createWorld();
			const e1 = world.createEntity();
			const e2 = world.createEntity();
			world.addComponent(e1, Position, { x: 0, y: 0 });
			world.addTag(e1, Visible);
			world.addComponent(e2, Position, { x: 1, y: 1 });

			const result = world.query(Position, Visible);
			expect(result).toEqual([e1]);
		});

		it('queryChanged returns dirty entities', () => {
			const world = createWorld();
			const e1 = world.createEntity();
			const e2 = world.createEntity();
			world.addComponent(e1, Position, { x: 0, y: 0 });
			world.addComponent(e2, Position, { x: 1, y: 1 });

			// Both are dirty after add
			expect(world.queryChanged(Position)).toHaveLength(2);

			// Clear dirty
			world.clearDirty();

			// Only e1 is dirty after set
			world.setComponent(e1, Position, { x: 99 });
			const changed = world.queryChanged(Position);
			expect(changed).toHaveLength(1);
			expect(changed).toContain(e1);
		});

		it('queryTagged returns all entities with a tag', () => {
			const world = createWorld();
			const e1 = world.createEntity();
			const e2 = world.createEntity();
			world.addTag(e1, Selected);
			world.addTag(e2, Selected);

			const tagged = world.queryTagged(Selected);
			expect(tagged).toHaveLength(2);
		});
	});

	describe('resources', () => {
		it('gets resource with defaults', () => {
			const world = createWorld();
			const cam = world.getResource(Camera);
			expect(cam).toEqual({ x: 0, y: 0, zoom: 1 });
		});

		it('sets partial resource data', () => {
			const world = createWorld();
			world.setResource(Camera, { zoom: 2.5 });
			const cam = world.getResource(Camera);
			expect(cam.zoom).toBe(2.5);
			expect(cam.x).toBe(0); // unchanged
		});
	});

	describe('events', () => {
		it('fires component changed events', () => {
			const world = createWorld();
			const handler = vi.fn();
			world.onComponentChanged(Position, handler);

			const e = world.createEntity();
			world.addComponent(e, Position, { x: 10, y: 20 });

			expect(handler).toHaveBeenCalledWith(e, undefined, { x: 10, y: 20 });
		});

		it('fires tag added/removed events', () => {
			const world = createWorld();
			const added = vi.fn();
			const removed = vi.fn();
			world.onTagAdded(Selected, added);
			world.onTagRemoved(Selected, removed);

			const e = world.createEntity();
			world.addTag(e, Selected);
			expect(added).toHaveBeenCalledWith(e);

			world.removeTag(e, Selected);
			expect(removed).toHaveBeenCalledWith(e);
		});

		it('unsubscribes handlers', () => {
			const world = createWorld();
			const handler = vi.fn();
			const unsub = world.onComponentChanged(Position, handler);

			const e = world.createEntity();
			world.addComponent(e, Position, { x: 1, y: 2 });
			expect(handler).toHaveBeenCalledTimes(1);

			unsub();
			world.setComponent(e, Position, { x: 99 });
			expect(handler).toHaveBeenCalledTimes(1); // not called again
		});
	});
});
