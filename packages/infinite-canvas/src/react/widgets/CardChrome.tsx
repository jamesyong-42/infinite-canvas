import type * as React from 'react';

/** Visual variants for the card chrome — matches the iOS card aesthetics. */
export interface CardChromeProps {
	/**
	 * True while the user is actively dragging this card. Triggers a CSS
	 * transition: scale up slightly and deepen the drop shadow.
	 */
	lifted?: boolean;
	/** Border radius in CSS pixels. Default 21.67 — the iOS card spec. */
	radius?: number;
	/**
	 * Background color (any valid CSS background value). Skip / pass
	 * `'transparent'` if the children paint their own background.
	 */
	background?: string;
	/** Extra class name appended to the chrome div. */
	className?: string;
	/** Style overrides — merged after the chrome's defaults. */
	style?: React.CSSProperties;
	/**
	 * Drag-over highlight state. When `overlapCandidate` is true, a single
	 * radial gradient glow renders at `(hotX, hotY)` in [0,1] local coords
	 * with intensity scaled by `hotStrength`. `overlapTarget` swaps between
	 * the candidate / target alpha + falloff CSS vars (configured via
	 * `OverlapGlowConfig`). All five props default to a no-op.
	 */
	overlapCandidate?: boolean;
	overlapTarget?: boolean;
	hotX?: number;
	hotY?: number;
	hotStrength?: number;
	/** Children render *inside* the chrome (clipped to its rounded shape). */
	children?: React.ReactNode;
}

/**
 * iOS-style card chrome — rounded background, hairline ring, soft drop
 * shadow, and a smooth lift (scale + stronger shadow) when `lifted` is
 * true. A single soft radial-gradient glow renders at the hot point
 * during overlap (no rim, no bloom, no backdrop-filter). Glow color,
 * alpha, and falloff are tunable via the `--ic-glow-*` CSS vars set by
 * `<InfiniteCanvas overlapGlow={…}>`.
 *
 * Pure presentational component with no ECS or compositor coupling. Used
 * by both the DOM `createCardWidget` (wrapping inner content) and the R3F
 * `createGeometryCardWidget` (rendered via a DOM slot beneath the WebGL
 * canvas, with the 3D content floating on top).
 */
export function CardChrome({
	lifted = false,
	radius = 21.67,
	background,
	className,
	style,
	overlapCandidate = false,
	overlapTarget = false,
	hotX = 0.5,
	hotY = 0.5,
	hotStrength = 0,
	children,
}: CardChromeProps) {
	const baseShadow = lifted
		? '0 30px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)'
		: '0 20px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)';

	const baseStyle: React.CSSProperties = {
		position: 'relative',
		width: '100%',
		height: '100%',
		borderRadius: `${radius}px`,
		overflow: 'hidden',
		background,
		boxShadow: baseShadow,
		transform: lifted ? 'scale(1.05)' : 'scale(1)',
		transformOrigin: 'center center',
		transition: 'transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 220ms ease',
		willChange: lifted ? 'transform, box-shadow' : undefined,
		...style,
	};

	const hotXPct = hotX * 100;
	const hotYPct = hotY * 100;

	// Inner glow — `inset` box-shadow with a hot-point-derived offset,
	// matching the reference (card-light.html). The reference's JS
	// computes `light-x = -deltaX * 20 * sensitivity`, clamps to ±20,
	// then uses `calc(var(--light-x) * 0.4)` as the inset offset (so a
	// max of ±8px). We use the same range, derived from hotX/hotY:
	//   offset = -(hotX - 0.5) * 16  →  ranges -8..+8 px
	// The negative sign puts the bright spot on the SAME side as the
	// hot point (positive offsetX → inset shadow on left).
	const offsetX = -(hotX - 0.5) * 16;
	const offsetY = -(hotY - 0.5) * 16;
	const sizeVar = overlapTarget ? 'var(--ic-glow-size-t, 80px)' : 'var(--ic-glow-size-c, 60px)';
	const alphaVar = overlapTarget ? 'var(--ic-glow-alpha-t, 0.45)' : 'var(--ic-glow-alpha-c, 0.25)';
	const glowStyle: React.CSSProperties = {
		position: 'absolute',
		inset: 0,
		pointerEvents: 'none',
		borderRadius: 'inherit',
		boxShadow: `inset ${offsetX}px ${offsetY}px ${sizeVar} rgba(var(--ic-glow-color, 128, 128, 128), ${alphaVar})`,
		opacity: overlapCandidate ? hotStrength : 0,
		transition: 'opacity 220ms ease, box-shadow 220ms ease',
	};

	// Rim — radial-gradient circle anchored at the hot point, faded to
	// transparent at 40%. Same as reference (card-light.html :115-119).
	// Color, width, alpha, and circle radius are all CSS-var driven so
	// the playground settings panel can retune them live.
	const rimAlphaVar = overlapTarget ? 'var(--ic-rim-alpha-t, 0.85)' : 'var(--ic-rim-alpha-c, 0.55)';
	const rimColor = `rgba(var(--ic-rim-color, 128, 128, 128), ${rimAlphaVar})`;
	const rimStyle: React.CSSProperties = {
		position: 'absolute',
		inset: 0,
		pointerEvents: 'none',
		borderRadius: 'inherit',
		padding: 'var(--ic-rim-width, 1.5px)',
		background: `radial-gradient(var(--ic-rim-radius, 600px) circle at ${hotXPct}% ${hotYPct}%, ${rimColor}, transparent 40%)`,
		WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
		WebkitMaskComposite: 'xor',
		mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
		maskComposite: 'exclude',
		opacity: overlapCandidate ? hotStrength : 0,
		transition: 'opacity 220ms ease, background 220ms ease',
	};

	return (
		<div
			className={className}
			style={baseStyle}
			data-overlap-candidate={overlapCandidate || undefined}
			data-overlap-target={overlapTarget || undefined}
		>
			{children}
			<div aria-hidden style={glowStyle} />
			<div aria-hidden style={rimStyle} />
		</div>
	);
}
