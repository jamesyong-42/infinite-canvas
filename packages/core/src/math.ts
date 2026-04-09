export interface Vec2 {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AABB {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Convert WorldBounds-shaped data to AABB */
export function worldBoundsToAABB(wb: { worldX: number; worldY: number; worldWidth: number; worldHeight: number }): AABB {
	return {
		minX: wb.worldX,
		minY: wb.worldY,
		maxX: wb.worldX + wb.worldWidth,
		maxY: wb.worldY + wb.worldHeight,
	};
}

/** Convert a Rect to AABB */
export function rectToAABB(r: Rect): AABB {
	return {
		minX: r.x,
		minY: r.y,
		maxX: r.x + r.width,
		maxY: r.y + r.height,
	};
}

/** Convert AABB to Rect */
export function aabbToRect(a: AABB): Rect {
	return {
		x: a.minX,
		y: a.minY,
		width: a.maxX - a.minX,
		height: a.maxY - a.minY,
	};
}

/** Test if two AABBs overlap */
export function intersectsAABB(a: AABB, b: AABB): boolean {
	return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

/** Test if a point is inside an AABB */
export function pointInAABB(px: number, py: number, a: AABB): boolean {
	return px >= a.minX && px <= a.maxX && py >= a.minY && py <= a.maxY;
}

/** Convert screen coordinates to world coordinates */
export function screenToWorld(
	screenX: number,
	screenY: number,
	camera: { x: number; y: number; zoom: number },
): Vec2 {
	return {
		x: screenX / camera.zoom + camera.x,
		y: screenY / camera.zoom + camera.y,
	};
}

/** Convert world coordinates to screen coordinates */
export function worldToScreen(
	worldX: number,
	worldY: number,
	camera: { x: number; y: number; zoom: number },
): Vec2 {
	return {
		x: (worldX - camera.x) * camera.zoom,
		y: (worldY - camera.y) * camera.zoom,
	};
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
