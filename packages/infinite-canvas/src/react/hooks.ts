import { useEffect, useRef, useState } from 'react';
import type { ComponentType, EntityId, ResourceType, TagType } from '../ecs/types.js';
import { useLayoutEngine } from './context.js';

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

/**
 * Subscribe to a component on a specific entity.
 * Re-renders only when this component on this entity changes.
 */
export function useComponent<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
	const engine = useLayoutEngine();
	const [value, setValue] = useState<T | undefined>(() => engine.get(entity, type));

	useEffect(() => {
		const current = engine.get(entity, type);
		setValue(current === undefined ? undefined : { ...current });

		const unsub = engine.world.onComponentChanged(
			type,
			(_id, _prev, next) => {
				setValue(next === undefined ? undefined : { ...next });
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
	const prevRef = useRef<T | undefined>(undefined);

	useEffect(() => {
		// Immediately sync to current value on (re-)subscription
		const current = engine.world.getResource(type);
		if (current !== undefined) {
			prevRef.current = current;
			setValue({ ...current });
		}

		const unsub = engine.onFrame(() => {
			const current = engine.world.getResource(type);
			if (
				prevRef.current === undefined ||
				!shallowEqual(
					current as unknown as Record<string, unknown>,
					prevRef.current as unknown as Record<string, unknown>,
				)
			) {
				prevRef.current = current;
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
	const typesRef = useRef(types);
	typesRef.current = types;
	const typesKey = types.map((t) => t.name).join('\0');

	const [result, setResult] = useState<EntityId[]>(() => engine.world.query(...types));

	useEffect(() => {
		// Immediately sync on (re-)subscription
		setResult(engine.world.query(...typesRef.current));

		const unsub = engine.onFrame(() => {
			const next = engine.world.query(...typesRef.current);
			setResult((prev) => {
				if (prev.length !== next.length) return next;
				for (let i = 0; i < prev.length; i++) {
					if (prev[i] !== next[i]) return next;
				}
				return prev;
			});
		});
		return unsub;
	}, [engine, typesKey]);

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
		setResult([...engine.world.queryTagged(type)]);

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
