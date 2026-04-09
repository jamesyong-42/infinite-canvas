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

	// Compute distance indicators for snapped axes
	if (guides.length > 0) {
		const snappedBounds: EntityBounds = {
			x: dragged.x + snapDx,
			y: dragged.y + snapDy,
			width: dragged.width,
			height: dragged.height,
		};

		for (const ref of references) {
			// X-axis distances (horizontal gaps)
			if (bestSnapY <= threshold) {
				// Check if vertically overlapping after snap
				const overlapY = snappedBounds.y < ref.y + ref.height && snappedBounds.y + snappedBounds.height > ref.y;
				if (overlapY) {
					const perpY = Math.max(snappedBounds.y, ref.y) +
						(Math.min(snappedBounds.y + snappedBounds.height, ref.y + ref.height) -
						Math.max(snappedBounds.y, ref.y)) / 2;

					// Gap to the right of ref, left of dragged
					if (snappedBounds.x > ref.x + ref.width + 0.1) {
						distances.push({
							axis: 'x',
							from: ref.x + ref.width,
							to: snappedBounds.x,
							perpPosition: perpY,
						});
					}
					// Gap to the left of ref, right of dragged
					if (ref.x > snappedBounds.x + snappedBounds.width + 0.1) {
						distances.push({
							axis: 'x',
							from: snappedBounds.x + snappedBounds.width,
							to: ref.x,
							perpPosition: perpY,
						});
					}
				}
			}

			// Y-axis distances (vertical gaps)
			if (bestSnapX <= threshold) {
				const overlapX = snappedBounds.x < ref.x + ref.width && snappedBounds.x + snappedBounds.width > ref.x;
				if (overlapX) {
					const perpX = Math.max(snappedBounds.x, ref.x) +
						(Math.min(snappedBounds.x + snappedBounds.width, ref.x + ref.width) -
						Math.max(snappedBounds.x, ref.x)) / 2;

					if (snappedBounds.y > ref.y + ref.height + 0.1) {
						distances.push({
							axis: 'y',
							from: ref.y + ref.height,
							to: snappedBounds.y,
							perpPosition: perpX,
						});
					}
					if (ref.y > snappedBounds.y + snappedBounds.height + 0.1) {
						distances.push({
							axis: 'y',
							from: snappedBounds.y + snappedBounds.height,
							to: ref.y,
							perpPosition: perpX,
						});
					}
				}
			}
		}
	}

	return { snapDx, snapDy, guides, distances };
}
