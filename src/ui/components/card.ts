// Action card and the atoms it shares with other views (due label, priority, avatar, orphan badge).

import { setTooltip } from 'obsidian';
import { STRINGS } from '../../strings';
import type { Priority } from '../../model/actions';
import { dateLabel, isOverdue, toYmd, type MtmDate } from '../../model/dates';
import { initials, type ActionItem } from '../../services/actionItems';
import type { EffectiveAction } from '../../services/effective';
import { appendIcon, tileEl, typeClasses } from './dom';

export function dueEl(parent: HTMLElement, due: MtmDate, now: Date, closed: boolean, mod?: string): HTMLElement {
	const overdue = isOverdue(due, now, closed);
	const today = !closed && !overdue && due.date === toYmd(now);
	const el = parent.createSpan({ cls: ['mtm-due', ...(overdue ? ['is-overdue'] : today ? ['is-today'] : []), ...(mod ? [mod] : [])] });
	appendIcon(el, overdue ? 'circle-alert' : due.time ? 'clock' : 'calendar');
	el.appendText(dateLabel(due, toYmd(now)));
	return el;
}

export function priorityEl(parent: HTMLElement, priority: Priority, withLabel = false): HTMLElement {
	const label = STRINGS.card.priority[priority];
	const el = parent.createSpan({ cls: ['mtm-priority', `mod-${priority}`] });
	setTooltip(el, STRINGS.card.priorityTitle(label));
	const bars = el.createSpan({ cls: 'mtm-priority-bars' });
	for (let i = 0; i < 3; i++) bars.createSpan({ cls: 'mtm-priority-bar' });
	if (withLabel) el.createSpan({ cls: 'mtm-priority-label', text: label });
	return el;
}

export function avatarEl(parent: HTMLElement, name: string, mod?: string): HTMLElement {
	const el = parent.createSpan({ cls: mod ? `mtm-avatar ${mod}` : 'mtm-avatar', text: initials(name) });
	setTooltip(el, name);
	return el;
}

const ORPHAN_ICONS = { status: 'circle-dashed', matter: 'folder-x', type: 'shapes' } as const;
export type OrphanField = keyof typeof ORPHAN_ICONS;

export function orphanBadge(parent: HTMLElement, field: OrphanField, value: string, compact: boolean, onDismiss: () => void): HTMLElement {
	const labels = STRINGS.card.orphanLabels;
	const el = parent.createSpan({ cls: ['mtm-orphan', `mod-${field}`] });
	setTooltip(el, STRINGS.card.orphanTitle(labels[field].toLowerCase(), value));
	appendIcon(el, ORPHAN_ICONS[field]);
	if (!compact) el.createSpan({ cls: 'mtm-orphan-label', text: labels[field] });
	el.createSpan({ cls: 'mtm-orphan-value', text: `“${value}”` });
	const dismiss = el.createEl('button', { cls: 'mtm-orphan-dismiss', attr: { 'aria-label': STRINGS.card.dismiss } });
	appendIcon(dismiss, 'x');
	dismiss.addEventListener('click', (e) => {
		e.stopPropagation();
		onDismiss();
	});
	return el;
}

/** The banner listing unrecognised values (inspector and Action notes), or null when there are none. */
export function orphanBanner(effective: EffectiveAction, onDismiss: () => void): HTMLElement | null {
	const s = STRINGS.inspector;
	const { orphans, status, type } = effective;
	const parts: string[] = [];
	if (orphans.status !== undefined) parts.push(s.orphanStatus(orphans.status, status.label));
	if (orphans.matter !== undefined) parts.push(s.orphanMatter(orphans.matter));
	if (orphans.type !== undefined) parts.push(s.orphanType(orphans.type, type.label));
	if (!parts.length) return null;
	const banner = createDiv({ cls: 'mtm-orphan-banner' });
	appendIcon(banner, 'triangle-alert');
	const text = banner.createDiv({ cls: 'mtm-orphan-banner-text' });
	text.createEl('b', { text: s.orphanTitle });
	text.appendText(` ${parts.join(', ')}.`);
	banner.createEl('button', { text: s.dismiss }).addEventListener('click', onDismiss);
	return banner;
}

export interface CardContext {
	now: Date;
	selected: boolean;
	/** Matter name, shown only outside the board. */
	matterName?: string;
	onDismiss(item: ActionItem): void;
}

export function renderCard(parent: HTMLElement, item: ActionItem, ctx: CardContext): HTMLElement {
	const { type } = item.effective;
	const done = item.category === 'closed';
	const card = parent.createDiv({
		cls: ['mtm-card', ...typeClasses(type), ...(done ? ['is-done'] : []), ...(ctx.selected ? ['is-selected'] : [])],
		attr: { tabindex: 0, draggable: 'true', 'data-path': item.path },
	});

	const head = card.createDiv({ cls: 'mtm-card-head' });
	setTooltip(tileEl(head, type.icon), type.label);
	head.createDiv({ cls: 'mtm-card-title', text: item.title });
	if (done) appendIcon(head.createSpan({ cls: 'mtm-card-check' }), 'circle-check');

	const hasMeta = !done && (item.due || item.priority || item.linkedCount > 0 || item.waitingOn);
	if (hasMeta) {
		const meta = card.createDiv({ cls: 'mtm-card-meta' });
		if (item.due) dueEl(meta, item.due, ctx.now, done);
		if (item.priority) priorityEl(meta, item.priority);
		if (item.linkedCount > 0) {
			const count = meta.createSpan({ cls: 'mtm-count' });
			setTooltip(count, STRINGS.card.linkedNotes);
			appendIcon(count, 'file-text');
			count.appendText(String(item.linkedCount));
		}
		if (item.waitingOn) {
			const waiting = meta.createSpan({ cls: 'mtm-waiting' });
			setTooltip(waiting, STRINGS.card.waitingOn(item.waitingOn.split('/').pop() ?? item.waitingOn));
			appendIcon(waiting, 'clock');
			avatarEl(waiting, item.waitingOn);
		}
	}

	for (const field of ['status', 'matter', 'type'] as const) {
		const value = item.effective.orphans[field];
		if (value !== undefined) orphanBadge(card, field, value, true, () => ctx.onDismiss(item));
	}
	if (ctx.matterName) card.createDiv({ cls: 'mtm-card-matter', text: ctx.matterName });
	return card;
}
