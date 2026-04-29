/**
 * RFC-008 input pipeline — diagnostic logger.
 *
 * Single toggle (`INPUT_DEBUG`) wires every layer's "what just happened"
 * decision into the browser console with colour-coded tags so the dispatch
 * flow is legible in real time:
 *
 *   [Adapter] [InputManager] [Router] [R3F] [Recognizer] [Engine]
 *
 * `INPUT_DEBUG_VERBOSE` extends this to per-frame `move` events, which
 * fire at 60+ Hz and quickly drown the console — leave it `false` unless
 * you're chasing a hover or pan-update issue.
 *
 * Toggle either by editing the constants below or, more conveniently, by
 * setting `window.__INPUT_DEBUG__` / `window.__INPUT_DEBUG_VERBOSE__` from
 * the devtools console at runtime.
 */

const DEFAULT_DEBUG = true;
const DEFAULT_VERBOSE = false;

declare global {
	interface Window {
		__INPUT_DEBUG__?: boolean;
		__INPUT_DEBUG_VERBOSE__?: boolean;
	}
}

function isDebug(): boolean {
	if (typeof window === 'undefined') return DEFAULT_DEBUG;
	return window.__INPUT_DEBUG__ ?? DEFAULT_DEBUG;
}

function isVerbose(): boolean {
	if (typeof window === 'undefined') return DEFAULT_VERBOSE;
	return window.__INPUT_DEBUG_VERBOSE__ ?? DEFAULT_VERBOSE;
}

export type InputLayer = 'Adapter' | 'InputManager' | 'Router' | 'R3F' | 'Recognizer' | 'Engine';

const STYLES: Record<InputLayer, string> = {
	Adapter: 'background:#0288d1; color:#fff; padding:1px 4px; border-radius:2px; font-weight:bold',
	InputManager:
		'background:#f9a825; color:#222; padding:1px 4px; border-radius:2px; font-weight:bold',
	Router: 'background:#7b1fa2; color:#fff; padding:1px 4px; border-radius:2px; font-weight:bold',
	R3F: 'background:#00838f; color:#fff; padding:1px 4px; border-radius:2px; font-weight:bold',
	Recognizer: 'background:#558b2f; color:#fff; padding:1px 4px; border-radius:2px',
	Engine: 'background:#d84315; color:#fff; padding:1px 4px; border-radius:2px; font-weight:bold',
};

/**
 * Log a single line tagged with a layer. `data` is appended as a single
 * object so devtools can expand it inline.
 *
 * `move`-typed events are gated on `INPUT_DEBUG_VERBOSE` so the default
 * trace stays readable.
 */
export function inputLog(layer: InputLayer, message: string, data?: Record<string, unknown>): void {
	if (!isDebug()) return;
	const isMove =
		typeof data?.type === 'string' && (data.type === 'move' || data.type.endsWith('-update'));
	if (isMove && !isVerbose()) return;
	if (data !== undefined) {
		console.log(`%c${layer}%c ${message}`, STYLES[layer], 'color:inherit', data);
	} else {
		console.log(`%c${layer}%c ${message}`, STYLES[layer], 'color:inherit');
	}
}

/**
 * Group all logs for a single InputManager.dispatch under one collapsible
 * heading. Pass the returned closer to console.groupEnd at the end of
 * dispatch. No-op when debug is off.
 */
export function inputGroupStart(label: string): () => void {
	if (!isDebug()) return () => {};
	console.groupCollapsed(`%cInput · ${label}`, 'color:#555; font-weight:bold');
	return () => console.groupEnd();
}
