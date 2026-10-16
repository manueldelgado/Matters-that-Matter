// The swatch popover opened by a tone trigger.

import { Scope, setTooltip, type App } from 'obsidian';
import { TONES, type Tone } from '../../settings';
import { STRINGS } from '../../strings';
import { pressable } from './dom';

export function swatches(parent: HTMLElement, current: Tone, onPick: (tone: Tone) => void): HTMLElement {
	const el = parent.createDiv({ cls: 'mtm-swatches' });
	for (const tone of TONES) {
		const swatch = el.createSpan({ cls: ['mtm-swatch', `mtm-tone-${tone}`] });
		if (tone === 'ink') swatch.addClass('mod-ink');
		if (tone === current) swatch.addClass('is-active');
		swatch.setAttrs({ 'aria-label': STRINGS.tones[tone], 'aria-pressed': String(tone === current) });
		setTooltip(swatch, STRINGS.tones[tone]);
		pressable(swatch, (e) => {
			e.stopPropagation();
			onPick(tone);
		});
	}
	// One tab stop for the row of swatches (the current tone); the arrow keys move between them.
	const all = Array.from(el.children).filter((c): c is HTMLElement => c.instanceOf(HTMLElement));
	const stop = all.find((c) => c.hasClass('is-active')) ?? all[0];
	for (const c of all) c.setAttr('tabindex', c === stop ? 0 : -1);
	el.addEventListener('keydown', (e) => {
		const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
		const at = all.findIndex((c) => c === el.doc.activeElement);
		if (!step || at < 0) return;
		e.preventDefault();
		all[(at + step + all.length) % all.length]?.focus();
	});
	return el;
}

/** Closes the popover open now, if any: one at a time. */
let closeOpen: (() => void) | null = null;

/** Opens the swatches below the anchor; closes on a pick, a click outside, Tab out of it or Escape. */
export function openTonePopover(app: App, anchor: HTMLElement, current: Tone, onPick: (tone: Tone) => void): void {
	closeOpen?.();
	const doc = anchor.doc;
	const rect = anchor.getBoundingClientRect();
	// Escape closes only the popover (not the Settings modal under it), and focus goes back to the trigger.
	const scope = new Scope(app.scope);
	let closed = false;
	const close = (refocus: boolean) => {
		if (closed) return;
		closed = true;
		closeOpen = null;
		app.keymap.popScope(scope);
		const hadFocus = popover.contains(doc.activeElement);
		popover.remove();
		if ((refocus || hadFocus) && anchor.isConnected) anchor.focus();
		doc.removeEventListener('pointerdown', onOutside, true);
	};
	closeOpen = () => close(false);
	// Inside the trigger's modal, if any: a modal pulls focus that leaves it back in. The popover is fixed, so it
	// stays where it is placed.
	const host = anchor.closest<HTMLElement>('.modal-container') ?? doc.body;
	const popover = swatches(host, current, (tone) => {
		close(false);
		onPick(tone);
	});
	popover.addClass('mod-popover');
	popover.setCssProps({ '--mtm-popover-x': `${Math.round(rect.left)}px`, '--mtm-popover-y': `${Math.round(rect.bottom + 4)}px` });

	const onOutside = (e: PointerEvent) => {
		if (!popover.contains(e.target as Node)) close(false);
	};
	scope.register([], 'Escape', () => {
		close(true);
		return false;
	});
	app.keymap.pushScope(scope);
	doc.addEventListener('pointerdown', onOutside, true);
	// Tab from the trigger wouldn't reach the popover: focus moves in.
	(popover.querySelector<HTMLElement>('.mtm-swatch.is-active') ?? popover.querySelector<HTMLElement>('.mtm-swatch'))?.focus();
	// Tabbing out of it closes it, as a click outside does; focus moving between swatches or back to the trigger doesn't.
	popover.addEventListener('focusout', (e) => {
		const next = e.relatedTarget;
		if (!next || next === anchor || popover.contains(next as Node)) return;
		close(false);
	});
}
