// A chip for a link to an Action: the type tile, the link itself (kept, so Obsidian's own handling stays), the due date.

import { setTooltip } from 'obsidian';
import { chipSignature, type ChipModel } from '../../services/inlineChip';
import { toYmd } from '../../model/dates';
import { dueEl } from './card';
import { tileEl, typeClasses } from './dom';

export const CHIP_PATH_ATTR = 'data-mtm-chip';

/** Fills `chip` around `link`: classes, tile before it, due date after it. Idempotent; redraws only on a new signature. */
export function fillChip(chip: HTMLElement, link: HTMLElement, model: ChipModel, now: Date, text: string): void {
	const signature = `${chipSignature(model, toYmd(now))}|${text}`;
	if (chip.dataset.mtmSig === signature) return;
	chip.dataset.mtmSig = signature;
	chip.setAttr(CHIP_PATH_ATTR, model.path);
	const types = typeClasses({ id: model.typeId, tone: model.tone });
	chip.className = '';
	chip.addClasses(['mtm-inline', ...types, ...(model.done ? ['is-done'] : [])]);
	for (const el of Array.from(chip.children)) if (el !== link) el.remove();
	if (link.parentElement !== chip) chip.appendChild(link);
	chip.insertBefore(tileEl(chip, model.icon), link).addClasses(types);
	if (model.due) dueEl(chip, model.due, now, false);
	// The author's own words (an alias): the Action's title in the tooltip.
	if (text.trim() !== model.title) setTooltip(chip, model.title);
	else chip.removeAttribute('aria-label');
}
