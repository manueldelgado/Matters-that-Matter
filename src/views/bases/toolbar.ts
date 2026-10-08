// The slim toolbar every MTM collection view shows above its content.

import { setIcon, setTooltip } from 'obsidian';
import type { TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { appendIcon, tileEl, typeClasses } from '../../ui/components/dom';

export interface ToolbarInput {
	types: readonly TypeDef[];
	typesOff: ReadonlySet<string>;
	showDone: boolean;
	/** Null hides the count (nothing to count yet). */
	openCount: number | null;
}

export interface ToolbarHandlers {
	toggleType: (typeId: string) => void;
	toggleDone: () => void;
	newAction: () => void;
}

/** Type chips (all on by default; with none on, all show), the open count, Show done and "+". */
export function renderToolbar(view: HTMLElement, input: ToolbarInput, h: ToolbarHandlers): void {
	const bar = view.createDiv({ cls: 'mtm-toolbar' });
	const filters = bar.createDiv({ cls: 'mtm-filters' });
	filters.createSpan({ cls: 'mtm-toolbar-label', text: STRINGS.board.actionTypes });
	// A chip is on unless switched off; with every chip off, all types show (see typeShown).
	for (const type of input.types) {
		const chip = filters.createEl('button', { cls: ['mtm-filter', ...typeClasses(type)] });
		if (!input.typesOff.has(type.id)) chip.addClass('is-active');
		tileEl(chip, type.icon, 'mod-xs');
		chip.appendText(type.label);
		chip.addEventListener('click', () => h.toggleType(type.id));
	}
	bar.createSpan({ cls: 'mtm-spacer' });
	if (input.openCount !== null) bar.createSpan({ cls: 'mtm-toolbar-note', text: STRINGS.board.open(input.openCount) });
	const b = STRINGS.board;
	const done = bar.createSpan({ cls: 'mtm-toolbar-note mod-toggle', attr: { role: 'button', tabindex: 0 } });
	appendIcon(done, input.showDone ? 'eye' : 'eye-off');
	done.appendText(input.showDone ? b.doneShown : b.doneHidden);
	setTooltip(done, input.showDone ? b.hideDoneHere : b.showDoneHere);
	done.addEventListener('click', () => h.toggleDone());
	done.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			h.toggleDone();
		}
	});
	const add = bar.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.board.newAction } });
	setIcon(add, 'plus');
	add.addEventListener('click', () => h.newAction());
}
