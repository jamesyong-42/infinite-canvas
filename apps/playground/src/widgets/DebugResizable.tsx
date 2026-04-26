import type { Archetype, DomWidget, EntityId } from '@jamesyong42/infinite-canvas';
import { Transform2D, useComponent } from '@jamesyong42/infinite-canvas';
import { z } from 'zod';

/**
 * DebugResizable — a bare DOM widget with freeform resize enabled, used to
 * regression-test the resize pipeline. Not a card (no `Card` component, so
 * `cardSystem`'s preset-size snapping doesn't fight the resize), no chrome,
 * no lift. Pure resize surface so each of the 8 handle positions can be
 * exercised and the reported size is visible.
 *
 * Added for RFC-005 Phase 1 verification. The existing `SettingsPanel`
 * Resizable toggle also works for flipping resize on regular widgets.
 */

const schema = z.object({});
export type DebugResizableData = z.infer<typeof schema>;

function DebugResizableView({ entityId }: { entityId: EntityId }) {
	const t = useComponent(entityId, Transform2D);
	return (
		<div
			className="relative h-full w-full select-none"
			style={{
				background:
					'repeating-linear-gradient(45deg, #2a2a3a 0, #2a2a3a 10px, #1f1f2a 10px, #1f1f2a 20px)',
				color: '#fff',
				fontFamily: 'system-ui, -apple-system, sans-serif',
				fontSize: 12,
				border: '1px solid #4a4a6a',
				boxSizing: 'border-box',
			}}
		>
			<div className="absolute inset-0 grid place-items-center pointer-events-none">
				<div
					className="rounded px-2 py-1 tabular-nums"
					style={{ background: '#000a', border: '1px solid #556' }}
				>
					{t ? `${Math.round(t.width)} × ${Math.round(t.height)}` : 'resizable'}
				</div>
			</div>
		</div>
	);
}

export const DebugResizable: {
	widget: DomWidget<DebugResizableData>;
	archetype: Archetype;
} = {
	widget: {
		type: 'debug-resizable',
		schema,
		defaultData: {},
		defaultSize: { width: 240, height: 160 },
		component: DebugResizableView,
	},
	archetype: {
		id: 'debug-resizable',
		widget: 'debug-resizable',
		// `true` bundles Selectable + Draggable + Resizable + SelectionFrame.
		interactive: true,
	},
};
