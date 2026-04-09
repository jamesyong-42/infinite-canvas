declare module 'rbush' {
	interface BBox {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}

	class RBush<T extends BBox = BBox> {
		constructor(maxEntries?: number);
		insert(item: T): RBush<T>;
		remove(item: T, equals?: (a: T, b: T) => boolean): RBush<T>;
		search(bbox: BBox): T[];
		clear(): RBush<T>;
		load(items: T[]): RBush<T>;
		all(): T[];
		collides(bbox: BBox): boolean;
		toBBox(item: T): BBox;
	}

	export default RBush;
}
