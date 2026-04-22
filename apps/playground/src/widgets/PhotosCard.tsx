import type { EntityId } from '@jamesyong42/infinite-canvas';
import { createCardWidget } from '@jamesyong42/infinite-canvas';
import { z } from 'zod';

const schema = z.object({
	badge: z.string().default('ON THIS DAY'),
	yearsAgo: z.number().default(4),
	title: z.string().default('Sunset over Point Reyes'),
	location: z.string().default('California · April 21'),
	/** Hue for the procedural art (0–360). */
	hue: z.number().min(0).max(360).default(18),
});
type PhotosData = z.infer<typeof schema>;

/**
 * Procedurally-generated "photo" — layered blurred blobs + a soft grain.
 * Gives the widget a strong visual identity without shipping image assets.
 */
function ProceduralArt({ hue }: { hue: number }) {
	const h1 = hue;
	const h2 = (hue + 40) % 360;
	const h3 = (hue + 220) % 360;
	const h4 = (hue + 300) % 360;
	return (
		<svg
			viewBox="0 0 329 535"
			preserveAspectRatio="xMidYMid slice"
			className="absolute inset-0 h-full w-full"
		>
			<title>Procedural art</title>
			<defs>
				<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor={`hsl(${h1} 80% 62%)`} />
					<stop offset="55%" stopColor={`hsl(${h2} 75% 48%)`} />
					<stop offset="100%" stopColor={`hsl(${h3} 55% 18%)`} />
				</linearGradient>
				<radialGradient id="sun" cx="72%" cy="32%" r="45%">
					<stop offset="0%" stopColor={`hsl(${h1} 95% 82%)`} stopOpacity="1" />
					<stop offset="55%" stopColor={`hsl(${h1} 95% 82%)`} stopOpacity="0" />
				</radialGradient>
				<radialGradient id="blob2" cx="20%" cy="80%" r="55%">
					<stop offset="0%" stopColor={`hsl(${h4} 90% 60%)`} stopOpacity="0.65" />
					<stop offset="100%" stopColor={`hsl(${h4} 90% 60%)`} stopOpacity="0" />
				</radialGradient>
				<filter id="grain">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.9"
						numOctaves="2"
						stitchTiles="stitch"
					/>
					<feColorMatrix type="matrix" values="0 0 0 0 1   0 0 0 0 1   0 0 0 0 1   0 0 0 0.08 0" />
				</filter>
				<linearGradient id="bottomScrim" x1="0" y1="0.45" x2="0" y2="1">
					<stop offset="0%" stopColor="rgba(0,0,0,0)" />
					<stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
				</linearGradient>
			</defs>
			<rect width="329" height="535" fill="url(#sky)" />
			<rect width="329" height="535" fill="url(#sun)" />
			<rect width="329" height="535" fill="url(#blob2)" />
			{/* mountain silhouette */}
			<path
				d="M0 420 L60 360 L110 395 L160 330 L220 380 L290 335 L329 370 L329 535 L0 535 Z"
				fill={`hsl(${h3} 45% 12%)`}
				opacity="0.85"
			/>
			<path
				d="M0 465 L80 430 L150 455 L220 425 L329 450 L329 535 L0 535 Z"
				fill={`hsl(${h3} 50% 8%)`}
			/>
			<rect width="329" height="535" filter="url(#grain)" />
			<rect width="329" height="535" fill="url(#bottomScrim)" />
		</svg>
	);
}

function PhotosRender({ data }: { entityId: EntityId; data: PhotosData }) {
	return (
		<div
			className="relative h-full w-full overflow-hidden bg-black text-white"
			style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
		>
			<ProceduralArt hue={data.hue} />

			{/* Top badge */}
			<div className="absolute top-4 left-4 flex items-center gap-1.5">
				<span
					className="rounded-full px-2 py-[3px] text-[9px] font-bold uppercase tracking-wider"
					style={{
						color: '#fff',
						backgroundColor: 'rgba(255,255,255,0.18)',
						backdropFilter: 'blur(6px)',
					}}
				>
					{data.badge}
				</span>
				<span className="text-[10px] font-medium text-white/80">
					{data.yearsAgo} {data.yearsAgo === 1 ? 'year' : 'years'} ago
				</span>
			</div>

			{/* Bottom caption */}
			<div className="absolute right-4 bottom-4 left-4">
				<div className="text-[17px] font-semibold leading-tight tracking-tight">{data.title}</div>
				<div className="mt-1 text-[11px] font-medium text-white/70">{data.location}</div>
			</div>
		</div>
	);
}

export const PhotosCard = createCardWidget<PhotosData>({
	type: 'photos-card',
	size: 'xl',
	schema,
	defaultData: {
		badge: 'ON THIS DAY',
		yearsAgo: 4,
		title: 'Sunset over Point Reyes',
		location: 'California · April 21',
		hue: 18,
	},
	render: PhotosRender,
});
