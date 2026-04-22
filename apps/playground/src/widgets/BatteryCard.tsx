import type { EntityId } from '@jamesyong42/infinite-canvas';
import { createCardWidget } from '@jamesyong42/infinite-canvas';
import { z } from 'zod';

const schema = z.object({
	phone: z.number().min(0).max(100).default(82),
	watch: z.number().min(0).max(100).default(47),
	airpods: z.number().min(0).max(100).default(91),
});
type BatteryData = z.infer<typeof schema>;

function Ring({ r, pct, color }: { r: number; pct: number; color: string }) {
	const circumference = 2 * Math.PI * r;
	const dash = (pct / 100) * circumference;
	return (
		<g>
			<circle r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
			<circle
				r={r}
				fill="none"
				stroke={color}
				strokeWidth={6}
				strokeLinecap="round"
				strokeDasharray={`${dash} ${circumference}`}
				transform="rotate(-90)"
				style={{ transition: 'stroke-dasharray 400ms ease-out' }}
			/>
		</g>
	);
}

function BatteryRender({ data }: { entityId: EntityId; data: BatteryData }) {
	return (
		<div
			className="flex h-full w-full flex-col justify-between bg-[#1C1C1E] p-4 text-white"
			style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
		>
			<div className="text-[10px] font-medium uppercase tracking-wider opacity-60">Batteries</div>
			<div className="relative flex items-center justify-center">
				<svg viewBox="-50 -50 100 100" className="h-[90px] w-[90px]">
					<title>Battery rings</title>
					<Ring r={42} pct={data.phone} color="#30D158" />
					<Ring r={30} pct={data.watch} color="#FFD60A" />
					<Ring r={18} pct={data.airpods} color="#64D2FF" />
				</svg>
			</div>
			<div className="space-y-0.5 text-[10px]">
				<Row label="Phone" pct={data.phone} color="#30D158" />
				<Row label="Watch" pct={data.watch} color="#FFD60A" />
				<Row label="AirPods" pct={data.airpods} color="#64D2FF" />
			</div>
		</div>
	);
}

function Row({ label, pct, color }: { label: string; pct: number; color: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
			<span className="flex-1 opacity-70">{label}</span>
			<span className="tabular-nums font-medium">{Math.round(pct)}%</span>
		</div>
	);
}

export const BatteryCard = createCardWidget<BatteryData>({
	type: 'battery-card',
	size: 'small',
	schema,
	defaultData: { phone: 82, watch: 47, airpods: 91 },
	render: BatteryRender,
});
