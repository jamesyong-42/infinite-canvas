/**
 * Snap guide computation for alignment during drag operations.
 * Implements Figma-style snapping:
 * 1. Edge/center alignment guides
 * 2. Equal spacing snap + indicators
 */

export interface SnapGuide {
	/** Axis this guide aligns on */
	axis: 'x' | 'y';
	/** World-space coordinate of the alignment line */
	position: number;
	/** What kind of alignment */
	type: 'edge' | 'center';
}

export interface EqualSpacingIndicator {
	/** Axis along which the equal gaps run */
	axis: 'x' | 'y';
	/** The equal gap value (world units) */
	gap: number;
	/** Pairs of (from, to) marking each equal gap segment */
	segments: { from: number; to: number }[];
	/** Position on the perpendicular axis (for rendering) */
	perpPosition: number;
}

export interface SnapResult {
	/** Snap-corrected delta (world units). Apply to entity position. */
	snapDx: number;
	snapDy: number;
	/** Active alignment guide lines to render */
	guides: SnapGuide[];
	/** Equal spacing indicators */
	spacings: EqualSpacingIndicator[];
}

export interface EntityBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Compute snap guides for a dragged entity against reference entities.
 */
export function computeSnapGuides(
	dragged: EntityBounds,
	references: EntityBounds[],
	threshold: number,
): SnapResult {
	const guides: SnapGuide[] = [];
	const spacings: EqualSpacingIndicator[] = [];
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

	// --- Phase 1: Edge/center alignment ---

	for (const ref of references) {
		const rLeft = ref.x;
		const rRight = ref.x + ref.width;
		const rCenterX = ref.x + ref.width / 2;
		const rTop = ref.y;
		const rBottom = ref.y + ref.height;
		const rCenterY = ref.y + ref.height / 2;

		// X-axis alignment (vertical guide lines)
		const xPairs: [number, number, 'edge' | 'center'][] = [
			[dLeft, rLeft, 'edge'],
			[dLeft, rRight, 'edge'],
			[dRight, rLeft, 'edge'],
			[dRight, rRight, 'edge'],
			[dCenterX, rCenterX, 'center'],
			[dLeft, rCenterX, 'edge'],
			[dRight, rCenterX, 'edge'],
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

		// Y-axis alignment (horizontal guide lines)
		const yPairs: [number, number, 'edge' | 'center'][] = [
			[dTop, rTop, 'edge'],
			[dTop, rBottom, 'edge'],
			[dBottom, rTop, 'edge'],
			[dBottom, rBottom, 'edge'],
			[dCenterY, rCenterY, 'center'],
			[dTop, rCenterY, 'edge'],
			[dBottom, rCenterY, 'edge'],
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

	// --- Phase 2: Equal spacing snap ---
	// Check if we can place the dragged entity so that the gap to its
	// left and right (or top and bottom) neighbors are equal.

	const eqResult = computeEqualSpacing(dragged, references, threshold);

	// Merge: alignment snap takes priority, equal spacing fills in the other axis
	if (bestSnapX <= threshold) {
		snapDx = bestDx;
	} else if (eqResult.snapDx !== undefined) {
		snapDx = eqResult.snapDx;
	}
	if (bestSnapY <= threshold) {
		snapDy = bestDy;
	} else if (eqResult.snapDy !== undefined) {
		snapDy = eqResult.snapDy;
	}

	// Collect alignment guides
	if (bestSnapX <= threshold) {
		const seen = new Set<number>();
		for (const g of xGuides) {
			if (!seen.has(g.position)) {
				seen.add(g.position);
				guides.push(g);
			}
		}
	}
	if (bestSnapY <= threshold) {
		const seen = new Set<number>();
		for (const g of yGuides) {
			if (!seen.has(g.position)) {
				seen.add(g.position);
				guides.push(g);
			}
		}
	}

	// Collect equal spacing indicators (after applying snap)
	const snappedBounds: EntityBounds = {
		x: dragged.x + snapDx,
		y: dragged.y + snapDy,
		width: dragged.width,
		height: dragged.height,
	};
	const eqFinal = computeEqualSpacing(snappedBounds, references, threshold * 0.5);
	spacings.push(...eqFinal.indicators);

	return { snapDx, snapDy, guides, spacings };
}

// --- Equal spacing computation ---

interface EqualSpacingResult {
	snapDx?: number;
	snapDy?: number;
	indicators: EqualSpacingIndicator[];
}

function computeEqualSpacing(
	dragged: EntityBounds,
	references: EntityBounds[],
	threshold: number,
): EqualSpacingResult {
	const indicators: EqualSpacingIndicator[] = [];
	let snapDx: number | undefined;
	let snapDy: number | undefined;

	// X-axis: find left and right neighbors (entities on same horizontal band)
	const hNeighbors = references.filter((ref) =>
		ref.y < dragged.y + dragged.height && ref.y + ref.height > dragged.y,
	);

	// Find nearest left and right neighbors
	let leftNeighbor: EntityBounds | null = null;
	let leftGap = Infinity;
	let rightNeighbor: EntityBounds | null = null;
	let rightGap = Infinity;

	for (const ref of hNeighbors) {
		const refRight = ref.x + ref.width;
		if (refRight <= dragged.x + threshold) {
			const gap = dragged.x - refRight;
			if (gap >= -threshold && gap < leftGap) {
				leftGap = gap;
				leftNeighbor = ref;
			}
		}
		const refLeft = ref.x;
		if (refLeft >= dragged.x + dragged.width - threshold) {
			const gap = refLeft - (dragged.x + dragged.width);
			if (gap >= -threshold && gap < rightGap) {
				rightGap = gap;
				rightNeighbor = ref;
			}
		}
	}

	// Check if left gap ≈ right gap → equal spacing on X
	if (leftNeighbor && rightNeighbor && leftGap > 0.1 && rightGap > 0.1) {
		const diff = Math.abs(leftGap - rightGap);
		if (diff <= threshold) {
			// Snap X to center between neighbors
			const idealX = (leftNeighbor.x + leftNeighbor.width + rightNeighbor.x - dragged.width) / 2;
			snapDx = idealX - dragged.x;

			const equalGap = (rightNeighbor.x - (leftNeighbor.x + leftNeighbor.width) - dragged.width) / 2;
			const perpY = Math.max(dragged.y, leftNeighbor.y, rightNeighbor.y) +
				Math.min(dragged.height, leftNeighbor.height, rightNeighbor.height) / 2;

			if (equalGap > 0.1) {
				indicators.push({
					axis: 'x',
					gap: equalGap,
					segments: [
						{ from: leftNeighbor.x + leftNeighbor.width, to: idealX },
						{ from: idealX + dragged.width, to: rightNeighbor.x },
					],
					perpPosition: perpY,
				});
			}
		}
	}

	// Y-axis: find top and bottom neighbors (entities on same vertical band)
	const vNeighbors = references.filter((ref) =>
		ref.x < dragged.x + dragged.width && ref.x + ref.width > dragged.x,
	);

	let topNeighbor: EntityBounds | null = null;
	let topGap = Infinity;
	let bottomNeighbor: EntityBounds | null = null;
	let bottomGap = Infinity;

	for (const ref of vNeighbors) {
		const refBottom = ref.y + ref.height;
		if (refBottom <= dragged.y + threshold) {
			const gap = dragged.y - refBottom;
			if (gap >= -threshold && gap < topGap) {
				topGap = gap;
				topNeighbor = ref;
			}
		}
		const refTop = ref.y;
		if (refTop >= dragged.y + dragged.height - threshold) {
			const gap = refTop - (dragged.y + dragged.height);
			if (gap >= -threshold && gap < bottomGap) {
				bottomGap = gap;
				bottomNeighbor = ref;
			}
		}
	}

	// Check if top gap ≈ bottom gap → equal spacing on Y
	if (topNeighbor && bottomNeighbor && topGap > 0.1 && bottomGap > 0.1) {
		const diff = Math.abs(topGap - bottomGap);
		if (diff <= threshold) {
			const idealY = (topNeighbor.y + topNeighbor.height + bottomNeighbor.y - dragged.height) / 2;
			snapDy = idealY - dragged.y;

			const equalGap = (bottomNeighbor.y - (topNeighbor.y + topNeighbor.height) - dragged.height) / 2;
			const perpX = Math.max(dragged.x, topNeighbor.x, bottomNeighbor.x) +
				Math.min(dragged.width, topNeighbor.width, bottomNeighbor.width) / 2;

			if (equalGap > 0.1) {
				indicators.push({
					axis: 'y',
					gap: equalGap,
					segments: [
						{ from: topNeighbor.y + topNeighbor.height, to: idealY },
						{ from: idealY + dragged.height, to: bottomNeighbor.y },
					],
					perpPosition: perpX,
				});
			}
		}
	}

	return { snapDx, snapDy, indicators };
}
