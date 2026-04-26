import type { ComponentType, EntityId, TagType, World } from '@jamesyong42/reactive-ecs';
import { MIN_WIDGET_SIZE } from './interaction-constants.js';

// === Command Interface ===

export interface Command {
	execute(world: World): void;
	undo(world: World): void;
}

// === Command Buffer with Undo/Redo ===

export class CommandBuffer {
	private undoStack: Command[][] = [];
	private redoStack: Command[][] = [];
	private currentGroup: Command[] | null = null;

	/** Start grouping commands (e.g., on pointerdown). All commands until endGroup() are one undo step. */
	beginGroup() {
		if (this.currentGroup !== null) {
			this.endGroup(); // auto-close previous group
		}
		this.currentGroup = [];
	}

	/** Execute a command and record it for undo. */
	execute(command: Command, world: World) {
		command.execute(world);

		if (this.currentGroup) {
			this.currentGroup.push(command);
		} else {
			// Single command = its own undo group
			this.undoStack.push([command]);
			this.redoStack.length = 0;
		}
	}

	/** Close the current group — all commands since beginGroup() become one undo step. */
	endGroup() {
		if (this.currentGroup && this.currentGroup.length > 0) {
			this.undoStack.push(this.currentGroup);
			this.redoStack.length = 0;
		}
		this.currentGroup = null;
	}

	/** Undo the last command group. */
	undo(world: World): boolean {
		// Close any open group first
		if (this.currentGroup) {
			this.endGroup();
		}

		const group = this.undoStack.pop();
		if (!group) return false;

		// Undo in reverse order
		for (let i = group.length - 1; i >= 0; i--) {
			group[i].undo(world);
		}
		this.redoStack.push(group);
		return true;
	}

	/** Redo the last undone command group. */
	redo(world: World): boolean {
		const group = this.redoStack.pop();
		if (!group) return false;

		for (const cmd of group) {
			cmd.execute(world);
		}
		this.undoStack.push(group);
		return true;
	}

	canUndo(): boolean {
		return (
			this.undoStack.length > 0 || (this.currentGroup !== null && this.currentGroup.length > 0)
		);
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.currentGroup = null;
	}

	get undoSize(): number {
		return this.undoStack.length;
	}
	get redoSize(): number {
		return this.redoStack.length;
	}
}

// === Built-in Commands ===

export class MoveCommand implements Command {
	private beforePositions: Map<EntityId, { x: number; y: number }> = new Map();
	private afterPositions: Map<EntityId, { x: number; y: number }> = new Map();
	private captured = false;

	constructor(
		private entityIds: EntityId[],
		private dx: number,
		private dy: number,
		private transformType: ComponentType<{ x: number; y: number }>,
	) {}

	execute(world: World) {
		if (!this.captured) {
			// First execute: snapshot before positions, compute after positions
			for (const id of this.entityIds) {
				const t = world.getComponent(id, this.transformType);
				if (t) {
					this.beforePositions.set(id, { x: t.x, y: t.y });
					this.afterPositions.set(id, { x: t.x + this.dx, y: t.y + this.dy });
				}
			}
			this.captured = true;
		}

		for (const [id, pos] of this.afterPositions) {
			world.setComponent(id, this.transformType, { x: pos.x, y: pos.y });
		}
	}

	undo(world: World) {
		for (const [id, pos] of this.beforePositions) {
			world.setComponent(id, this.transformType, { x: pos.x, y: pos.y });
		}
	}
}

export class ResizeCommand implements Command {
	constructor(
		private entityId: EntityId,
		private before: { x: number; y: number; width: number; height: number },
		private after: { x: number; y: number; width: number; height: number },
		private transformType: ComponentType<{ x: number; y: number; width: number; height: number }>,
	) {
		// Enforce min-size so redo always produces valid bounds
		this.after = {
			...after,
			width: Math.max(MIN_WIDGET_SIZE, after.width),
			height: Math.max(MIN_WIDGET_SIZE, after.height),
		};
	}

	execute(world: World) {
		world.setComponent(this.entityId, this.transformType, this.after);
	}

	undo(world: World) {
		world.setComponent(this.entityId, this.transformType, this.before);
	}
}

/**
 * Snapshot of an entity's full component + tag state, suitable for
 * reconstruction via {@link rehydrateEntity} on undo.
 */
export interface EntitySnapshot {
	entityId: EntityId;
	components: Array<{ type: ComponentType<unknown>; data: unknown }>;
	tags: TagType[];
}

/**
 * Capture an entity's complete current state. Used by `ConsumeCommand`
 * so `undo` can fully reconstitute a destroyed child. Relies on
 * `world.getComponentsOf(entity)` / `world.getTagsOf(entity)` so no
 * external type registries need to be threaded through.
 */
export function snapshotEntity(world: World, entity: EntityId): EntitySnapshot {
	const components: EntitySnapshot['components'] = [];
	for (const type of world.getComponentsOf(entity)) {
		const data = world.getComponent(entity, type);
		if (data !== undefined) {
			components.push({ type: type as ComponentType<unknown>, data: structuredClone(data) });
		}
	}
	const tags = [...world.getTagsOf(entity)];
	return { entityId: entity, components, tags };
}

/**
 * Recreate an entity's state from a snapshot. Uses the same
 * `EntityId` captured in the snapshot if the world allows
 * reassignment; otherwise creates a fresh id and returns it.
 */
export function rehydrateEntity(world: World, snapshot: EntitySnapshot): EntityId {
	const id = world.createEntity();
	for (const entry of snapshot.components) {
		world.addComponent(id, entry.type, entry.data);
	}
	for (const tag of snapshot.tags) {
		world.addTag(id, tag);
	}
	return id;
}

/**
 * Drop-to-consume command (RFC-004 § Phase 4). Undo / redo are
 * fully supported by:
 *  - capturing a full entity snapshot of the child at construction time,
 *  - delegating the forward mutation to the parent widget's
 *    `applyMutation` handler,
 *  - delegating the reverse mutation to `revertMutation`.
 *
 * Handlers are supplied at construction time (captured from the widget
 * registry in the interaction runtime's pointerup path), so the
 * command doesn't need to know about the registry shape itself.
 */
export class ConsumeCommand implements Command {
	/**
	 * The entity id we currently target for destroy. Starts as the
	 * initial `childId` captured at construction; updated to the fresh
	 * id returned by `rehydrateEntity` on undo so that a subsequent
	 * `redo()` destroys the rehydrated entity (not a stale id from a
	 * previous execute cycle).
	 */
	private currentChildId: EntityId;

	constructor(
		public readonly parentId: EntityId,
		public readonly childId: EntityId,
		public readonly childSnapshot: EntitySnapshot,
		public readonly mutation: unknown,
		private readonly applyMutation: ((world: World, mutation: unknown) => void) | undefined,
		private readonly revertMutation: ((world: World, mutation: unknown) => void) | undefined,
	) {
		this.currentChildId = childId;
	}

	execute(world: World) {
		this.applyMutation?.(world, this.mutation);
		// No author-supplied mutation → default behaviour: destroy the
		// child. Simple "trash bin" widgets can rely on this without
		// writing a custom handler. Widgets that re-parent instead
		// (containers) implement `applyMutation` and must NOT destroy
		// the child inside it.
		if (this.applyMutation === undefined && world.entityExists(this.currentChildId)) {
			world.destroyEntity(this.currentChildId);
		}
	}

	undo(world: World) {
		this.revertMutation?.(world, this.mutation);
		if (!world.entityExists(this.currentChildId)) {
			this.currentChildId = rehydrateEntity(world, this.childSnapshot);
		}
	}
}

export class SetComponentCommand<T> implements Command {
	constructor(
		private entityId: EntityId,
		private type: ComponentType<T>,
		private before: Partial<T>,
		private after: Partial<T>,
	) {}

	execute(world: World) {
		world.setComponent(this.entityId, this.type, this.after);
	}

	undo(world: World) {
		world.setComponent(this.entityId, this.type, this.before);
	}
}
