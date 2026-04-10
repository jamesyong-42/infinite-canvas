import { useEffect, useRef, useState } from 'react';
import type { ComponentType, EntityId, ResourceType, TagType } from '../ecs/types.js';
import { useLayoutEngine } from './context.js';

/**
 * Subscribe to a component on a specific entity.
 * Re-renders only when this component on this entity changes.
 */
export function useComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
	const engine = useLayoutEngine();
	const [value, setValue] = useState<T | undefined>(() => engine.get(entity, type));

	useEffect(() => {
		setValue(engine.get(entity, type));

		const unsub = engine.world.onComponentChanged(
			type,
			(_id, _prev, next) => {
				setValue({ ...next });
			},
			entity,
		);

		return unsub;
	}, [engine, entity, type]);

	return value;
}

/**
 * Subscribe to a tag on a specific entity.
 * Re-renders when the tag is added or removed.
 */
export function useTag(entity: EntityId, type: TagType): boolean {
	const engine = useLayoutEngine();
	const [has, setHas] = useState(() => engine.world.hasTag(entity, type));

	useEffect(() => {
		setHas(engine.world.hasTag(entity, type));

		const unsub1 = engine.world.onTagAdded(type, () => setHas(true), entity);
		const unsub2 = engine.world.onTagRemoved(type, () => setHas(false), entity);

		return () => {
			unsub1();
			unsub2();
		};
	}, [engine, entity, type]);

	return has;
}

/**
 * Subscribe to a resource. Re-renders only when the resource actually changes.
 * Fix #6: Caches previous value and compares before triggering re-render.
 */
export function useResource<T>(type: ResourceType<T>): T {
	const engine = useLayoutEngine();
	const [value, setValue] = useState<T>(() => ({ ...engine.world.getResource(type) }));
	const prevRef = useRef<string>('');

	useEffect(() => {
		const unsub = engine.onFrame(() => {
			const current = engine.world.getResource(type);
			const serialized = JSON.stringify(current);
			if (serialized !== prevRef.current) {
				prevRef.current = serialized;
				setValue({ ...current });
			}
		});
		return unsub;
	}, [engine, type]);

	return value;
}

/**
 * Query entities matching component/tag types.
 * Re-renders when the result set changes.
 * Fix #7: Uses a stable key instead of spreading types into deps array.
 */
export function useQuery(...types: (ComponentType | TagType)[]): EntityId[] {
	const engine = useLayoutEngine();
	// Create a stable key from type names for the dependency
	const typeKey = types.map((t) => t.name).join(',');
	const [result, setResult] = useState<EntityId[]>(() => engine.world.query(...types));

	useEffect(() => {
		const unsub = engine.onFrame(() => {
			const next = engine.world.query(...types);
			setResult((prev) => {
				if (prev.length !== next.length || prev.some((id, i) => id !== next[i])) {
					return next;
				}
				return prev;
			});
		});
		return unsub;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine, typeKey]);

	return result;
}

/**
 * Get all entities with a specific tag.
 * Re-renders when the set changes.
 */
export function useTaggedEntities(type: TagType): EntityId[] {
	const engine = useLayoutEngine();
	const [result, setResult] = useState<EntityId[]>(() => engine.world.queryTagged(type));

	useEffect(() => {
		const update = () => setResult([...engine.world.queryTagged(type)]);
		const unsub1 = engine.world.onTagAdded(type, update);
		const unsub2 = engine.world.onTagRemoved(type, update);
		return () => {
			unsub1();
			unsub2();
		};
	}, [engine, type]);

	return result;
}
