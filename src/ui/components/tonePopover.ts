// The swatch popover opened by a tone trigger.

import { setTooltip } from 'obsidian';
import { TONES, type Tone } from '../../settings';
import { STRINGS } from '../../strings';

export function swatches(parent: HTMLElement, current: Tone, onPick: (tone: Tone) => void): HTMLElement {
	const el = parent.createDiv({ cls: 'mtm-swatches' });
	for (const tone of TONES) {
		const swatch = el.createSpan({ cls: ['mtm-swatch', `mtm-tone-${tone}`] });
		if (tone === 'ink') swatch.addClass('mod-ink');
		if (tone === current) swatch.addClass('is-active');
		swatch.setAttr('role', 'button');
		swatch.setAttr('aria-label', STRINGS.tones[tone]);
		setTooltip(swatch, STRINGS.tones[tone]);
		swatch.addEventListener('click', (e) => {
			e.stopPropagation();
			onPick(tone);
		});
	}
	return el;
}

/** Opens the swatches below the anchor; closes on a pick, a click outside or Escape. */
export function openTonePopover(anchor: HTMLElement, current: Tone, onPick: (tone: Tone) => void): void {
	const doc = anchor.doc;
	const rect = anchor.getBoundingClientRect();
	const close = () => {
		popover.remove();
		doc.removeEventListener('pointerdown', onOutside, true);
		doc.removeEventListener('keydown', onKey, true);
	};
	const popover = swatches(doc.body, current, (tone) => {
		close();
		onPick(tone);
	});
	popover.addClass('mod-popover');
	popover.setCssProps({ '--mtm-popover-x': `${Math.round(rect.left)}px`, '--mtm-popover-y': `${Math.round(rect.bottom + 4)}px` });

	const onOutside = (e: PointerEvent) => {
		if (!popover.contains(e.target as Node)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	};
	doc.addEventListener('pointerdown', onOutside, true);
	doc.addEventListener('keydown', onKey, true);
}
