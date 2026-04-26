import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import type { CommandBuffer, EntitySnapshot } from '../commands.js';
import { ConsumeCommand, MoveCommand, ResizeCommand, snapshotEntity } from '../commands.js';
import type { CSSCursor, InteractionRoleData, ResizeHandlePos } from '../components.js';
import {
	Active,
	Card,
	CardOverlapHotPoint,
	CursorHint,
	Draggable,
	Dragging,
	InteractionRole,
	OverlapCandidate,
	OverlapTarget,
	Resizable,
	Selectable,
	Selected,
	SnapSource,
	SnapTarget,
	Transform2D,
	TransformTween,
	Widget,
	ZIndex,
} from '../components.js';
import { DEAD_ZONE_MOUSE_PX, MIN_WIDGET_SIZE } from '../interaction-constants.js';
import { screenToWorld } from '../math.js';
import { CameraResource, CursorResource } from '../resources.js';
import type { SpatialIndex } from '../spatial/SpatialIndex.js';
import type { SnapResult } from '../spatial/snap.js';
import { computeSnapGuides } from '../spatial/snap.js';
import type { Modifiers, PointerDirective } from './types.js';

/**
 * Hit-zone size for resize hotspots (full width, screen px). Deliberately
 * larger than the visual handle size to give a generous clickable area.
 * Do not reduce without a UX test.
 *
 * Private to `interaction.ts` post-RFC-005 — handle hotspots are not
 * separate ECS entities, so this constant has no other consumer.
 */
const HANDLE_HIT_SIZE_PX = 16;

type RectLike = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Return the resize-handle hotspot a world-space point falls inside,
 * if any. Corners are tested before edges so they win when hit zones
 * overlap — this replicates today's `layer: 15` (corner) vs
 * `layer: 10` (edge) priority encoded on handle entities.
 *
 * `zoom` converts the screen-pixel hit size to world units so the
 * hotspot stays visually constant across zoom levels.
 */
export function detectResizeHandle(
	worldX: number,
	worldY: number,
	rect: RectLike,
	zoom: number,
): ResizeHandlePos | null {
	const S = HANDLE_HIT_SIZE_PX / zoom;
	const half = S / 2;
	const xL = rect.x;
	const xR = rect.x + rect.width;
	const yT = rect.y;
	const yB = rect.y + rect.height;

	const corners: Array<{ pos: ResizeHandlePos; cx: number; cy: number }> = [
		{ pos: 'nw', cx: xL, cy: yT },
		{ pos: 'ne', cx: xR, cy: yT },
		{ pos: 'sw', cx: xL, cy: yB },
		{ pos: 'se', cx: xR, cy: yB },
	];
	for (const c of corners) {
		if (
			worldX >= c.cx - half &&
			worldX <= c.cx + half &&
			worldY >= c.cy - half &&
			worldY <= c.cy + half
		) {
			return c.pos;
		}
	}

	const edges: Array<{ pos: ResizeHandlePos; cx: number; cy: number }> = [
		{ pos: 'n', cx: (xL + xR) / 2, cy: yT },
		{ pos: 's', cx: (xL + xR) / 2, cy: yB },
		{ pos: 'w', cx: xL, cy: (yT + yB) / 2 },
		{ pos: 'e', cx: xR, cy: (yT + yB) / 2 },
	];
	for (const e of edges) {
		if (
			worldX >= e.cx - half &&
			worldX <= e.cx + half &&
			worldY >= e.cy - half &&
			worldY <= e.cy + half
		) {
			return e.pos;
		}
	}

	return null;
}

/**
 * Inline resize-handle hit test (RFC-005).
 *
 * Returns a `{ entityId: widgetId, role: resize-with-handle-pos }`
 * result when the pointer falls inside one of the 8 hotspots around
 * the single selected `Resizable` widget. Gated on exactly-one
 * selected Resizable so that multi-select drag doesn't accidentally
 * latch onto a resize hotspot — matches the historical
 * handle-spawning rule.
 */
function findInlineResizeHit(
	world: World,
	worldX: number,
	worldY: number,
	zoom: number,
): { entityId: EntityId; role: InteractionRoleData } | null {
	let selected: EntityId | null = null;
	let count = 0;
	for (const e of world.queryTagged(Resizable)) {
		if (world.hasTag(e, Selected)) {
			selected = e;
			if (++count > 1) return null;
		}
	}
	if (!selected) return null;

	const t = world.getComponent(selected, Transform2D);
	if (!t) return null;

	const handle = detectResizeHandle(worldX, worldY, t, zoom);
	if (!handle) return null;

	return {
		entityId: selected,
		role: { layer: 15, role: { type: 'resize', handle } },
	};
}

/**
 * Map a resize-handle position to the CSS cursor value. Used by the
 * cursor system in place of the per-handle-entity `CursorHint` reads
 * the old model used.
 */
function cursorForHandle(handle: ResizeHandlePos): CSSCursor {
	return `${handle}-resize` as CSSCursor;
}

type InputState =
	| { mode: 'idle' }
	| { mode: 'tracking'; entityId: EntityId; startX: number; startY: number }
	| {
			mode: 'dragging';
			entityId: EntityId;
			startScreenX: number;
			startScreenY: number;
			startPositions: Map<EntityId, { x: number; y: number }>;
			originalZIndices: Map<EntityId, number>;
	  }
	| {
			mode: 'resizing';
			entityId: EntityId;
			handle: ResizeHandlePos;
			startX: number;
			startY: number;
			startBounds: { x: number; y: number; width: number; height: number };
	  }
	| {
			/**
			 * RFC-004 § Phase 4 — the card is animating back to its
			 * pre-drag position after a mismatched drop. `Dragging` stays
			 * set for the duration so layer / ZIndex / compositor
			 * drag-promote state is preserved. Completion poll in
			 * `tickFrame()` watches for `TransformTween` removal to
			 * transition to idle.
			 */
			mode: 'flyingBack';
			entityId: EntityId;
			startPositions: Map<EntityId, { x: number; y: number }>;
			originalZIndices: Map<EntityId, number>;
	  }
	| { mode: 'marquee'; startX: number; startY: number };

export interface InteractionContext {
	world: World;
	spatialIndex: SpatialIndex;
	commandBuffer: CommandBuffer;
	/** Called whenever something that requires a re-tick mutates. */
	markDirty: () => void;
	/** Called whenever the selection set changes so the frame runner can flag it. */
	notifySelectionChanged: () => void;
	/** Snap configuration accessors — held by the engine so toggles at runtime take effect. */
	getSnapEnabled: () => boolean;
	getSnapThreshold: () => number;
	/**
	 * Resolve a widget type's registered interaction handlers (RFC-004
	 * § Phase 1). Used by the overlap pass to call the optional
	 * `canAccept` gate before flagging a card as `OverlapTarget`.
	 * Returns `undefined` when the widget type has no handlers.
	 */
	getWidgetInteraction?: (
		type: string,
	) => import('./widget-binding.js').WidgetInteractionHandlers | undefined;
}

/**
 * The pointer state machine, hit testing, selection logic, and the
 * root-container cursor resolution.
 *
 * Kept as one cohesive unit because every branch of the state machine needs
 * access to the same closed-over state (inputState, hoveredEntity, snap
 * result). Splitting further would require threading state refs through
 * every callee, which hurts readability more than it helps.
 */
export function createInteractionRuntime(ctx: InteractionContext) {
	const { world, spatialIndex, commandBuffer, markDirty, notifySelectionChanged } = ctx;

	let inputState: InputState = { mode: 'idle' };
	let hoveredEntity: EntityId | null = null;
	/**
	 * Cached handle position the pointer is currently over, iff the
	 * hovered entity is the selected `Resizable` widget. Updated by the
	 * idle-branch hover path in `handlePointerMove`; read by
	 * `runCursorSystem` to pick the right directional cursor without
	 * consulting a handle entity's `CursorHint` (RFC-005).
	 */
	let hoveredHandle: ResizeHandlePos | null = null;
	let currentSnap: SnapResult = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };

	// RFC-004 § Phase 3 — card overlap state. Populated while a Card-tagged
	// entity is being dragged; cleared on drag end (commit, fly-back, or
	// cancel). All three collections are mirrored into ECS tags/components
	// for rendering layers to read; these locals let us diff cheaply.
	let overlapCandidates = new Set<EntityId>();
	let overlapTarget: EntityId | null = null;

	function hitTest(
		screenX: number,
		screenY: number,
	): { entityId: EntityId; role: InteractionRoleData } | null {
		const camera = world.getResource(CameraResource);
		const worldPos = screenToWorld(screenX, screenY, camera);

		// Resize hotspots take priority — corner/edge hits live on the
		// selected Resizable widget directly (no sub-entity handles).
		const inlineHit = findInlineResizeHit(world, worldPos.x, worldPos.y, camera.zoom);
		if (inlineHit) return inlineHit;

		// Zero-tolerance point query: RBush returns only entries whose AABB
		// strictly contains the point, so no secondary pointInAABB check is
		// needed. Resize hit slop is handled by `detectResizeHandle` above;
		// widget-body hits use the widget's own AABB directly.
		const candidates = spatialIndex.searchPoint(worldPos.x, worldPos.y, 0);

		type Candidate = { entityId: EntityId; role: InteractionRoleData };
		const interactable: Candidate[] = [];
		for (const c of candidates) {
			if (!world.hasTag(c.entityId, Active)) continue;
			const role = world.getComponent(c.entityId, InteractionRole);
			if (!role) continue;
			interactable.push({ entityId: c.entityId, role });
		}
		if (interactable.length === 0) return null;

		interactable.sort((a, b) => {
			if (b.role.layer !== a.role.layer) return b.role.layer - a.role.layer;
			const zA = world.getComponent(a.entityId, ZIndex)?.value ?? 0;
			const zB = world.getComponent(b.entityId, ZIndex)?.value ?? 0;
			return zB - zA;
		});

		return interactable[0];
	}

	function selectEntity(entity: EntityId, additive: boolean) {
		if (!world.hasTag(entity, Selectable)) return;

		if (additive) {
			if (world.hasTag(entity, Selected)) {
				world.removeTag(entity, Selected);
			} else {
				world.addTag(entity, Selected);
			}
		} else {
			for (const e of world.queryTagged(Selected)) {
				if (e !== entity) world.removeTag(e, Selected);
			}
			world.addTag(entity, Selected);
		}
		notifySelectionChanged();
	}

	function clearSelection() {
		const selected = world.queryTagged(Selected);
		if (selected.length > 0) {
			for (const e of selected) {
				world.removeTag(e, Selected);
			}
			notifySelectionChanged();
		}
	}

	/**
	 * RFC-004 § Phase 3 — contract match between a dragged card (child)
	 * and a candidate parent. Returns true iff their `provides` /
	 * `accepts` arrays intersect AND the optional `canAccept` gate on
	 * the parent's widget type returns truthy.
	 */
	function contractsMatch(childId: EntityId, parentId: EntityId): boolean {
		const childCard = world.getComponent(childId, Card);
		const parentCard = world.getComponent(parentId, Card);
		if (!childCard || !parentCard) return false;
		if (childCard.provides.length === 0 || parentCard.accepts.length === 0) return false;
		let intersects = false;
		for (const p of childCard.provides) {
			if (parentCard.accepts.includes(p)) {
				intersects = true;
				break;
			}
		}
		if (!intersects) return false;
		const gate = ctx.getWidgetInteraction?.(
			world.getComponent(parentId, Widget)?.type ?? '',
		)?.canAccept;
		if (!gate) return true;
		return gate({ parent: parentId, child: childId, world });
	}

	/**
	 * RFC-004 § Phase 3 — the overlap detection pass.
	 *
	 * Called from `handlePointerMove` whenever a Card-tagged entity is
	 * being dragged. Produces three pieces of visible state:
	 *
	 * - `OverlapCandidate` tag + `CardOverlapHotPoint` component on every
	 *   other card whose AABB intersects the dragged card's AABB.
	 *   `CardOverlapHotPoint.{x,y}` are the intersection centroid in the
	 *   overlapped card's local (0..1) frame. Layer 1 of the visual state.
	 *
	 * - `OverlapTarget` tag on at most one card — the closest by centre
	 *   distance — iff contracts match and any `canAccept` gate passes.
	 *   Layer 2.
	 *
	 * `strength` is set to 1 on entry and 0 on exit; CSS / shader
	 * consumers own the actual fade transition (opacity transition at
	 * the rendering layer). Keeps the ECS pass cheap and stateless.
	 */
	function updateCardOverlap(draggedId: EntityId): void {
		if (!world.hasComponent(draggedId, Card)) {
			clearOverlapState();
			return;
		}
		const draggedT = world.getComponent(draggedId, Transform2D);
		if (!draggedT) {
			clearOverlapState();
			return;
		}
		const dxMin = draggedT.x;
		const dyMin = draggedT.y;
		const dxMax = draggedT.x + draggedT.width;
		const dyMax = draggedT.y + draggedT.height;
		const dCenterX = draggedT.x + draggedT.width / 2;
		const dCenterY = draggedT.y + draggedT.height / 2;

		// Gather Card entities whose AABB intersects the dragged rect.
		// Filter to `Active` so consumed children (which still occupy a
		// spatial-index slot at their drop-world coords) don't register as
		// overlap candidates at their parent's frame (RFC-004 § Phase 5).
		const next = new Set<EntityId>();
		const hits = spatialIndex.search({
			minX: dxMin,
			minY: dyMin,
			maxX: dxMax,
			maxY: dyMax,
		});
		for (const entry of hits) {
			if (entry.entityId === draggedId) continue;
			if (!world.hasComponent(entry.entityId, Card)) continue;
			if (!world.hasTag(entry.entityId, Active)) continue;
			next.add(entry.entityId);
		}

		// Exit: tags + hot-point component come off cards no longer overlapping.
		for (const prev of overlapCandidates) {
			if (!next.has(prev)) {
				world.removeTag(prev, OverlapCandidate);
				world.removeComponent(prev, CardOverlapHotPoint);
			}
		}
		// Enter: add tag + default hot-point on new candidates. Use
		// addComponent so reactive-ecs registers the component up front;
		// the hot-point write loop below then freely `setComponent` to
		// update it every move.
		for (const c of next) {
			if (!overlapCandidates.has(c)) {
				world.addTag(c, OverlapCandidate);
				world.addComponent(c, CardOverlapHotPoint, { x: 0.5, y: 0.5, strength: 0 });
			}
		}

		// Hot-point write + primary selection.
		let primary: EntityId | null = null;
		let bestDist = Number.POSITIVE_INFINITY;
		let bestZ = Number.NEGATIVE_INFINITY;
		let bestId = Number.POSITIVE_INFINITY;
		for (const c of next) {
			const ct = world.getComponent(c, Transform2D);
			if (!ct) continue;
			const cxMin = ct.x;
			const cyMin = ct.y;
			const cxMax = ct.x + ct.width;
			const cyMax = ct.y + ct.height;

			// Intersection centroid → normalized local coords within `c`.
			const ix = (Math.max(dxMin, cxMin) + Math.min(dxMax, cxMax)) / 2;
			const iy = (Math.max(dyMin, cyMin) + Math.min(dyMax, cyMax)) / 2;
			const hotX = ct.width > 0 ? (ix - ct.x) / ct.width : 0.5;
			const hotY = ct.height > 0 ? (iy - ct.y) / ct.height : 0.5;
			world.setComponent(c, CardOverlapHotPoint, {
				x: hotX < 0 ? 0 : hotX > 1 ? 1 : hotX,
				y: hotY < 0 ? 0 : hotY > 1 ? 1 : hotY,
				strength: 1,
			});

			// Closest centre distance (RFC-004 § primary selection). Tie-break:
			// ZIndex desc, then entity id asc for determinism.
			const ccx = ct.x + ct.width / 2;
			const ccy = ct.y + ct.height / 2;
			const d = Math.hypot(ccx - dCenterX, ccy - dCenterY);
			const z = world.getComponent(c, ZIndex)?.value ?? 0;
			if (
				d < bestDist ||
				(d === bestDist && z > bestZ) ||
				(d === bestDist && z === bestZ && c < bestId)
			) {
				bestDist = d;
				bestZ = z;
				bestId = c;
				primary = c;
			}
		}

		overlapCandidates = next;

		// Reconcile OverlapTarget based on primary + contract match.
		const match = primary !== null && contractsMatch(draggedId, primary);
		const nextTarget = match ? primary : null;
		if (nextTarget !== overlapTarget) {
			if (overlapTarget !== null) world.removeTag(overlapTarget, OverlapTarget);
			if (nextTarget !== null) world.addTag(nextTarget, OverlapTarget);
			overlapTarget = nextTarget;
		}
	}

	/**
	 * RFC-004 § Phase 3 — tear down all overlap state. Called on drag
	 * end (commit / cancel) and when the dragged entity stops being a
	 * Card (e.g. a non-card entity enters the drag state machine).
	 */
	function clearOverlapState(): void {
		for (const c of overlapCandidates) {
			world.removeTag(c, OverlapCandidate);
			world.removeComponent(c, CardOverlapHotPoint);
		}
		if (overlapTarget !== null) {
			world.removeTag(overlapTarget, OverlapTarget);
		}
		overlapCandidates = new Set();
		overlapTarget = null;
	}

	/**
	 * RFC-004 § Phase 4 — fly-back completion poll. Called by the engine's
	 * frame runner after `scheduler.execute(world)` each tick. The tween
	 * system runs first, interpolates `Transform2D` toward the starting
	 * position, and auto-removes its `TransformTween` component on
	 * completion. When we see the tween component gone from the primary
	 * flying-back entity, the animation is done: remove `Dragging`,
	 * restore `ZIndex`, transition to idle.
	 */
	function runFlyBackSystem(): void {
		if (inputState.mode !== 'flyingBack') return;

		// If the primary entity was destroyed mid-animation (external
		// destroyEntity call), we can't query its tween component — bail
		// to idle with best-effort cleanup of whatever siblings survive.
		const primaryAlive = world.entityExists(inputState.entityId);

		// Still animating — the primary's tween is live.
		if (primaryAlive && world.hasComponent(inputState.entityId, TransformTween)) return;

		for (const e of inputState.startPositions.keys()) {
			if (!world.entityExists(e)) continue;
			if (world.hasTag(e, Dragging)) world.removeTag(e, Dragging);
		}
		for (const [entity, originalZ] of inputState.originalZIndices) {
			if (!world.entityExists(entity)) continue;
			world.setComponent(entity, ZIndex, { value: originalZ });
		}
		inputState = { mode: 'idle' };
		markDirty();
	}

	/**
	 * Derive the root-container cursor from input state + hover.
	 * Writes to CursorResource. Called from the frame runner after systems.
	 */
	function runCursorSystem(): void {
		let cursor: CSSCursor = 'default';

		switch (inputState.mode) {
			case 'idle':
			case 'marquee': {
				// RFC-005: resize hover wins over widget-body hover so the
				// directional cursor is visible at the handle hotspots.
				if (hoveredHandle !== null) {
					cursor = cursorForHandle(hoveredHandle);
				} else if (hoveredEntity !== null) {
					cursor = world.getComponent(hoveredEntity, CursorHint)?.hover ?? 'default';
				}
				break;
			}
			case 'tracking': {
				cursor = world.getComponent(inputState.entityId, CursorHint)?.hover ?? 'default';
				break;
			}
			case 'dragging': {
				cursor = world.getComponent(inputState.entityId, CursorHint)?.active ?? 'grabbing';
				break;
			}
			case 'resizing': {
				cursor = cursorForHandle(inputState.handle);
				break;
			}
		}

		world.setResource(CursorResource, { cursor });
	}

	function handlePointerDown(
		screenX: number,
		screenY: number,
		_button: number,
		modifiers: Modifiers,
	): PointerDirective {
		// RFC-004 § Phase 4 — fly-back interruption. If a pointerdown
		// lands on (or near) the flying entity, cancel the tween and
		// resume dragging from the CURRENT animated position. Keep
		// Dragging / ZIndex / layer in place to avoid visual flicker.
		if (inputState.mode === 'flyingBack') {
			const hit = hitTest(screenX, screenY);
			const target = hit?.entityId === inputState.entityId ? hit.entityId : null;
			if (target !== null) {
				world.removeComponent(target, TransformTween);
				// Re-snapshot start positions from the current (animated)
				// position so a non-completing drag still flies back to
				// where the user grabbed it, not the original pre-drag spot.
				const newStartPositions = new Map<EntityId, { x: number; y: number }>();
				for (const e of inputState.startPositions.keys()) {
					const cur = world.getComponent(e, Transform2D);
					if (cur) newStartPositions.set(e, { x: cur.x, y: cur.y });
					// Ensure any sibling tweens are cancelled too.
					if (world.hasComponent(e, TransformTween)) world.removeComponent(e, TransformTween);
				}
				commandBuffer.beginGroup();
				inputState = {
					mode: 'dragging',
					entityId: target,
					startScreenX: screenX,
					startScreenY: screenY,
					startPositions: newStartPositions,
					originalZIndices: inputState.originalZIndices,
				};
				markDirty();
				return { action: 'capture-drag' };
			}
			// Pointer-down missed the flying entity — let the fly-back
			// continue and fall through to the normal hit-test path.
		}

		const hit = hitTest(screenX, screenY);

		if (!hit) {
			clearSelection();
			inputState = { mode: 'marquee', startX: screenX, startY: screenY };
			markDirty();
			return { action: 'capture-marquee' };
		}

		switch (hit.role.role.type) {
			case 'resize': {
				// RFC-005: the inline resize hit returns the widget directly;
				// no handle sub-entity to dereference.
				const t = world.getComponent(hit.entityId, Transform2D);
				if (!t) return { action: 'passthrough' };
				commandBuffer.beginGroup();
				inputState = {
					mode: 'resizing',
					entityId: hit.entityId,
					handle: hit.role.role.handle,
					startX: screenX,
					startY: screenY,
					startBounds: { x: t.x, y: t.y, width: t.width, height: t.height },
				};
				markDirty();
				return { action: 'capture-resize', handle: hit.role.role.handle };
			}

			case 'drag': {
				selectEntity(hit.entityId, modifiers.shift);
				if (world.hasTag(hit.entityId, Draggable)) {
					inputState = {
						mode: 'tracking',
						entityId: hit.entityId,
						startX: screenX,
						startY: screenY,
					};
				}
				markDirty();
				return { action: 'passthrough-track-drag' };
			}

			case 'select': {
				selectEntity(hit.entityId, modifiers.shift);
				markDirty();
				return { action: 'passthrough' };
			}

			default:
				return { action: 'passthrough' };
		}
	}

	function handlePointerMove(
		screenX: number,
		screenY: number,
		_modifiers: Modifiers,
	): PointerDirective {
		if (inputState.mode === 'tracking') {
			const dx = screenX - inputState.startX;
			const dy = screenY - inputState.startY;
			if (Math.abs(dx) > DEAD_ZONE_MOUSE_PX || Math.abs(dy) > DEAD_ZONE_MOUSE_PX) {
				// Fix #5: Save original z-indices, temporarily bring to top
				const originalZIndices = new Map<EntityId, number>();
				let maxZ = 0;
				for (const e of world.queryTagged(Active)) {
					const z = world.getComponent(e, ZIndex);
					if (z && z.value > maxZ) maxZ = z.value;
				}
				for (const e of world.queryTagged(Selected)) {
					const z = world.getComponent(e, ZIndex);
					originalZIndices.set(e, z?.value ?? 0);
					world.setComponent(e, ZIndex, { value: maxZ + 1 });
				}

				const startPositions = new Map<EntityId, { x: number; y: number }>();
				for (const e of world.queryTagged(Selected)) {
					const t = world.getComponent(e, Transform2D);
					if (t) startPositions.set(e, { x: t.x, y: t.y });
				}

				for (const e of startPositions.keys()) {
					world.addTag(e, Dragging);
				}

				commandBuffer.beginGroup();

				inputState = {
					mode: 'dragging',
					entityId: inputState.entityId,
					startScreenX: screenX,
					startScreenY: screenY,
					startPositions,
					originalZIndices,
				};
				markDirty();
				return { action: 'capture-drag' };
			}
			return { action: 'passthrough' };
		}

		if (inputState.mode === 'dragging') {
			const camera = world.getResource(CameraResource);
			const totalDx = (screenX - inputState.startScreenX) / camera.zoom;
			const totalDy = (screenY - inputState.startScreenY) / camera.zoom;

			// Snap math runs only when:
			//   - the engine has snap globally enabled, AND
			//   - the primary dragged entity carries `SnapSource` (the
			//     leader's geometry drives the calculation; followers in a
			//     multi-select drag inherit the same correction).
			// References are restricted to `SnapTarget` entities, so a
			// widget can serve as a snap reference without ever snapping
			// itself (the asymmetry cards rely on).
			const firstId = inputState.startPositions.keys().next().value as EntityId | undefined;
			if (ctx.getSnapEnabled() && firstId !== undefined && world.hasTag(firstId, SnapSource)) {
				const draggedIds = new Set(inputState.startPositions.keys());
				const firstStart = inputState.startPositions.get(firstId);
				const firstT = world.getComponent(firstId, Transform2D);
				if (firstT && firstStart) {
					const draggedBounds = {
						x: firstStart.x + totalDx,
						y: firstStart.y + totalDy,
						width: firstT.width,
						height: firstT.height,
					};

					// Restrict references to entities that are both `SnapTarget`
					// (opted in to participate as a reference) AND `Active`
					// (in the current navigation frame). Without the `Active`
					// filter, snap would pull in entities from other
					// containers' sub-canvases that aren't visible.
					const refs = [];
					for (const entity of world.queryTagged(SnapTarget)) {
						if (draggedIds.has(entity)) continue;
						if (!world.hasTag(entity, Active)) continue;
						const rt = world.getComponent(entity, Transform2D);
						if (rt) {
							refs.push({
								x: rt.x,
								y: rt.y,
								width: rt.width,
								height: rt.height,
							});
						}
					}

					currentSnap = computeSnapGuides(
						draggedBounds,
						refs,
						ctx.getSnapThreshold() / camera.zoom,
					);
				}
			} else {
				currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
			}

			const finalDx = totalDx + currentSnap.snapDx;
			const finalDy = totalDy + currentSnap.snapDy;
			for (const [e, start] of inputState.startPositions) {
				world.setComponent(e, Transform2D, {
					x: start.x + finalDx,
					y: start.y + finalDy,
				});
			}

			// RFC-004 § Phase 3 — update overlap state for the primary
			// dragged card. No-op for non-Card drags; cheap (O(k) with
			// k = overlapping cards, typically ≤ 5).
			updateCardOverlap(inputState.entityId);

			markDirty();
			return { action: 'capture-drag' };
		}

		if (inputState.mode === 'resizing') {
			const camera = world.getResource(CameraResource);
			const dx = (screenX - inputState.startX) / camera.zoom;
			const dy = (screenY - inputState.startY) / camera.zoom;
			const { x, y, width: w, height: h } = inputState.startBounds;
			const handle = inputState.handle;

			let newX = x;
			let newY = y;
			let newW = w;
			let newH = h;

			if (handle.includes('e')) {
				newW = Math.max(MIN_WIDGET_SIZE, w + dx);
			}
			if (handle.includes('w')) {
				const clampedW = Math.max(MIN_WIDGET_SIZE, w - dx);
				newX = x + w - clampedW;
				newW = clampedW;
			}
			if (handle.includes('s')) {
				newH = Math.max(MIN_WIDGET_SIZE, h + dy);
			}
			if (handle.includes('n')) {
				const clampedH = Math.max(MIN_WIDGET_SIZE, h - dy);
				newY = y + h - clampedH;
				newH = clampedH;
			}

			world.setComponent(inputState.entityId, Transform2D, {
				x: newX,
				y: newY,
				width: newW,
				height: newH,
			});
			markDirty();
			return { action: 'capture-resize', handle: inputState.handle };
		}

		if (inputState.mode === 'marquee') {
			return { action: 'capture-marquee' };
		}

		if (inputState.mode === 'idle') {
			const hit = hitTest(screenX, screenY);
			// RFC-005: resize hits return the widget directly, with the
			// handle position carried on the role. Cache that handle so
			// `runCursorSystem` can pick the directional cursor without
			// looking up a sub-entity `CursorHint`.
			const hoverTarget: EntityId | null = hit ? hit.entityId : null;
			const hoverHandle: ResizeHandlePos | null =
				hit?.role.role.type === 'resize' ? hit.role.role.handle : null;
			if (hoverTarget !== hoveredEntity || hoverHandle !== hoveredHandle) {
				hoveredEntity = hoverTarget;
				hoveredHandle = hoverHandle;
				markDirty();
			}
		}

		return { action: 'passthrough' };
	}

	function handlePointerUp(): PointerDirective {
		const prevState = inputState;

		if (prevState.mode === 'dragging') {
			// RFC-004 § Phase 4 decision tree:
			//   has Card + OverlapTarget  → consume
			//   has Card + overlap but no target  → fly-back
			//   otherwise                → normal move
			const draggedId = prevState.entityId;
			const draggedHasCard = world.hasComponent(draggedId, Card);
			const hadOverlap = overlapCandidates.size > 0;
			const target = overlapTarget;
			const shouldConsume = draggedHasCard && target !== null;
			const shouldFlyBack = draggedHasCard && hadOverlap && target === null;

			if (shouldFlyBack) {
				// Transition to `flyingBack` — keep Dragging / ZIndex /
				// overlay layer in place so the card remains visually on
				// top for the full animation. Kick off a `TransformTween`
				// per dragged entity from the current position back to
				// the starting position.
				const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
				for (const [e, start] of prevState.startPositions) {
					const cur = world.getComponent(e, Transform2D);
					if (!cur) continue;
					world.addComponent(e, TransformTween, {
						fromX: cur.x,
						fromY: cur.y,
						toX: start.x,
						toY: start.y,
						startMs: nowMs,
						durationMs: 250,
						easing: 'ease-out',
						kind: 'flyback',
					});
				}
				// Abandon any open command group — we're not committing a move.
				commandBuffer.endGroup();
				currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
				clearOverlapState();
				inputState = {
					mode: 'flyingBack',
					entityId: draggedId,
					startPositions: prevState.startPositions,
					originalZIndices: prevState.originalZIndices,
				};
				markDirty();
				return { action: 'passthrough' };
			}

			// Remove Dragging tag + restore ZIndex for both consume and
			// normal-move paths.
			for (const e of prevState.startPositions.keys()) {
				if (world.hasTag(e, Dragging)) world.removeTag(e, Dragging);
			}
			for (const [entity, originalZ] of prevState.originalZIndices) {
				world.setComponent(entity, ZIndex, { value: originalZ });
			}

			const entityIds = [...prevState.startPositions.keys()];
			let totalDx = 0;
			let totalDy = 0;
			let movedSomething = false;
			if (entityIds.length > 0) {
				const firstId = entityIds[0];
				const start = prevState.startPositions.get(firstId);
				const current = world.getComponent(firstId, Transform2D);
				if (current && start) {
					totalDx = current.x - start.x;
					totalDy = current.y - start.y;
					if (totalDx !== 0 || totalDy !== 0) {
						// Rewind Transform2Ds so MoveCommand's first-execute
						// `beforePositions` snapshot captures the pre-drag
						// state. Leaves the dragged entity at the pre-drag
						// position — we take the snapshot here too so
						// ConsumeCommand.undo rehydrates into the correct
						// spot even after MoveCommand is run.
						for (const [e, s] of prevState.startPositions) {
							world.setComponent(e, Transform2D, { x: s.x, y: s.y });
						}
						movedSomething = true;
					}
				}
			}

			// RFC-004 § Phase 4 — snapshot the consumed child at PRE-DRAG
			// Transform2D so undo restores the original position. Must
			// happen before MoveCommand.execute moves the entity away
			// from its start position (and certainly before ConsumeCommand
			// destroys it).
			let consumeSnapshot: EntitySnapshot | undefined;
			let consumeHandlers: ReturnType<NonNullable<typeof ctx.getWidgetInteraction>> | undefined;
			let consumeMutation: unknown;
			let shouldEmitConsume = false;
			if (shouldConsume && target !== null) {
				const parentType = world.getComponent(target, Widget)?.type ?? '';
				consumeHandlers = ctx.getWidgetInteraction?.(parentType);
				// If the parent widget type has no `onReceiveChild`, the
				// default behaviour is still to consume — contract match
				// alone is the opt-in. ConsumeCommand's destroy-on-
				// missing-applyMutation default handles "trash bin"
				// widgets without a registered handler.
				const result = consumeHandlers?.onReceiveChild?.({
					parent: target,
					child: draggedId,
					world,
				}) ?? { consume: true };
				if (result.consume) {
					consumeSnapshot = snapshotEntity(world, draggedId);
					consumeMutation = result.mutation;
					shouldEmitConsume = true;
				}
			}

			// Commit MoveCommand after the snapshot, so the snapshot
			// carries the pre-drag Transform2D.
			if (movedSomething) {
				commandBuffer.execute(new MoveCommand(entityIds, totalDx, totalDy, Transform2D), world);
			}

			if (shouldEmitConsume && target !== null && consumeSnapshot) {
				commandBuffer.execute(
					new ConsumeCommand(
						target,
						draggedId,
						consumeSnapshot,
						consumeMutation,
						consumeHandlers?.applyMutation,
						consumeHandlers?.revertMutation,
					),
					world,
				);
				// Clear Selected on the consumed child so its selection
				// overlay doesn't render over the now-invisible card that
				// has left the current nav frame. Undo restores the child
				// (and its `Active`) but leaves `Selected` cleared — a fresh
				// click re-selects. Tag isn't command-bufferable so we
				// side-effect it here rather than wrap it in a command.
				if (world.hasTag(draggedId, Selected)) {
					world.removeTag(draggedId, Selected);
					notifySelectionChanged();
				}
			}

			commandBuffer.endGroup();
			currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
			clearOverlapState();
		}

		if (prevState.mode === 'resizing') {
			const t = world.getComponent(prevState.entityId, Transform2D);
			if (t) {
				const finalBounds = { x: t.x, y: t.y, width: t.width, height: t.height };
				const sb = prevState.startBounds;
				world.setComponent(prevState.entityId, Transform2D, sb);
				commandBuffer.execute(
					new ResizeCommand(prevState.entityId, sb, finalBounds, Transform2D),
					world,
				);
			}
			commandBuffer.endGroup();
		}

		inputState = { mode: 'idle' };

		if (prevState.mode === 'dragging' || prevState.mode === 'resizing') {
			markDirty();
		}

		return { action: 'passthrough' };
	}

	function handlePointerCancel(): void {
		if (inputState.mode === 'dragging' || inputState.mode === 'resizing') {
			commandBuffer.endGroup();
		}
		if (inputState.mode === 'dragging') {
			// Clear transient Dragging state tag.
			for (const e of inputState.startPositions.keys()) {
				if (world.hasTag(e, Dragging)) world.removeTag(e, Dragging);
			}
			// Restore the z-indices that handlePointerMove elevated on drag start.
			// Without this, a mid-drag cancel (system dialog, touch interrupt) leaves
			// every participating entity permanently at maxZ+1.
			for (const [entity, originalZ] of inputState.originalZIndices) {
				world.setComponent(entity, ZIndex, { value: originalZ });
			}
			// RFC-004 § Phase 3 — drag cancelled mid-flight; drop overlap
			// state so no stale candidate glow survives.
			clearOverlapState();
		}
		if (inputState.mode === 'flyingBack') {
			// RFC-004 § Phase 4 — cancel during fly-back animation: kill
			// the tween, remove Dragging, restore original ZIndex. Without
			// this the card would stay visually elevated forever.
			for (const e of inputState.startPositions.keys()) {
				if (!world.entityExists(e)) continue;
				if (world.hasComponent(e, TransformTween)) world.removeComponent(e, TransformTween);
				if (world.hasTag(e, Dragging)) world.removeTag(e, Dragging);
			}
			for (const [entity, originalZ] of inputState.originalZIndices) {
				if (!world.entityExists(entity)) continue;
				world.setComponent(entity, ZIndex, { value: originalZ });
			}
		}
		currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
		inputState = { mode: 'idle' };
		markDirty();
	}

	return {
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		handlePointerCancel,
		runCursorSystem,
		runFlyBackSystem,
		selectEntity,
		clearSelection,
		getHoveredEntity: () => hoveredEntity,
		getSnapGuides: () => currentSnap.guides,
		getEqualSpacing: () => currentSnap.spacings,
		/**
		 * Topmost interactable entity under a screen-space point, or null
		 * if nothing's there. Same hit-test the pointer state machine
		 * uses, exposed for callers that need to resolve coords to an
		 * entity without entering the state machine — e.g. RFC-006's
		 * PointerEventBus (double-click → enterContainer) and the R3F
		 * EventRouter (which widget owns this pixel).
		 */
		pickAt: (screenX: number, screenY: number): EntityId | null =>
			hitTest(screenX, screenY)?.entityId ?? null,
	};
}
