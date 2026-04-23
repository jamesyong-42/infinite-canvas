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
	/** Children render *inside* the chrome (clipped to its rounded shape). */
	children?: React.ReactNode;
}

/**
 * iOS-style card chrome — rounded background, hairline ring, soft drop
 * shadow, and a smooth lift (scale + stronger shadow) when `lifted` is
 * true.
 *
 * Pure presentational component with no ECS or compositor coupling. Used
 * by both the DOM `createCardWidget` (wrapping inner content) and the R3F
 * `createGeometryCardWidget` (rendered via a DOM slot beneath the WebGL
 * canvas, with the 3D content floating on top).
 *
 * Browser-native `box-shadow` produces a far better-looking blur than any
 * shader-based approximation we can write in WebGL — CSS is the right tool
 * for flat 2D card chrome regardless of what fills the content.
 */
export function CardChrome({
	lifted = false,
	radius = 21.67,
	background,
	className,
	style,
	children,
}: CardChromeProps) {
	const baseStyle: React.CSSProperties = {
		width: '100%',
		height: '100%',
		borderRadius: `${radius}px`,
		overflow: 'hidden',
		background,
		boxShadow: lifted
			? '0 30px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)'
			: '0 20px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
		transform: lifted ? 'scale(1.05)' : 'scale(1)',
		transformOrigin: 'center center',
		transition:
			'transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
		willChange: lifted ? 'transform, box-shadow' : undefined,
		...style,
	};

	return (
		<div className={className} style={baseStyle}>
			{children}
		</div>
	);
}
