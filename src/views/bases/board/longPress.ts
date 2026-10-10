// Long-press on a card (the swipe board's way to move an Action). A press that moves is a scroll, not a long-press;
// the click that ends a long-press doesn't select the card.

import { isHTMLElement } from '../../../vault/internal';

const HOLD_MS = 450;
const SLOP_PX = 8;

export function attachLongPress(root: HTMLElement, onPress: (path: string, at: { x: number; y: number }) => void): void {
	let timer: number | null = null;
	let start: { x: number; y: number } | null = null;
	let fired = false;
	const cancel = () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		start = null;
	};

	root.addEventListener('pointerdown', (e) => {
		const card = isHTMLElement(e.target) ? e.target.closest<HTMLElement>('.mtm-card[data-path]') : null;
		if (!card || e.button !== 0) return;
		cancel();
		fired = false;
		const at = { x: e.clientX, y: e.clientY };
		start = at;
		timer = window.setTimeout(() => {
			timer = null;
			fired = true;
			const path = card.dataset.path;
			if (path) onPress(path, at);
		}, HOLD_MS);
	});
	root.addEventListener('pointermove', (e) => {
		if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancel();
	});
	root.addEventListener('pointerup', () => cancel());
	root.addEventListener('pointercancel', () => cancel());
	root.addEventListener('scroll', () => cancel(), { passive: true });
	root.addEventListener(
		'click',
		(e) => {
			if (!fired) return;
			fired = false;
			e.stopPropagation();
			e.preventDefault();
		},
		true,
	);
	// The system's own long-press menu (Android) gives way to ours.
	root.addEventListener('contextmenu', (e) => {
		if (isHTMLElement(e.target) && e.target.closest('.mtm-card')) e.preventDefault();
	});
}
