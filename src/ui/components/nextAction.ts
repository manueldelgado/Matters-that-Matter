// "No next Action": the quiet hint (lane meta, list group, Matter note banner) and the ghost next step.

import { setTooltip } from 'obsidian';
import { STRINGS } from '../../strings';
import { appendIcon, pressable } from './dom';

/** A dashed, muted pill that opens the hint's menu. Never red: red means late. */
export function noNextActionHint(parent: HTMLElement, onPress: (el: HTMLElement) => void): HTMLElement {
	const s = STRINGS.nextAction;
	const hint = parent.createEl('button', { cls: 'mtm-stalled' });
	appendIcon(hint, 'signpost');
	hint.appendText(s.hint);
	setTooltip(hint, s.hintTitle);
	hint.addEventListener('click', (e) => {
		e.stopPropagation();
		onPress(hint);
	});
	return hint;
}

/** A dashed card inviting the next step; it opens quick add where the step belongs. The board's New Matter lane gives it its own words. */
export function nextStepGhost(parent: HTMLElement, onPress: () => void, mod?: string, text: string = STRINGS.nextAction.ghost): HTMLElement {
	const ghost = pressable(parent.createDiv({ cls: ['mtm-next-ghost', ...(mod ? [mod] : [])] }), (e) => {
		e.stopPropagation();
		onPress();
	});
	appendIcon(ghost, 'plus');
	ghost.createSpan({ cls: 'mtm-next-ghost-text', text });
	return ghost;
}
