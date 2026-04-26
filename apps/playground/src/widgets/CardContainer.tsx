/* eslint-disable jsx-a11y/prefer-tag-over-role -- the widget body uses
 * `<div role="button">` rather than `<button>` because PointerEventBus
 * bypasses native button targets to keep widget-internal controls
 * clickable; a button-as-body would make the whole surface non-draggable.
 * See the inline comment on the JSX root for full rationale. */
import type { Archetype, DomWidget, EntityId, World } from '@jamesyong42/infinite-canvas';
import {
	Card,
	CardFrame,
	Container,
	ContainerChildren,
	isFrameAncestorOf,
	ParentFrame,
	useComponent,
	useLayoutEngine,
	useWidgetData,
} from '@jamesyong42/infinite-canvas';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { z } from 'zod';

const schema = z.object({
	title: z.string().default('Folder'),
	accent: z.string().default('#6366F1'),
});

type CardContainerData = z.infer<typeof schema>;

interface AdoptMutation {
	kind: 'adopt';
	parentId: EntityId;
	childId: EntityId;
	before: EntityId[];
	after: EntityId[];
}

function isAdoptMutation(m: unknown): m is AdoptMutation {
	if (!m || typeof m !== 'object') return false;
	const c = m as Partial<AdoptMutation>;
	return c.kind === 'adopt' && Array.isArray(c.before) && Array.isArray(c.after);
}

function CardContainerBody({ entityId, data }: { entityId: EntityId; data: CardContainerData }) {
	const engine = useLayoutEngine();
	const children = useComponent(entityId, ContainerChildren);
	const count = children?.ids.length ?? 0;

	const enterFolder = () => {
		engine.enterContainer(entityId);
		engine.markDirty();
	};

	const onDoubleClick = (event: ReactMouseEvent) => {
		event.stopPropagation();
		enterFolder();
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			enterFolder();
		}
	};

	// Deliberately a <div role="button">, not an actual <button>:
	// `PointerEventBus.onPointerDown` skips engine routing whenever the
	// pointer target is inside a real `<button>` (so widget-internal
	// controls stay clickable). A button-as-widget-body would make the
	// whole surface non-draggable. role + tabIndex + onKeyDown keep
	// keyboard a11y; the lint rules preferring a real <button> are
	// suppressed for this single drag-surface case.
	return (
		// biome-ignore lint/a11y/useSemanticElements: drag-surface; see file header
		<div
			role="button"
			tabIndex={0}
			onDoubleClick={onDoubleClick}
			onKeyDown={onKeyDown}
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'stretch',
				justifyContent: 'space-between',
				height: '100%',
				width: '100%',
				padding: 14,
				background: `linear-gradient(155deg, ${data.accent} 0%, #1f1f2a 85%)`,
				color: '#fff',
				fontFamily: '-apple-system, system-ui, sans-serif',
				textAlign: 'left',
			}}
			title={`Double-click to open ${data.title}`}
		>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<span
					style={{
						fontSize: 11,
						fontWeight: 600,
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
						opacity: 0.82,
					}}
				>
					Folder
				</span>
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						minWidth: 26,
						height: 20,
						padding: '0 7px',
						borderRadius: 999,
						background: 'rgba(0,0,0,0.35)',
						fontSize: 11,
						fontWeight: 700,
						fontVariantNumeric: 'tabular-nums',
					}}
				>
					{count}
				</span>
			</div>
			<div>
				<div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{data.title}</div>
				<div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
					{count === 0 ? 'Empty — drop cards in' : 'Double-click to open'}
				</div>
			</div>
		</div>
	);
}

function CardContainerView({ entityId }: { entityId: EntityId }) {
	const data = useWidgetData<CardContainerData>(entityId);
	return (
		<CardFrame entityId={entityId}>
			<CardContainerBody entityId={entityId} data={data} />
		</CardFrame>
	);
}

function appendId(ids: EntityId[], id: EntityId): EntityId[] {
	return [...ids, id];
}

function cloneIds(ids: EntityId[]): EntityId[] {
	return [...ids];
}

export const CardContainer: {
	widget: DomWidget<CardContainerData>;
	archetype: Archetype;
} = {
	widget: {
		type: 'card-container',
		schema,
		defaultData: { title: 'Folder', accent: '#6366F1' },
		defaultSize: { width: 329, height: 345 },
		component: CardContainerView,
		interaction: {
			// Cycle guard: refuse to adopt an ancestor of the current container.
			// Without this, dragging outer → inner creates a reference cycle
			// that navigationFilterSystem would loop through forever.
			canAccept: ({ parent, child, world }: { parent: EntityId; child: EntityId; world: World }) =>
				!isFrameAncestorOf(world, child, parent),

			onReceiveChild: ({
				parent,
				child,
				world,
			}: {
				parent: EntityId;
				child: EntityId;
				world: World;
			}) => {
				const current = world.getComponent(parent, ContainerChildren);
				const before = current ? cloneIds(current.ids) : [];
				return {
					consume: true,
					mutation: {
						kind: 'adopt',
						parentId: parent,
						childId: child,
						before,
						after: appendId(before, child),
					} satisfies AdoptMutation,
				};
			},

			applyMutation: (world: World, mutation: unknown) => {
				if (!isAdoptMutation(mutation)) return;
				// Guard against either side being destroyed between the
				// onReceiveChild snapshot and execute/redo — undo of a
				// consume followed by an external destroyEntity on the
				// parent (or child) and then a redo would otherwise hit
				// a dead-entity write.
				if (world.entityExists(mutation.childId)) {
					if (world.hasComponent(mutation.childId, ParentFrame)) {
						world.setComponent(mutation.childId, ParentFrame, { id: mutation.parentId });
					} else {
						world.addComponent(mutation.childId, ParentFrame, { id: mutation.parentId });
					}
				}
				if (world.entityExists(mutation.parentId)) {
					if (world.hasComponent(mutation.parentId, ContainerChildren)) {
						world.setComponent(mutation.parentId, ContainerChildren, {
							ids: cloneIds(mutation.after),
						});
					} else {
						world.addComponent(mutation.parentId, ContainerChildren, {
							ids: cloneIds(mutation.after),
						});
					}
				}
			},

			revertMutation: (world: World, mutation: unknown) => {
				if (!isAdoptMutation(mutation)) return;
				if (
					world.entityExists(mutation.childId) &&
					world.hasComponent(mutation.childId, ParentFrame)
				) {
					world.removeComponent(mutation.childId, ParentFrame);
				}
				// Always keep ContainerChildren present on the container (set
				// to an empty array when reverting the first consume) — the
				// archetype spawns the component and downstream queries rely
				// on it being present for every container entity.
				if (world.entityExists(mutation.parentId)) {
					if (world.hasComponent(mutation.parentId, ContainerChildren)) {
						world.setComponent(mutation.parentId, ContainerChildren, {
							ids: cloneIds(mutation.before),
						});
					} else {
						world.addComponent(mutation.parentId, ContainerChildren, {
							ids: cloneIds(mutation.before),
						});
					}
				}
			},
		},
	},
	archetype: {
		id: 'card-container',
		widget: 'card-container',
		components: [
			[Card, { preset: 'large', accepts: ['widget'], provides: [] }],
			[Container, { enterable: true }],
			[ContainerChildren, { ids: [] }],
		],
		interactive: {
			selectable: true,
			draggable: true,
			resizable: false,
			selectionFrame: false,
			snapSource: false,
			snapTarget: true,
		},
		defaultSize: { width: 329, height: 345 },
	},
};
