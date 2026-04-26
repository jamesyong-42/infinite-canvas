import type { EntityId } from '@jamesyong42/infinite-canvas';
import { createCardWidget, useUpdateWidget } from '@jamesyong42/infinite-canvas';
import { useState } from 'react';
import { z } from 'zod';

// Demonstrates RFC-006 in-widget pointer interactions for DOM widgets.
// Native interactives (button, input, checkbox) auto-bypass engine
// routing. Whole-row click toggles the item — the row is a <li> not
// a <button>, so the handler explicitly stops propagation to keep the
// engine from reading the click as the start of a drag.

const itemSchema = z.object({
	id: z.string(),
	text: z.string(),
	done: z.boolean(),
});

const schema = z.object({
	title: z.string().default('Today'),
	items: z.array(itemSchema).default([
		{ id: '1', text: 'Ship RFC-006', done: true },
		{ id: '2', text: 'Audit pointer router', done: true },
		{ id: '3', text: 'Test in playground', done: false },
		{ id: '4', text: 'Document author contract', done: false },
	]),
});
type TodoListData = z.infer<typeof schema>;

function TodoListRender({ entityId, data }: { entityId: EntityId; data: TodoListData }) {
	const updateData = useUpdateWidget(entityId);
	const [draft, setDraft] = useState('');

	const toggle = (id: string) =>
		updateData({
			items: data.items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)),
		});

	const remove = (id: string) => updateData({ items: data.items.filter((it) => it.id !== id) });

	const add = () => {
		const text = draft.trim();
		if (!text) return;
		setDraft('');
		updateData({
			items: [...data.items, { id: `t${Date.now().toString(36)}`, text, done: false }],
		});
	};

	const remaining = data.items.filter((i) => !i.done).length;

	return (
		<div
			className="flex h-full w-full flex-col bg-black px-4 py-3"
			style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
		>
			<div className="mb-2 flex items-baseline justify-between">
				<span className="text-[15px] font-semibold text-white">{data.title}</span>
				<span className="text-[10px] uppercase tracking-wider text-white/50">{remaining} left</span>
			</div>
			<ul className="-mx-1 flex-1 overflow-auto">
				{data.items.map((item) => (
					<li
						key={item.id}
						// `<li>` is not in the bus's native-interactive list, so
						// without this stopPropagation the click would also start
						// an engine drag on the card. Demonstrates the boundary
						// idiom from RFC-006.
						onClick={(e) => {
							e.stopPropagation();
							toggle(item.id);
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.stopPropagation();
								toggle(item.id);
							}
						}}
						className="group flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-white/5"
					>
						<span
							className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
								item.done ? 'border-emerald-400 bg-emerald-400/15' : 'border-white/40'
							}`}
						>
							{item.done && <span className="block h-1.5 w-1.5 rounded-full bg-emerald-400" />}
						</span>
						<span
							className={`flex-1 truncate text-[12px] ${
								item.done ? 'text-white/40 line-through' : 'text-white'
							}`}
						>
							{item.text}
						</span>
						<button
							type="button"
							aria-label="Remove task"
							// <button> auto-bypasses engine routing via the bus's
							// native-interactive selector, so no stopPropagation
							// strictly needed — included for clarity.
							onClick={(e) => {
								e.stopPropagation();
								remove(item.id);
							}}
							className="text-[10px] text-white/40 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
						>
							✕
						</button>
					</li>
				))}
			</ul>
			<form
				className="mt-2 flex items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					add();
				}}
			>
				<input
					type="text"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					placeholder="Add a task…"
					className="flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white placeholder-white/30 outline-none focus:bg-white/10"
				/>
				<button
					type="submit"
					className="rounded bg-white/10 px-2 py-1 text-[11px] text-white hover:bg-white/20"
				>
					Add
				</button>
			</form>
		</div>
	);
}

export const TodoListCard = createCardWidget<TodoListData>({
	type: 'todo-list-card',
	size: 'large',
	schema,
	defaultData: {
		title: 'Today',
		items: [
			{ id: '1', text: 'Ship RFC-006', done: true },
			{ id: '2', text: 'Audit pointer router', done: true },
			{ id: '3', text: 'Test in playground', done: false },
			{ id: '4', text: 'Document author contract', done: false },
		],
	},
	render: TodoListRender,
	provides: ['widget'],
});
