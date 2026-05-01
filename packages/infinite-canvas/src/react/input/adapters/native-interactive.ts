/**
 * Native HTML elements whose pointer / click events should never start a
 * canvas-level drag, marquee, selection, or navigation. The browser's
 * natural focus / activation / click synthesis runs unimpeded; the canvas
 * just stays out. Authors who want additional opt-out elements call
 * `e.stopPropagation()` from their own handler — it halts the bubble
 * before the native event reaches the canvas container, so neither
 * adapter sees it.
 *
 * Shared between PointerAdapter (skips `pointerdown`) and ClickAdapter
 * (skips `click` / `dblclick` / `contextmenu`) so the two adapters apply
 * consistent rules.
 */
export const NATIVE_INTERACTIVE_SELECTOR = 'button, input, textarea, select, [contenteditable]';
