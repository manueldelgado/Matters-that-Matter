// The banner on person notes: what's open with them, in two columns of the Matter overview's cards.
// DOM only; the decorator supplies data and handlers.

import { STRINGS } from '../../strings';
import { dayLabel, toYmd } from '../../model/dates';
import type { ActionItem } from '../../services/actionItems';
import { firstName, PERSON_COLUMN_SIZE, type PersonModel } from '../../services/personModel';
import { avatarEl, bindCardActions, renderCard } from '../../ui/components/card';
import { appendIcon, pressable } from '../../ui/components/dom';
import { BANNER_ATTR } from './noteBanner';

export interface PersonBannerInput {
	name: string;
	model: PersonModel;
	/** Matter name and icon by path, for the cards. */
	matterOf(path: string): { name: string; icon: string };
	selected: string | null;
	now: Date;
}

export interface PersonBannerHandlers {
	newAction(): void;
	select(path: string): void;
	open(path: string, e: MouseEvent | KeyboardEvent): void;
	dismiss(item: ActionItem): void;
}

export function renderPersonBanner(input: PersonBannerInput, h: PersonBannerHandlers): HTMLElement {
	const s = STRINGS.person;
	const { model, now } = input;
	const first = firstName(input.name);

	// Nothing open: one quiet line with the done count.
	if (!model.waiting.length && !model.withThem.length) {
		const quiet = createDiv({ cls: ['mtm-person-banner', 'mod-quiet'], attr: { [BANNER_ATTR]: '' } });
		appendIcon(quiet, 'users');
		const today = toYmd(now);
		quiet.createSpan({ text: s.nothingOpen(first, model.done, model.lastDone ? dayLabel(model.lastDone, today) : null) });
		return quiet;
	}

	const banner = createDiv({ cls: 'mtm-person-banner', attr: { [BANNER_ATTR]: '' } });
	const head = banner.createDiv({ cls: 'mtm-person-banner-head' });
	avatarEl(head, input.name, 'mod-lg');
	const text = head.createDiv({ cls: 'mtm-person-banner-text' });
	text.createSpan({ cls: 'mtm-person-banner-eyebrow', text: s.eyebrow });
	const stats = text.createSpan({ cls: 'mtm-person-banner-stats' });
	if (model.waiting.length) stats.createSpan({ cls: 'mod-waiting', text: s.waitingCount(first, model.waiting.length) });
	if (model.withThem.length) stats.createSpan({ text: s.withCount(first, model.withThem.length) });
	if (model.late) stats.createSpan({ cls: 'mod-late', text: s.late(model.late) });
	if (model.done) stats.createSpan({ text: s.done(model.done) });
	const add = head.createEl('button');
	appendIcon(add, 'plus');
	add.appendText(s.newAction(first));
	add.addEventListener('click', () => h.newAction());

	const cols = banner.createDiv({ cls: 'mtm-person-banner-cols' });
	column(cols, s.waitingOn(first), s.oldestFirst, model.waiting, input, h);
	column(cols, s.withThem(first), String(model.withThem.length), model.withThem, input, h);
	return banner;
}

/** A titled stack of cards, five at first; "Show N more" expands it in place. */
function column(parent: HTMLElement, title: string, aside: string, items: readonly ActionItem[], input: PersonBannerInput, h: PersonBannerHandlers): void {
	if (!items.length) return;
	const block = parent.createDiv();
	const titleEl = block.createDiv({ cls: 'mtm-section-title', text: title });
	titleEl.createSpan({ cls: 'mtm-section-aside', text: aside });
	const stack = block.createDiv({ cls: 'mtm-stack' });
	const addCards = (list: readonly ActionItem[]) => {
		for (const item of list) {
			const matter = input.matterOf(item.effective.matterPath);
			const card = renderCard(stack, item, {
				now: input.now,
				selected: item.path === input.selected,
				matterName: matter.name,
				matterIcon: matter.icon,
				onDismiss: (i) => h.dismiss(i),
			});
			card.removeAttribute('draggable');
			bindCardActions(card, item.path, h);
		}
	};
	addCards(items.slice(0, PERSON_COLUMN_SIZE));
	const rest = items.slice(PERSON_COLUMN_SIZE);
	if (!rest.length) return;
	const more = pressable(block.createSpan({ cls: 'mtm-section-more', text: STRINGS.person.showMore(rest.length) }), () => {
		more.remove();
		addCards(rest);
	});
}
