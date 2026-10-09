// "What matters today?": the panel in a new tab. The day on the left (date, question, counts, actions),
// its Actions on the right (due or late; else what's next; else an invitation).

import type { TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import type { ActionItem } from '../../services/actionItems';
import { TODAY_CARDS, type TodayModel } from '../../services/todayModel';
import { appendIcon, pressable, tileEl, typeClasses } from '../../ui/components/dom';
import { bindCardActions, renderCard } from '../../ui/components/card';

export interface TodayRenderInput {
	model: TodayModel;
	now: Date;
	types: readonly TypeDef[];
	selected: string | null;
	matterOf(path: string): { name: string; icon: string };
}

export interface TodayHandlers {
	quickAdd: () => void;
	openBoard: () => void;
	newNote: () => void;
	goToFile: () => void;
	processInbox: () => void;
	pickReview: () => void;
	pickWaiting: () => void;
	select: (path: string) => void;
	open: (path: string, e: MouseEvent | KeyboardEvent) => void;
	dismiss: (item: ActionItem) => void;
}

export function renderToday(parent: HTMLElement, input: TodayRenderInput, h: TodayHandlers): HTMLElement {
	const t = STRINGS.today;
	const { model } = input;
	const panel = parent.createDiv({ cls: 'mtm-today' });

	// The day.
	const side = panel.createDiv({ cls: 'mtm-today-side' });
	const head = side.createDiv({ cls: 'mtm-today-head' });
	head.createSpan({ cls: 'mtm-today-eyebrow', text: t.date(input.now) });
	head.createEl('h1', { cls: 'mtm-today-title', text: t.question });

	const stats = side.createDiv({ cls: 'mtm-stats' });
	stat(stats, 'mod-inbox', model.inbox, 'inbox', t.toSort, h.processInbox);
	stat(stats, 'mod-review', model.reviews.length, 'circle-alert', t.reviewsDue, h.pickReview);
	const waiting = stat(stats, 'mod-waiting', model.waiting.length, 'clock', t.waiting, h.pickWaiting);
	if (model.longWaits) waiting.createSpan({ cls: 'mtm-today-stat-note', text: t.longWaits(model.longWaits) });

	const actions = side.createDiv({ cls: 'mtm-today-actions' });
	action(actions, 'mtm-tone-sky', 'plus', t.quickAdd, h.quickAdd);
	action(actions, 'mtm-tone-sky', 'square-kanban', t.openBoard, h.openBoard);
	action(actions, 'mtm-tone-ink', 'file-plus', t.newNote, h.newNote);
	action(actions, 'mtm-tone-ink', 'search', t.goToFile, h.goToFile);

	// Its Actions.
	const section = panel.createDiv({ cls: 'mtm-today-section' });
	if (model.due.length) {
		const title = section.createDiv({ cls: 'mtm-section-title', text: t.today });
		title.createSpan({ cls: 'mtm-section-aside', text: t.dueLate(model.dueToday, model.late) });
		cards(section, model.due, input, h);
		more(section, model.due.length - TODAY_CARDS, t.more, h);
	} else if (model.next.length && model.nextStatus) {
		section.createEl('p', { cls: 'mtm-today-lead', text: t.nextUp });
		cards(section, model.next, input, h);
		const status = model.nextStatus.label;
		more(section, model.next.length - TODAY_CARDS, (n) => t.moreNext(n, status), h);
	} else {
		empty(section, input.types);
	}
	return panel;
}

function stat(parent: HTMLElement, mod: string, value: number, icon: string, label: string, onPress: () => void): HTMLElement {
	const el = pressable(parent.createDiv({ cls: ['mtm-stat', mod], attr: { role: 'button', tabindex: 0 } }), () => onPress());
	el.createSpan({ cls: 'mtm-stat-value', text: String(value) });
	const labelEl = el.createSpan({ cls: 'mtm-stat-label' });
	appendIcon(labelEl, icon);
	labelEl.appendText(label);
	return el;
}

function action(parent: HTMLElement, tone: string, icon: string, label: string, onPress: () => void): void {
	const button = parent.createEl('button', { cls: ['mtm-today-action', tone] });
	appendIcon(button, icon);
	button.appendText(label);
	button.addEventListener('click', () => onPress());
}

function cards(parent: HTMLElement, items: readonly ActionItem[], input: TodayRenderInput, h: TodayHandlers): void {
	const list = parent.createDiv({ cls: 'mtm-today-cards' });
	for (const item of items.slice(0, TODAY_CARDS)) {
		const matter = input.matterOf(item.effective.matterPath);
		const card = renderCard(list, item, {
			now: input.now,
			selected: item.path === input.selected,
			matterName: matter.name,
			matterIcon: matter.icon,
			onDismiss: (i) => h.dismiss(i),
		});
		card.removeAttribute('draggable');
		bindCardActions(card, item.path, h);
	}
}

function more(parent: HTMLElement, n: number, text: (n: number) => string, h: TodayHandlers): void {
	if (n > 0) pressable(parent.createSpan({ cls: 'mtm-today-more', text: text(n) }), () => h.openBoard());
}

/** Nothing due and nothing next: the user's own types as a quiet stack, and an invitation. */
function empty(parent: HTMLElement, types: readonly TypeDef[]): void {
	const t = STRINGS.today;
	const box = parent.createDiv({ cls: 'mtm-today-empty' });
	const ghosts = types.slice(0, 3).reverse();
	if (ghosts.length) {
		const stack = box.createDiv({ cls: 'mtm-empty-stack', attr: { 'aria-hidden': 'true' } });
		ghosts.forEach((type, i) => {
			const front = i === ghosts.length - 1;
			const card = stack.createDiv({ cls: ['mtm-card', ...typeClasses(type), ...(front ? ['is-selected'] : [])] });
			const head = card.createDiv({ cls: 'mtm-card-head' });
			tileEl(head, type.icon);
			head.createDiv({ cls: 'mtm-card-title', text: type.label });
		});
	}
	box.createDiv({ cls: 'mtm-today-empty-title', text: t.emptyTitle });
	box.createDiv({ cls: 'mtm-today-empty-text', text: t.emptyText });
}
