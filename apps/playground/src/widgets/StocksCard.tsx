import type { EntityId } from '@jamesyong42/infinite-canvas';
import { createCardWidget } from '@jamesyong42/infinite-canvas';
import { z } from 'zod';

const tickerSchema = z.object({
	symbol: z.string(),
	price: z.number(),
	changePct: z.number(),
	history: z.array(z.number()).min(2),
});

const schema = z.object({
	tickers: z
		.array(tickerSchema)
		.min(1)
		.max(4)
		.default([
			{
				symbol: 'AAPL',
				price: 218.54,
				changePct: 2.14,
				history: [210, 211, 214, 213, 216, 215, 217, 218, 217, 218.54],
			},
			{
				symbol: 'TSLA',
				price: 241.02,
				changePct: -1.32,
				history: [252, 249, 247, 246, 244, 243, 241, 242, 240, 241.02],
			},
			{
				symbol: 'NVDA',
				price: 872.3,
				changePct: 4.72,
				history: [820, 828, 835, 840, 846, 855, 860, 865, 870, 872.3],
			},
		]),
});
type StocksData = z.infer<typeof schema>;
type Ticker = z.infer<typeof tickerSchema>;

function Sparkline({
	history,
	up,
	width = 62,
	height = 22,
}: {
	history: number[];
	up: boolean;
	width?: number;
	height?: number;
}) {
	const min = Math.min(...history);
	const max = Math.max(...history);
	const range = max - min || 1;
	const stride = width / (history.length - 1);
	const points = history
		.map((v, i) => {
			const x = i * stride;
			const y = height - ((v - min) / range) * height;
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(' ');
	const color = up ? '#30D158' : '#FF453A';
	return (
		<svg viewBox={`0 0 ${width} ${height}`} className="h-[22px] w-[62px]">
			<title>Sparkline</title>
			<polyline
				points={points}
				fill="none"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function Row({ ticker }: { ticker: Ticker }) {
	const up = ticker.changePct >= 0;
	const color = up ? '#30D158' : '#FF453A';
	return (
		<div className="flex items-center gap-3">
			<div className="flex-1 min-w-0">
				<div className="text-[12px] font-semibold text-white">{ticker.symbol}</div>
				<div className="text-[9px] text-white/40">NASDAQ</div>
			</div>
			<Sparkline history={ticker.history} up={up} />
			<div className="flex min-w-[64px] flex-col items-end">
				<div className="text-[12px] font-medium tabular-nums text-white">
					{ticker.price.toFixed(2)}
				</div>
				<div
					className="rounded px-1 text-[10px] font-medium tabular-nums"
					style={{ color: '#fff', backgroundColor: color }}
				>
					{up ? '+' : ''}
					{ticker.changePct.toFixed(2)}%
				</div>
			</div>
		</div>
	);
}

function StocksRender({ data }: { entityId: EntityId; data: StocksData }) {
	return (
		<div
			className="flex h-full w-full flex-col justify-between bg-black px-4 py-3"
			style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
		>
			<div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
				<span className="text-white/60">Stocks</span>
				<span className="text-white/40">Market Open</span>
			</div>
			<div className="space-y-2">
				{data.tickers.slice(0, 3).map((t) => (
					<Row key={t.symbol} ticker={t} />
				))}
			</div>
		</div>
	);
}

export const StocksCard = createCardWidget<StocksData>({
	type: 'stocks-card',
	size: 'medium',
	schema,
	defaultData: {
		tickers: [
			{
				symbol: 'AAPL',
				price: 218.54,
				changePct: 2.14,
				history: [210, 211, 214, 213, 216, 215, 217, 218, 217, 218.54],
			},
			{
				symbol: 'TSLA',
				price: 241.02,
				changePct: -1.32,
				history: [252, 249, 247, 246, 244, 243, 241, 242, 240, 241.02],
			},
			{
				symbol: 'NVDA',
				price: 872.3,
				changePct: 4.72,
				history: [820, 828, 835, 840, 846, 855, 860, 865, 870, 872.3],
			},
		],
	},
	render: StocksRender,
});
