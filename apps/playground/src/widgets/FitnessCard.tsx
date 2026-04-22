import type { EntityId } from '@jamesyong42/infinite-canvas';
import { createCardWidget } from '@jamesyong42/infinite-canvas';
import { z } from 'zod';

const schema = z.object({
	move: z.object({ current: z.number(), goal: z.number() }).default({
		current: 420,
		goal: 520,
	}),
	exercise: z.object({ current: z.number(), goal: z.number() }).default({
		current: 22,
		goal: 30,
	}),
	stand: z.object({ current: z.number(), goal: z.number() }).default({
		current: 9,
		goal: 12,
	}),
});
type FitnessData = z.infer<typeof schema>;

function Ring({ r, pct, color, bg }: { r: number; pct: number; color: string; bg: string }) {
	const circumference = 2 * Math.PI * r;
	// Allow overshoot up to 2x (visually clamped to full revolution).
	const frac = Math.max(0, Math.min(pct, 1));
	const dash = frac * circumference;
	return (
		<g>
			<circle r={r} fill="none" stroke={bg} strokeWidth={14} />
			<circle
				r={r}
				fill="none"
				stroke={color}
				strokeWidth={14}
				strokeLinecap="round"
				strokeDasharray={`${dash} ${circumference}`}
				transform="rotate(-90)"
				style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.2,0.8,0.2,1)' }}
			/>
		</g>
	);
}

function Stat({
	label,
	value,
	goal,
	unit,
	color,
}: {
	label: string;
	value: number;
	goal: number;
	unit: string;
	color: string;
}) {
	return (
		<div className="flex-1">
			<div className="flex items-baseline gap-1.5">
				<span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
				<span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
					{label}
				</span>
			</div>
			<div className="mt-0.5 flex items-baseline gap-1">
				<span className="text-[22px] font-semibold leading-none tabular-nums" style={{ color }}>
					{value}
				</span>
				<span className="text-[11px] text-white/40 tabular-nums">
					/ {goal} {unit}
				</span>
			</div>
		</div>
	);
}

function FitnessRender({ data }: { entityId: EntityId; data: FitnessData }) {
	const movePct = data.move.current / data.move.goal;
	const exercisePct = data.exercise.current / data.exercise.goal;
	const standPct = data.stand.current / data.stand.goal;

	return (
		<div
			className="flex h-full w-full flex-col bg-black p-5 text-white"
			style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
		>
			<div className="flex items-center justify-between">
				<div>
					<div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
						Activity
					</div>
					<div className="mt-0.5 text-[14px] font-semibold">Today</div>
				</div>
				<div className="text-[10px] text-white/40">Tap to update</div>
			</div>

			<div className="flex flex-1 items-center justify-center">
				<svg viewBox="-90 -90 180 180" className="h-[180px] w-[180px]">
					<title>Activity rings</title>
					<Ring r={74} pct={movePct} color="#FA114F" bg="rgba(250,17,79,0.18)" />
					<Ring r={56} pct={exercisePct} color="#92E82A" bg="rgba(146,232,42,0.18)" />
					<Ring r={38} pct={standPct} color="#1EEAEF" bg="rgba(30,234,239,0.18)" />
				</svg>
			</div>

			<div className="flex items-stretch justify-between gap-3 border-white/10 border-t pt-3">
				<Stat
					label="Move"
					value={data.move.current}
					goal={data.move.goal}
					unit="CAL"
					color="#FA114F"
				/>
				<Stat
					label="Exercise"
					value={data.exercise.current}
					goal={data.exercise.goal}
					unit="MIN"
					color="#92E82A"
				/>
				<Stat
					label="Stand"
					value={data.stand.current}
					goal={data.stand.goal}
					unit="HRS"
					color="#1EEAEF"
				/>
			</div>
		</div>
	);
}

export const FitnessCard = createCardWidget<FitnessData>({
	type: 'fitness-card',
	size: 'large',
	schema,
	defaultData: {
		move: { current: 420, goal: 520 },
		exercise: { current: 22, goal: 30 },
		stand: { current: 9, goal: 12 },
	},
	render: FitnessRender,
});
