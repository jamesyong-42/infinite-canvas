import type { EntityId, LayoutEngine } from '@jamesyong42/infinite-canvas';
import { NavigationStackResource, WidgetData } from '@jamesyong42/infinite-canvas';
import { useEffect, useRef, useState } from 'react';

interface NavigationBreadcrumbsProps {
	engine: LayoutEngine;
}

interface Crumb {
	/** Depth index in the navigation stack. 0 = root. */
	depth: number;
	/** containerId for this frame, or null for the root frame. */
	containerId: EntityId | null;
	/** Display label — container title, entity id fallback, or "Root". */
	label: string;
}

/**
 * Reads the current nav stack from the engine and builds a Crumb[] array.
 * Kept cheap — called once per engine frame tick.
 */
function readCrumbs(engine: LayoutEngine): Crumb[] {
	const frames = engine.world.getResource(NavigationStackResource).frames;
	return frames.map((frame, depth) => {
		if (frame.containerId === null) {
			return { depth, containerId: null, label: 'Root' };
		}
		const data = engine.get(frame.containerId, WidgetData);
		const title = (data?.data as { title?: unknown } | undefined)?.title;
		return {
			depth,
			containerId: frame.containerId,
			label: typeof title === 'string' && title.length > 0 ? title : `#${frame.containerId}`,
		};
	});
}

/**
 * Compare two crumb arrays structurally. Used to suppress setState when the
 * nav stack didn't meaningfully change tick-to-tick.
 */
function crumbsEqual(a: Crumb[], b: Crumb[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].containerId !== b[i].containerId || a[i].label !== b[i].label) return false;
	}
	return true;
}

export function NavigationBreadcrumbs({ engine }: NavigationBreadcrumbsProps) {
	const [crumbs, setCrumbs] = useState<Crumb[]>(() => readCrumbs(engine));
	const lastCrumbsRef = useRef<Crumb[]>(crumbs);

	// Re-read on every engine frame, setState only if the nav stack actually
	// changed (same pattern as other panel subscriptions).
	useEffect(() => {
		const unsubscribe = engine.onFrame(() => {
			const next = readCrumbs(engine);
			if (!crumbsEqual(lastCrumbsRef.current, next)) {
				lastCrumbsRef.current = next;
				setCrumbs(next);
			}
		});
		return unsubscribe;
	}, [engine]);

	const canGoBack = crumbs.length > 1;

	const goBack = () => {
		if (!canGoBack) return;
		engine.exitContainer();
		engine.markDirty();
	};

	const jumpToDepth = (targetDepth: number) => {
		const currentDepth = crumbs.length - 1;
		if (targetDepth >= currentDepth) return;
		// The engine only exposes exitContainer (pop one). Loop until we reach
		// the target depth. Cheap — the stack is typically shallow.
		const steps = currentDepth - targetDepth;
		for (let i = 0; i < steps; i++) {
			engine.exitContainer();
		}
		engine.markDirty();
	};

	return (
		<div className="absolute top-4 left-4 z-50 flex items-center gap-2">
			{/* Back button */}
			<button
				type="button"
				onClick={goBack}
				disabled={!canGoBack}
				className="flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 dark:disabled:hover:bg-neutral-800 dark:disabled:hover:text-neutral-400"
				title={canGoBack ? 'Back (Esc)' : 'Already at root'}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>Back</title>
					<path d="m15 18-6-6 6-6" />
				</svg>
			</button>

			{/* Breadcrumb pill */}
			<nav
				aria-label="Navigation breadcrumbs"
				className="flex items-center gap-1 rounded-full bg-white px-3 py-2 shadow-lg text-[12px] font-medium dark:bg-neutral-800"
			>
				{crumbs.map((crumb, i) => {
					const isCurrent = i === crumbs.length - 1;
					const isClickable = !isCurrent;
					return (
						<div
							key={`${crumb.depth}-${crumb.containerId ?? 'root'}`}
							className="flex items-center"
						>
							{i > 0 && (
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="mx-0.5 text-neutral-300 dark:text-neutral-600"
									aria-hidden="true"
								>
									<title>Separator</title>
									<path d="m9 18 6-6-6-6" />
								</svg>
							)}
							{isClickable ? (
								<button
									type="button"
									onClick={() => jumpToDepth(crumb.depth)}
									className="max-w-[160px] truncate rounded px-1.5 py-0.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
									title={`Jump to ${crumb.label}`}
								>
									{crumb.label}
								</button>
							) : (
								<span
									className="max-w-[160px] truncate rounded px-1.5 py-0.5 text-neutral-800 dark:text-neutral-100"
									aria-current="page"
								>
									{crumb.label}
								</span>
							)}
						</div>
					);
				})}
			</nav>
		</div>
	);
}
