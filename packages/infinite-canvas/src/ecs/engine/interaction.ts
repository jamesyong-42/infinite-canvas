import type { EntityId, World } from '@jamesyong42/reactive-ecs';
import type { CommandBuffer } from '../commands.js';
import { MoveCommand, ResizeCommand } from '../commands.js';
import type { CSSCursor, InteractionRoleData, ResizeHandlePos } from '../components.js';
import {
	Active,
	CursorHint,
	Draggable,
	Dragging,
	Hitbox,
	InteractionRole,
	Parent,
	Selectable,
	Selected,
	Transform2D,
	WorldBounds,
	ZIndex,
} from '../components.js';
import { DEAD_ZONE_MOUSE_PX, MIN_WIDGET_SIZE } from '../interaction-constants.js';
import { screenToWorld } from '../math.js';
import { CameraResource, CursorResource } from '../resources.js';
import type { SpatialIndex } from '../spatial/SpatialIndex.js';
import type { SnapResult } from '../spatial/snap.js';
import { computeSnapGuides } from '../spatial/snap.js';
import type { Modifiers, PointerDirective } from './types.js';

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
			handleEntityId: EntityId;
			handle: ResizeHandlePos;
			startX: number;
			startY: number;
			startBounds: { x: number; y: number; width: number; height: number };
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
	let currentSnap: SnapResult = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };

	function hitTest(
		screenX: number,
		screenY: number,
	): { entityId: EntityId; role: InteractionRoleData } | null {
		const camera = world.getResource(CameraResource);
		const worldPos = screenToWorld(screenX, screenY, camera);

		// Zero-tolerance point query: RBush returns only entries whose AABB
		// strictly contains the point, so no secondary pointInAABB check is
		// needed. Generous hit slop lives in Hitbox size, not in tolerance.
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
	 * Derive the root-container cursor from input state + hover.
	 * Writes to CursorResource. Called from the frame runner after systems.
	 */
	function runCursorSystem(): void {
		let cursor: CSSCursor = 'default';

		switch (inputState.mode) {
			case 'idle':
			case 'marquee': {
				if (hoveredEntity !== null) {
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
				cursor = world.getComponent(inputState.handleEntityId, CursorHint)?.active ?? 'default';
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
		const hit = hitTest(screenX, screenY);

		if (!hit) {
			clearSelection();
			inputState = { mode: 'marquee', startX: screenX, startY: screenY };
			markDirty();
			return { action: 'capture-marquee' };
		}

		switch (hit.role.role.type) {
			case 'resize': {
				const parentRef = world.getComponent(hit.entityId, Parent);
				if (!parentRef) return { action: 'passthrough' };
				const parentId = parentRef.id;
				const t = world.getComponent(parentId, Transform2D);
				if (!t) return { action: 'passthrough' };
				commandBuffer.beginGroup();
				inputState = {
					mode: 'resizing',
					entityId: parentId,
					handleEntityId: hit.entityId,
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

			if (ctx.getSnapEnabled() && inputState.startPositions.size > 0) {
				const draggedIds = new Set(inputState.startPositions.keys());
				const firstId = inputState.startPositions.keys().next().value as EntityId;
				const firstStart = inputState.startPositions.get(firstId);
				const firstT = world.getComponent(firstId, Transform2D);
				if (firstT && firstStart) {
					const draggedBounds = {
						x: firstStart.x + totalDx,
						y: firstStart.y + totalDy,
						width: firstT.width,
						height: firstT.height,
					};

					// Collect reference bounds from visible entities. Skip the dragged
					// set and skip anything with a Hitbox component — Hitbox entities
					// are sub-entity interaction zones (resize handles), not snap
					// targets. Without this filter the dragged widget's own 8 handles
					// become snap refs and every axis matches trivially, producing
					// guide lines for every edge on every drag frame.
					const refs = [];
					for (const entity of world.queryTagged(Active)) {
						if (draggedIds.has(entity)) continue;
						if (world.hasComponent(entity, Hitbox)) continue;
						const wb = world.getComponent(entity, WorldBounds);
						if (wb) {
							refs.push({
								x: wb.worldX,
								y: wb.worldY,
								width: wb.worldWidth,
								height: wb.worldHeight,
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
			// RFC-001 Phase 7: use the raw hit id so cursorSystem can read
			// CursorHint from handles (e.g. 'se-resize'). Selection outline is
			// already drawn for the parent via Selected tag whenever handles
			// exist — hover-to-parent resolution would only clobber the
			// directional cursor affordance with no benefit.
			const hoverTarget: EntityId | null = hit ? hit.entityId : null;
			if (hoverTarget !== hoveredEntity) {
				hoveredEntity = hoverTarget;
				markDirty();
			}
		}

		return { action: 'passthrough' };
	}

	function handlePointerUp(): PointerDirective {
		const prevState = inputState;

		if (prevState.mode === 'dragging') {
			for (const e of prevState.startPositions.keys()) {
				if (world.hasTag(e, Dragging)) world.removeTag(e, Dragging);
			}
			// Fix #5: Restore original z-indices on drag end
			for (const [entity, originalZ] of prevState.originalZIndices) {
				world.setComponent(entity, ZIndex, { value: originalZ });
			}
			const entityIds = [...prevState.startPositions.keys()];
			if (entityIds.length > 0) {
				const firstId = entityIds[0];
				const start = prevState.startPositions.get(firstId);
				const current = world.getComponent(firstId, Transform2D);
				if (current && start) {
					const totalDx = current.x - start.x;
					const totalDy = current.y - start.y;
					if (totalDx !== 0 || totalDy !== 0) {
						for (const [e, s] of prevState.startPositions) {
							world.setComponent(e, Transform2D, { x: s.x, y: s.y });
						}
						commandBuffer.execute(new MoveCommand(entityIds, totalDx, totalDy, Transform2D), world);
					}
				}
			}
			commandBuffer.endGroup();
			currentSnap = { snapDx: 0, snapDy: 0, guides: [], spacings: [] };
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
		selectEntity,
		clearSelection,
		getHoveredEntity: () => hoveredEntity,
		getSnapGuides: () => currentSnap.guides,
		getEqualSpacing: () => currentSnap.spacings,
	};
}
