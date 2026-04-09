/**
 * Snap guide computation for alignment during drag operations.
 * Compares dragged entity edges/center against all other visible entities.
 */

export interface SnapGuide {
	/** Axis this guide aligns on */
	axis: 'x' | 'y';
	/** World-space coordinate of the alignment line */
	position: number;
	/** What kind of alignment */
	type: 'edge' | 'center';
}

export interface DistanceIndicator {
	/** Axis along which the distance runs */
	axis: 'x' | 'y';
	/** World-space start of the gap */
	from: number;
	/** World-space end of the gap */
	to: number;
	/** Position on the perpendicular axis (for rendering) */
	perpPosition: number;
}

export interface SnapResult {
	/** Snap-corrected delta (world units). Apply to entity position. */
	snapDx: number;
	snapDy: number;
	/** Active guide lines to render */
	guides: SnapGuide[];
	/** Distance indicators between aligned entities */
	distances: DistanceIndicator[];
}

export interface EntityBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Compute snap guides for a dragged entity against reference entities.
 * @param dragged - bounding box of the entity being dragged (current position)
 * @param references - bounding boxes of all other visible entities
 * @param threshold - max distance in world units to trigger a snap
 */
export function computeSnapGuides(
	dragged: EntityBounds,
	references: EntityBounds[],
	threshold: number,
): SnapResult {
	const guides: SnapGuide[] = [];
	const distances: DistanceIndicator[] = [];
	let snapDx = 0;
	let snapDy = 0;

	// Dragged entity edges and center
	const dLeft = dragged.x;
	const dRight = dragged.x + dragged.width;
	const dCenterX = dragged.x + dragged.width / 2;
	const dTop = dragged.y;
	const dBottom = dragged.y + dragged.height;
	const dCenterY = dragged.y + dragged.height / 2;

	let bestSnapX = Infinity;
	let bestSnapY = Infinity;
	let bestDx = 0;
	let bestDy = 0;
	const xGuides: SnapGuide[] = [];
	const yGuides: SnapGuide[] = [];

	for (const ref of references) {
		const rLeft = ref.x;
		const rRight = ref.x + ref.width;
		const rCenterX = ref.x + ref.width / 2;
		const rTop = ref.y;
		const rBottom = ref.y + ref.height;
		const rCenterY = ref.y + ref.height / 2;

		// --- X-axis alignment (vertical guide lines) ---
		const xPairs: [number, number, 'edge' | 'center'][] = [
			[dLeft, rLeft, 'edge'],      // left → left
			[dLeft, rRight, 'edge'],     // left → right
			[dRight, rLeft, 'edge'],     // right → left
			[dRight, rRight, 'edge'],    // right → right
			[dCenterX, rCenterX, 'center'], // center → center
			[dLeft, rCenterX, 'edge'],   // left → center
			[dRight, rCenterX, 'edge'],  // right → center
		];

		for (const [dVal, rVal, type] of xPairs) {
			const dist = Math.abs(dVal - rVal);
			if (dist <= threshold) {
				const dx = rVal - dVal;
				if (dist < bestSnapX) {
					bestSnapX = dist;
					bestDx = dx;
					xGuides.length = 0;
				}
				if (dist <= bestSnapX + 0.01) {
					xGuides.push({ axis: 'x', position: rVal, type });
				}
			}
		}

		// --- Y-axis alignment (horizontal guide lines) ---
		const yPairs: [number, number, 'edge' | 'center'][] = [
			[dTop, rTop, 'edge'],        // top → top
			[dTop, rBottom, 'edge'],     // top → bottom
			[dBottom, rTop, 'edge'],     // bottom → top
			[dBottom, rBottom, 'edge'],  // bottom → bottom
			[dCenterY, rCenterY, 'center'], // center → center
			[dTop, rCenterY, 'edge'],    // top → center
			[dBottom, rCenterY, 'edge'], // bottom → center
		];

		for (const [dVal, rVal, type] of yPairs) {
			const dist = Math.abs(dVal - rVal);
			if (dist <= threshold) {
				const dy = rVal - dVal;
				if (dist < bestSnapY) {
					bestSnapY = dist;
					bestDy = dy;
					yGuides.length = 0;
				}
				if (dist <= bestSnapY + 0.01) {
					yGuides.push({ axis: 'y', position: rVal, type });
				}
			}
		}
	}

	if (bestSnapX <= threshold) {
		snapDx = bestDx;
		// Deduplicate guides by position
		const seen = new Set<number>();
		for (const g of xGuides) {
			if (!seen.has(g.position)) {
				seen.add(g.position);
				guides.push(g);
			}
		}
	}

	if (bestSnapY <= threshold) {
		snapDy = bestDy;
		const seen = new Set<number>();
		for (const g of yGuides) {
			if (!seen.has(g.position)) {
				seen.add(g.position);
				guides.push(g);
			}
		}
	}

	// Compute distance indicators — only to the nearest neighbor on each side
	if (guides.length > 0) {
		const sb: EntityBounds = {
			x: dragged.x + snapDx,
			y: dragged.y + snapDy,
			width: dragged.width,
			height: dragged.height,
		};

		let nearestLeft: { gap: number; ind: DistanceIndicator } | null = null;
		let nearestRight: { gap: number; ind: DistanceIndicator } | null = null;
		let nearestAbove: { gap: number; ind: DistanceIndicator } | null = null;
		let nearestBelow: { gap: number; ind: DistanceIndicator } | null = null;

		for (const ref of references) {
			// Horizontal neighbors (need vertical overlap)
			const overlapY = sb.y < ref.y + ref.height && sb.y + sb.height > ref.y;
			if (overlapY) {
				const perpY = Math.max(sb.y, ref.y) +
					(Math.min(sb.y + sb.height, ref.y + ref.height) - Math.max(sb.y, ref.y)) / 2;

				// Entity to the left
				if (ref.x + ref.width <= sb.x + 0.1) {
					const gap = sb.x - (ref.x + ref.width);
					if (gap > 0.1 && (!nearestLeft || gap < nearestLeft.gap)) {
						nearestLeft = { gap, ind: { axis: 'x', from: ref.x + ref.width, to: sb.x, perpPosition: perpY } };
					}
				}
				// Entity to the right
				if (ref.x >= sb.x + sb.width - 0.1) {
					const gap = ref.x - (sb.x + sb.width);
					if (gap > 0.1 && (!nearestRight || gap < nearestRight.gap)) {
						nearestRight = { gap, ind: { axis: 'x', from: sb.x + sb.width, to: ref.x, perpPosition: perpY } };
					}
				}
			}

			// Vertical neighbors (need horizontal overlap)
			const overlapX = sb.x < ref.x + ref.width && sb.x + sb.width > ref.x;
			if (overlapX) {
				const perpX = Math.max(sb.x, ref.x) +
					(Math.min(sb.x + sb.width, ref.x + ref.width) - Math.max(sb.x, ref.x)) / 2;

				// Entity above
				if (ref.y + ref.height <= sb.y + 0.1) {
					const gap = sb.y - (ref.y + ref.height);
					if (gap > 0.1 && (!nearestAbove || gap < nearestAbove.gap)) {
						nearestAbove = { gap, ind: { axis: 'y', from: ref.y + ref.height, to: sb.y, perpPosition: perpX } };
					}
				}
				// Entity below
				if (ref.y >= sb.y + sb.height - 0.1) {
					const gap = ref.y - (sb.y + sb.height);
					if (gap > 0.1 && (!nearestBelow || gap < nearestBelow.gap)) {
						nearestBelow = { gap, ind: { axis: 'y', from: sb.y + sb.height, to: ref.y, perpPosition: perpX } };
					}
				}
			}
		}

		if (nearestLeft) distances.push(nearestLeft.ind);
		if (nearestRight) distances.push(nearestRight.ind);
		if (nearestAbove) distances.push(nearestAbove.ind);
		if (nearestBelow) distances.push(nearestBelow.ind);
	}

	return { snapDx, snapDy, guides, distances };
}
