import type { EntityId } from '@jamesyong42/infinite-canvas';
import { createCardWidget } from '@jamesyong42/infinite-canvas';
import { useEffect, useState } from 'react';
import { z } from 'zod';

const schema = z.object({
	/** Override date for demo purposes. When null, widget uses today. */
	dateIso: z.string().nullable().default(null),
	nextEvent: z.string().default('Design review'),
	nextEventTime: z.string().default('3:30 PM'),
});
type CalendarData = z.infer<typeof schema>;

function useToday(override: string | null): Date {
	const [today, setToday] = useState(() => (override ? new Date(override) : new Date()));
	useEffect(() => {
		if (override) {
			setToday(new Date(override));
			return;
		}
		// Re-check every minute to roll over at midnight.
		const id = window.setInterval(() => setToday(new Date()), 60_000);
		return () => window.clearInterval(id);
	}, [override]);
	return today;
}

function CalendarRender({ data }: { entityId: EntityId; data: CalendarData }) {
	const today = useToday(data.dateIso);
	const weekday = today.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
	const day = today.getDate();

	return (
		<div
			className="flex h-full w-full flex-col bg-white p-3"
			style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
		>
			<div
				className="text-[12px] font-semibold uppercase tracking-wide"
				style={{ color: '#FF3B30' }}
			>
				{weekday}
			</div>
			<div
				className="font-semibold leading-none text-black tabular-nums"
				style={{ fontSize: '56px', letterSpacing: '-0.04em' }}
			>
				{day}
			</div>
			<div className="mt-auto space-y-0.5">
				<div className="truncate text-[11px] font-semibold text-black">{data.nextEvent}</div>
				<div className="text-[10px] text-black/50">{data.nextEventTime}</div>
			</div>
		</div>
	);
}

export const CalendarCard = createCardWidget<CalendarData>({
	type: 'calendar-card',
	size: 'small',
	schema,
	defaultData: {
		dateIso: null,
		nextEvent: 'Design review',
		nextEventTime: '3:30 PM',
	},
	render: CalendarRender,
});
