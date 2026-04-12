import { useEffect, useRef, useState } from 'react';
import type { ComponentType, EntityId, ResourceType, TagType } from '../ecs/types.js';
import { CameraResource } from '../resources.js';
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
 * Reactively reads an ECS component from an entity.
 * Returns undefined if the entity doesn't have the component. Re-renders when the component changes.
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
 * Reactively checks whether an entity has a tag.
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
 * Reactively reads an ECS resource (singleton data).
 * Re-renders when any field of the resource changes (shallow comparison).
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
 * Returns entity IDs matching all specified component/tag types.
 * Re-renders when the result set changes.
 */
export function useQuery(...types: (ComponentType | TagType)[]): EntityId[] {
	const engine = useLayoutEngine();
	const typesRef = useRef(types);
	typesRef.current = types;
	const typesKey = types.map((t) => t.name).join('\0');

	const [result, setResult] = useState<EntityId[]>(() => engine.world.query(...types));

	// biome-ignore lint/correctness/useExhaustiveDependencies: typesKey is a stable proxy for the types array
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
 * Returns all entity IDs that have the specified tag.
 * Re-renders when entities are tagged or untagged.
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

/**
 * Returns the current camera state {x, y, zoom}.
 * Shorthand for useResource(CameraResource).
 */
export function useCamera(): { x: number; y: number; zoom: number } {
	const cam = useResource(CameraResource);
	return { x: cam?.x ?? 0, y: cam?.y ?? 0, zoom: cam?.zoom ?? 1 };
}
