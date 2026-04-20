import type { ComponentType, EntityId, TagType } from '@jamesyong42/reactive-ecs';
import { useEffect, useMemo, useState } from 'react';
import { Selected, Widget, WidgetData } from '../../components.js';
import type { LayoutEngine } from '../../engine.js';
import { EngineProvider, useLayoutEngine } from '../context.js';
import {
	useAllEntities,
	useComponent,
	useEntityComponents,
	useEntityTags,
	useRegisteredComponents,
	useRegisteredTags,
	useTaggedEntities,
} from '../hooks.js';

interface EcsDevtoolsProps {
	/**
	 * Engine to inspect. If omitted, reads from the nearest InfiniteCanvas context —
	 * supply this prop when the panel is rendered outside the `<InfiniteCanvas>` subtree.
	 */
	engine?: LayoutEngine;
	onClose?: () => void;
}

/**
 * Live ECS editor: spawn widgets, browse entities, edit components, toggle tags.
 * Ship in a dev mode or behind a feature flag — not intended for production users.
 */
export function EcsDevtools({ engine, onClose }: EcsDevtoolsProps) {
	if (engine) {
		return (
			<EngineProvider value={engine}>
				<EcsDevtoolsInner onClose={onClose} />
			</EngineProvider>
		);
	}
	return <EcsDevtoolsInner onClose={onClose} />;
}

function EcsDevtoolsInner({ onClose }: { onClose?: () => void }) {
	const engine = useLayoutEngine();
	const allEntities = useAllEntities();
	const selectedIds = useTaggedEntities(Selected);
	const widgets = useMemo(() => engine.getWidgets(), [engine]);

	const [showAll, setShowAll] = useState(false);
	const [spawnType, setSpawnType] = useState(widgets[0]?.type ?? '');
	const [manualFocusId, setManualFocusId] = useState<EntityId | null>(null);

	const focusId = selectedIds[0] ?? manualFocusId;

	const entityList = useMemo(() => {
		if (showAll) return allEntities;
		return allEntities.filter((id) => engine.has(id, Widget));
	}, [engine, allEntities, showAll]);

	const handleSpawn = () => {
		if (!spawnType) return;
		const id = engine.spawnAtCameraCenter(spawnType);
		engine.markDirty();
		setManualFocusId(id);
	};

	return (
		<div className="ic-ecs-root">
			<StyleTag />

			<div className="ic-ecs-header">
				<span className="ic-ecs-title">ECS Editor</span>
				{onClose && (
					<button type="button" className="ic-ecs-close" onClick={onClose} title="Close">
						×
					</button>
				)}
			</div>

			<div className="ic-ecs-section">
				<div className="ic-ecs-label">Spawn widget</div>
				<div className="ic-ecs-row">
					<select
						className="ic-ecs-select"
						value={spawnType}
						onChange={(e) => setSpawnType(e.target.value)}
					>
						{widgets.map((w) => (
							<option key={w.type} value={w.type}>
								{w.type}
							</option>
						))}
					</select>
					<button
						type="button"
						className="ic-ecs-btn ic-ecs-btn-primary"
						onClick={handleSpawn}
						disabled={!spawnType}
					>
						+ Spawn
					</button>
				</div>
			</div>

			<div className="ic-ecs-section">
				<div className="ic-ecs-label-row">
					<span className="ic-ecs-label">
						Entities ({entityList.length}
						{showAll ? '' : ' widgets'})
					</span>
					<label className="ic-ecs-check">
						<input
							type="checkbox"
							checked={showAll}
							onChange={(e) => setShowAll(e.target.checked)}
						/>
						show all
					</label>
				</div>
				<div className="ic-ecs-list">
					{entityList.map((id) => (
						<EntityRow
							key={id}
							entity={id}
							focused={id === focusId}
							onClick={() => setManualFocusId(id)}
						/>
					))}
					{entityList.length === 0 && <div className="ic-ecs-empty">no entities</div>}
				</div>
			</div>

			{focusId !== null && focusId !== undefined && engine.world.entityExists(focusId) && (
				<EntityInspector entity={focusId} />
			)}
		</div>
	);
}

function EntityRow({
	entity,
	focused,
	onClick,
}: {
	entity: EntityId;
	focused: boolean;
	onClick: () => void;
}) {
	const engine = useLayoutEngine();
	const widget = useComponent(entity, Widget);
	const label = widget?.type ?? 'entity';

	return (
		<div className={`ic-ecs-entity-row ${focused ? 'is-focused' : ''}`}>
			<button type="button" className="ic-ecs-entity-btn" onClick={onClick}>
				<span className="ic-ecs-entity-id">e{entity}</span>
				<span className="ic-ecs-entity-label">{label}</span>
			</button>
			<button
				type="button"
				className="ic-ecs-btn ic-ecs-btn-danger ic-ecs-btn-sm"
				onClick={() => {
					engine.destroyEntity(entity);
					engine.markDirty();
				}}
				title="Destroy entity"
			>
				×
			</button>
		</div>
	);
}

function EntityInspector({ entity }: { entity: EntityId }) {
	const engine = useLayoutEngine();
	const components = useEntityComponents(entity);
	const tags = useEntityTags(entity);
	const registeredComponents = useRegisteredComponents();
	const registeredTags = useRegisteredTags();
	const widget = useComponent(entity, Widget);

	const absentComponents = useMemo(() => {
		const present = new Set(components.map((c) => c.name));
		return registeredComponents.filter((c) => !present.has(c.name));
	}, [components, registeredComponents]);

	const [componentToAdd, setComponentToAdd] = useState('');
	useEffect(() => {
		setComponentToAdd(absentComponents[0]?.name ?? '');
	}, [absentComponents]);

	const handleAddComponent = () => {
		const type = absentComponents.find((c) => c.name === componentToAdd);
		if (!type) return;
		engine.addComponent(entity, type);
	};

	return (
		<div className="ic-ecs-section">
			<div className="ic-ecs-inspect-head">
				<span className="ic-ecs-label">
					Entity <span className="ic-ecs-entity-id">e{entity}</span>
					{widget?.type && <span className="ic-ecs-entity-label"> · {widget.type}</span>}
				</span>
			</div>

			<div className="ic-ecs-sub-label">Components</div>
			<div className="ic-ecs-components">
				{components.map((type) => (
					<ComponentEditor key={type.name} entity={entity} type={type} />
				))}
			</div>

			{absentComponents.length > 0 && (
				<div className="ic-ecs-row" style={{ marginTop: 6 }}>
					<select
						className="ic-ecs-select"
						value={componentToAdd}
						onChange={(e) => setComponentToAdd(e.target.value)}
					>
						{absentComponents.map((c) => (
							<option key={c.name} value={c.name}>
								{c.name}
							</option>
						))}
					</select>
					<button type="button" className="ic-ecs-btn" onClick={handleAddComponent}>
						+ Add component
					</button>
				</div>
			)}

			<div className="ic-ecs-sub-label">Tags</div>
			<div className="ic-ecs-tags">
				{registeredTags.map((type) => (
					<TagPill
						key={type.name}
						entity={entity}
						type={type}
						active={tags.some((t) => t.name === type.name)}
					/>
				))}
			</div>
		</div>
	);
}

function ComponentEditor({ entity, type }: { entity: EntityId; type: ComponentType }) {
	const engine = useLayoutEngine();
	const value = useComponent(entity, type);
	const [collapsed, setCollapsed] = useState(false);

	if (!value) return null;

	const isWidgetData = type.name === 'WidgetData';

	return (
		<div className="ic-ecs-component">
			<div className="ic-ecs-component-head">
				<button type="button" className="ic-ecs-toggle" onClick={() => setCollapsed((c) => !c)}>
					{collapsed ? '▶' : '▼'} {type.name}
				</button>
				<button
					type="button"
					className="ic-ecs-btn ic-ecs-btn-danger ic-ecs-btn-sm"
					onClick={() => engine.removeComponent(entity, type)}
					title="Remove component"
				>
					×
				</button>
			</div>
			{!collapsed && (
				<div className="ic-ecs-fields">
					{isWidgetData ? (
						<WidgetDataEditor entity={entity} value={value as { data: Record<string, unknown> }} />
					) : (
						<GenericFieldsEditor entity={entity} type={type} value={value} />
					)}
				</div>
			)}
		</div>
	);
}

function GenericFieldsEditor<T>({
	entity,
	type,
	value,
}: {
	entity: EntityId;
	type: ComponentType<T>;
	value: T;
}) {
	const engine = useLayoutEngine();
	const defaults = type.defaults as Record<string, unknown>;
	const val = value as Record<string, unknown>;
	const keys = Object.keys(defaults);

	return (
		<>
			{keys.map((key) => (
				<FieldRow
					key={key}
					label={key}
					value={val[key]}
					onChange={(next) => {
						engine.set(entity, type, { [key]: next } as Partial<T>);
					}}
				/>
			))}
		</>
	);
}

function WidgetDataEditor({
	entity,
	value,
}: {
	entity: EntityId;
	value: { data: Record<string, unknown> };
}) {
	const engine = useLayoutEngine();
	const data = value.data ?? {};
	const keys = Object.keys(data);

	if (keys.length === 0) {
		return <div className="ic-ecs-empty">(no fields)</div>;
	}

	return (
		<>
			{keys.map((key) => (
				<FieldRow
					key={key}
					label={key}
					value={data[key]}
					onChange={(next) => {
						engine.set(entity, WidgetData, { data: { ...data, [key]: next } });
					}}
				/>
			))}
		</>
	);
}

function FieldRow({
	label,
	value,
	onChange,
}: {
	label: string;
	value: unknown;
	onChange: (next: unknown) => void;
}) {
	return (
		<div className="ic-ecs-field">
			<span className="ic-ecs-field-label">{label}</span>
			<FieldInput value={value} onChange={onChange} />
		</div>
	);
}

function FieldInput({ value, onChange }: { value: unknown; onChange: (next: unknown) => void }) {
	if (typeof value === 'number') {
		return (
			<input
				type="number"
				className="ic-ecs-input"
				value={value}
				onChange={(e) => {
					const n = Number.parseFloat(e.target.value);
					if (!Number.isNaN(n)) onChange(n);
				}}
			/>
		);
	}
	if (typeof value === 'boolean') {
		return (
			<input
				type="checkbox"
				className="ic-ecs-checkbox"
				checked={value}
				onChange={(e) => onChange(e.target.checked)}
			/>
		);
	}
	if (typeof value === 'string') {
		return (
			<input
				type="text"
				className="ic-ecs-input"
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		);
	}
	return <JsonInput value={value} onChange={onChange} />;
}

function JsonInput({ value, onChange }: { value: unknown; onChange: (next: unknown) => void }) {
	const serialized = JSON.stringify(value);
	const [text, setText] = useState(serialized);
	const [error, setError] = useState(false);

	useEffect(() => {
		setText(JSON.stringify(value));
		setError(false);
	}, [value]);

	const commit = () => {
		try {
			const parsed = JSON.parse(text);
			setError(false);
			onChange(parsed);
		} catch {
			setError(true);
		}
	};

	return (
		<input
			type="text"
			className={`ic-ecs-input ic-ecs-input-json ${error ? 'is-error' : ''}`}
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') commit();
			}}
		/>
	);
}

function TagPill({ entity, type, active }: { entity: EntityId; type: TagType; active: boolean }) {
	const engine = useLayoutEngine();
	return (
		<button
			type="button"
			className={`ic-ecs-tag ${active ? 'is-active' : ''}`}
			onClick={() => {
				if (active) engine.removeTag(entity, type);
				else engine.addTag(entity, type);
			}}
		>
			{type.name}
		</button>
	);
}

// Scoped styles, inlined once on mount. Dark-mode-aware via prefers-color-scheme
// and a parent `.dark` class (matches the playground's toggle convention).
const STYLE_ID = 'ic-ecs-devtools-style';
const CSS = `
.ic-ecs-root {
	--ic-ecs-bg: rgba(255, 255, 255, 0.96);
	--ic-ecs-bg-elev: #f7f7f7;
	--ic-ecs-fg: #1a1a1a;
	--ic-ecs-fg-muted: #6b7280;
	--ic-ecs-fg-faint: #9ca3af;
	--ic-ecs-border: #e5e7eb;
	--ic-ecs-accent: #0d99ff;
	--ic-ecs-accent-fg: #ffffff;
	--ic-ecs-danger: #dc2626;
	--ic-ecs-focus-bg: rgba(13, 153, 255, 0.12);
	position: absolute;
	top: 4rem;
	right: 1rem;
	z-index: 50;
	width: 360px;
	max-height: calc(100vh - 6rem);
	overflow-y: auto;
	background: var(--ic-ecs-bg);
	color: var(--ic-ecs-fg);
	border: 1px solid var(--ic-ecs-border);
	border-radius: 8px;
	box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
	backdrop-filter: blur(6px);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 11px;
	line-height: 1.4;
}
.dark .ic-ecs-root,
:root[data-theme="dark"] .ic-ecs-root {
	--ic-ecs-bg: rgba(23, 23, 23, 0.96);
	--ic-ecs-bg-elev: #1f1f1f;
	--ic-ecs-fg: #e5e5e5;
	--ic-ecs-fg-muted: #a1a1aa;
	--ic-ecs-fg-faint: #525252;
	--ic-ecs-border: #2a2a2a;
	--ic-ecs-focus-bg: rgba(13, 153, 255, 0.18);
}
.ic-ecs-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	border-bottom: 1px solid var(--ic-ecs-border);
}
.ic-ecs-title {
	font-weight: 600;
	font-size: 12px;
}
.ic-ecs-close {
	background: transparent;
	border: 0;
	color: var(--ic-ecs-fg-muted);
	cursor: pointer;
	font-size: 16px;
	line-height: 1;
	padding: 0 4px;
}
.ic-ecs-close:hover { color: var(--ic-ecs-fg); }
.ic-ecs-section {
	padding: 8px 12px;
	border-bottom: 1px solid var(--ic-ecs-border);
}
.ic-ecs-section:last-child { border-bottom: 0; }
.ic-ecs-label {
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--ic-ecs-fg-muted);
}
.ic-ecs-label-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 4px;
}
.ic-ecs-sub-label {
	font-size: 9px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--ic-ecs-fg-faint);
	margin: 8px 0 4px;
}
.ic-ecs-row {
	display: flex;
	gap: 6px;
	align-items: center;
	margin-top: 4px;
}
.ic-ecs-select {
	flex: 1 1 auto;
	min-width: 0;
	background: var(--ic-ecs-bg-elev);
	color: var(--ic-ecs-fg);
	border: 1px solid var(--ic-ecs-border);
	border-radius: 4px;
	padding: 4px 6px;
	font: inherit;
}
.ic-ecs-input {
	flex: 1 1 auto;
	min-width: 0;
	background: var(--ic-ecs-bg-elev);
	color: var(--ic-ecs-fg);
	border: 1px solid var(--ic-ecs-border);
	border-radius: 4px;
	padding: 2px 6px;
	font: inherit;
}
.ic-ecs-input:focus { outline: 1px solid var(--ic-ecs-accent); outline-offset: -1px; }
.ic-ecs-input-json.is-error { border-color: var(--ic-ecs-danger); }
.ic-ecs-checkbox {
	accent-color: var(--ic-ecs-accent);
}
.ic-ecs-btn {
	background: var(--ic-ecs-bg-elev);
	color: var(--ic-ecs-fg);
	border: 1px solid var(--ic-ecs-border);
	border-radius: 4px;
	padding: 3px 8px;
	font: inherit;
	cursor: pointer;
	white-space: nowrap;
}
.ic-ecs-btn:hover { background: var(--ic-ecs-border); }
.ic-ecs-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ic-ecs-btn-primary {
	background: var(--ic-ecs-accent);
	color: var(--ic-ecs-accent-fg);
	border-color: var(--ic-ecs-accent);
}
.ic-ecs-btn-primary:hover { filter: brightness(1.08); background: var(--ic-ecs-accent); }
.ic-ecs-btn-danger { color: var(--ic-ecs-danger); }
.ic-ecs-btn-sm { padding: 0 6px; font-size: 11px; }
.ic-ecs-check {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 10px;
	color: var(--ic-ecs-fg-muted);
	cursor: pointer;
}
.ic-ecs-list {
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-height: 200px;
	overflow-y: auto;
	margin-top: 4px;
}
.ic-ecs-empty {
	color: var(--ic-ecs-fg-faint);
	font-style: italic;
	padding: 4px 0;
}
.ic-ecs-entity-row {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px;
	border-radius: 4px;
}
.ic-ecs-entity-row.is-focused { background: var(--ic-ecs-focus-bg); }
.ic-ecs-entity-btn {
	flex: 1 1 auto;
	display: flex;
	gap: 8px;
	align-items: center;
	background: transparent;
	border: 0;
	color: inherit;
	cursor: pointer;
	text-align: left;
	padding: 2px 0;
	font: inherit;
	min-width: 0;
}
.ic-ecs-entity-id {
	color: var(--ic-ecs-fg-muted);
	font-variant-numeric: tabular-nums;
}
.ic-ecs-entity-label {
	color: var(--ic-ecs-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ic-ecs-inspect-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 4px;
}
.ic-ecs-components {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.ic-ecs-component {
	border: 1px solid var(--ic-ecs-border);
	border-radius: 4px;
	background: var(--ic-ecs-bg-elev);
}
.ic-ecs-component-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 2px 6px;
}
.ic-ecs-toggle {
	background: transparent;
	border: 0;
	color: inherit;
	cursor: pointer;
	font: inherit;
	font-weight: 600;
	padding: 2px 0;
}
.ic-ecs-fields {
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 4px 6px 6px;
	border-top: 1px dashed var(--ic-ecs-border);
}
.ic-ecs-field {
	display: grid;
	grid-template-columns: 70px 1fr;
	align-items: center;
	gap: 6px;
}
.ic-ecs-field-label {
	color: var(--ic-ecs-fg-muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ic-ecs-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}
.ic-ecs-tag {
	background: transparent;
	color: var(--ic-ecs-fg-faint);
	border: 1px solid var(--ic-ecs-border);
	border-radius: 999px;
	padding: 2px 8px;
	font: inherit;
	cursor: pointer;
}
.ic-ecs-tag:hover { color: var(--ic-ecs-fg); }
.ic-ecs-tag.is-active {
	background: var(--ic-ecs-accent);
	color: var(--ic-ecs-accent-fg);
	border-color: var(--ic-ecs-accent);
}
`;

function StyleTag() {
	useEffect(() => {
		if (typeof document === 'undefined') return;
		if (document.getElementById(STYLE_ID)) return;
		const el = document.createElement('style');
		el.id = STYLE_ID;
		el.textContent = CSS;
		document.head.appendChild(el);
	}, []);
	return null;
}
