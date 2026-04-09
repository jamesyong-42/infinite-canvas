import type { ComponentType, EntityId, World } from './ecs/index.js';

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
		return this.undoStack.length > 0 || (this.currentGroup !== null && this.currentGroup.length > 0);
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.currentGroup = null;
	}

	get undoSize(): number { return this.undoStack.length; }
	get redoSize(): number { return this.redoStack.length; }
}

// === Built-in Commands ===

export class MoveCommand implements Command {
	constructor(
		private entityIds: EntityId[],
		private dx: number,
		private dy: number,
		private transformType: ComponentType<{ x: number; y: number }>,
	) {}

	execute(world: World) {
		for (const id of this.entityIds) {
			const t = world.getComponent(id, this.transformType);
			if (t) {
				world.setComponent(id, this.transformType, { x: t.x + this.dx, y: t.y + this.dy });
			}
		}
	}

	undo(world: World) {
		for (const id of this.entityIds) {
			const t = world.getComponent(id, this.transformType);
			if (t) {
				world.setComponent(id, this.transformType, { x: t.x - this.dx, y: t.y - this.dy });
			}
		}
	}
}

export class ResizeCommand implements Command {
	static readonly MIN_SIZE = 20;

	constructor(
		private entityId: EntityId,
		private before: { x: number; y: number; width: number; height: number },
		private after: { x: number; y: number; width: number; height: number },
		private transformType: ComponentType<{ x: number; y: number; width: number; height: number }>,
	) {
		// Enforce min-size so redo always produces valid bounds
		this.after = {
			...after,
			width: Math.max(ResizeCommand.MIN_SIZE, after.width),
			height: Math.max(ResizeCommand.MIN_SIZE, after.height),
		};
	}

	execute(world: World) {
		world.setComponent(this.entityId, this.transformType, this.after);
	}

	undo(world: World) {
		world.setComponent(this.entityId, this.transformType, this.before);
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
