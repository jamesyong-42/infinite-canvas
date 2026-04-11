import type { Profiler } from '../profiler.js';
import type { SystemDef, World } from './types.js';

/**
 * Manages system registration and ordered execution.
 * Systems declare after/before constraints and are topologically sorted.
 */
export class SystemScheduler {
	private systems: SystemDef[] = [];
	private sorted: SystemDef[] | null = null;
	profiler: Profiler | null = null;

	register(system: SystemDef) {
		// Replace if system with same name exists
		this.systems = this.systems.filter((s) => s.name !== system.name);
		this.systems.push(system);
		this.sorted = null; // invalidate sort
	}

	remove(name: string) {
		this.systems = this.systems.filter((s) => s.name !== name);
		this.sorted = null;
	}

	/**
	 * Execute all systems in dependency order.
	 */
	execute(world: World) {
		if (!this.sorted) {
			this.sorted = this.topoSort();
		}
		const p = this.profiler;
		for (const system of this.sorted) {
			if (p) p.beginSystem(system.name);
			system.execute(world);
			if (p) p.endSystem(system.name);
		}
	}

	getSystemNames(): string[] {
		if (!this.sorted) {
			this.sorted = this.topoSort();
		}
		return this.sorted.map((s) => s.name);
	}

	/**
	 * Topological sort based on after/before constraints.
	 * Falls back to registration order for unconstrained systems.
	 */
	private topoSort(): SystemDef[] {
		const byName = new Map<string, SystemDef>();
		for (const s of this.systems) {
			byName.set(s.name, s);
		}

		// Build adjacency list: edges[a] = [b] means a must run before b
		const edges = new Map<string, Set<string>>();
		const inDegree = new Map<string, number>();

		for (const s of this.systems) {
			if (!edges.has(s.name)) edges.set(s.name, new Set());
			if (!inDegree.has(s.name)) inDegree.set(s.name, 0);
		}

		for (const s of this.systems) {
			const afters = Array.isArray(s.after) ? s.after : s.after ? [s.after] : [];
			for (const dep of afters) {
				// dep must run before s
				if (byName.has(dep)) {
					if (!edges.has(dep)) edges.set(dep, new Set());
					const depEdges = edges.get(dep);
					if (depEdges) depEdges.add(s.name);
					inDegree.set(s.name, (inDegree.get(s.name) || 0) + 1);
				}
			}

			const befores = Array.isArray(s.before) ? s.before : s.before ? [s.before] : [];
			for (const dep of befores) {
				// s must run before dep
				if (byName.has(dep)) {
					if (!edges.has(s.name)) edges.set(s.name, new Set());
					const systemEdges = edges.get(s.name);
					if (systemEdges) systemEdges.add(dep);
					inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
				}
			}
		}

		// Kahn's algorithm — stable sort (preserves registration order for ties)
		const queue: string[] = [];
		const registrationOrder = new Map<string, number>();
		for (let i = 0; i < this.systems.length; i++) {
			registrationOrder.set(this.systems[i].name, i);
		}

		for (const s of this.systems) {
			if ((inDegree.get(s.name) || 0) === 0) {
				queue.push(s.name);
			}
		}
		// Sort queue by registration order for stability
		queue.sort((a, b) => (registrationOrder.get(a) || 0) - (registrationOrder.get(b) || 0));

		const result: SystemDef[] = [];
		while (queue.length > 0) {
			const name = queue.shift();
			if (!name) continue;
			const system = byName.get(name);
			if (system) result.push(system);

			const neighbors = edges.get(name) || new Set();
			const newReady: string[] = [];
			for (const neighbor of neighbors) {
				const deg = (inDegree.get(neighbor) || 0) - 1;
				inDegree.set(neighbor, deg);
				if (deg === 0) {
					newReady.push(neighbor);
				}
			}
			// Sort newly ready by registration order
			newReady.sort((a, b) => (registrationOrder.get(a) || 0) - (registrationOrder.get(b) || 0));
			queue.push(...newReady);
		}

		if (result.length !== this.systems.length) {
			const missing = this.systems
				.filter((s) => !result.find((r) => r.name === s.name))
				.map((s) => s.name);
			throw new Error(`Circular system dependency detected involving: ${missing.join(', ')}`);
		}

		return result;
	}
}
