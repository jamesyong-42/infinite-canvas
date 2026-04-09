import type { ComponentType, ResourceType, SystemDef, TagType } from './types.js';

/**
 * Define a component type. Components hold data attached to entities.
 *
 * @example
 * const Transform2D = defineComponent('Transform2D', {
 *   x: 0, y: 0, width: 100, height: 100, rotation: 0,
 * });
 */
export function defineComponent<T extends Record<string, any>>(
	name: string,
	defaults: T,
): ComponentType<T> {
	return Object.freeze({ name, defaults, __kind: 'component' as const });
}

/**
 * Define a tag type. Tags are markers with no data — used for boolean state.
 *
 * @example
 * const Selected = defineTag('Selected');
 */
export function defineTag(name: string): TagType {
	return Object.freeze({ name, __kind: 'tag' as const });
}

/**
 * Define a resource type. Resources are global singletons (camera, viewport, etc.)
 *
 * @example
 * const Camera = defineResource('Camera', { x: 0, y: 0, zoom: 1 });
 */
export function defineResource<T extends Record<string, any>>(
	name: string,
	defaults: T,
): ResourceType<T> {
	return Object.freeze({ name, defaults, __kind: 'resource' as const });
}

/**
 * Define a system. Systems are named functions that query and transform ECS data.
 *
 * @example
 * const mySystem = defineSystem({
 *   name: 'physics',
 *   after: 'layout',
 *   execute: (world) => {
 *     for (const entity of world.query(Transform2D, Velocity)) { ... }
 *   },
 * });
 */
export function defineSystem(def: SystemDef): SystemDef {
	return def;
}
