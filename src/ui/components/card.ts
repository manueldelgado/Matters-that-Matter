// Action card and the atoms it shares with other views (due label, priority, avatar, orphan badge).

import { Keymap, setIcon, setTooltip } from 'obsidian';
import { STRINGS } from '../../strings';
import { waitAge, type Priority, type WaitAge } from '../../model/actions';
import { dateLabel, dayLabel, isOverdue, toYmd, type MtmDate } from '../../model/dates';
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

/** How long an Action has been waiting, short ("10d") or long ("10 days"); highlighted from two weeks. */
export function waitAgeEl(parent: HTMLElement, age: WaitAge, short: boolean, mod?: string): HTMLElement {
	return parent.createSpan({ cls: ['mtm-waiting-age', ...(age.isLong ? ['is-long'] : []), ...(mod ? [mod] : [])], text: short ? age.short : age.long });
}

/** The waiting tooltip: with the date and age when known. */
export function waitingTitle(name: string, since: string | null, now: Date): string {
	const display = name.split('/').pop() ?? name;
	if (!since) return STRINGS.card.waitingOn(display);
	const today = toYmd(now);
	return STRINGS.card.waitingSince(display, dayLabel(since, today), waitAge(since, today).long);
}

export function avatarEl(parent: HTMLElement, name: string, mod?: string): HTMLElement {
	const el = parent.createSpan({ cls: mod ? `mtm-avatar ${mod}` : 'mtm-avatar', text: initials(name) });
	setTooltip(el, name);
	return el;
}

const ORPHAN_ICONS = { status: 'circle-dashed', matter: 'folder-x', type: 'shapes', sphere: 'orbit' } as const;
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
	/** The Matter's icon, before its name. */
	matterIcon?: string;
	onDismiss(item: ActionItem): void;
}

/**
 * Selection and opening on a card (G4): click selects, Ctrl/Cmd-click or double-click opens; Enter opens and Space selects.
 * Keys pressed on something inside the card (an orphan badge's dismiss) stay with it.
 */
export function bindCardActions(
	card: HTMLElement,
	path: string,
	h: { select(path: string): void; open(path: string, e: MouseEvent | KeyboardEvent): void },
): void {
	card.addEventListener('click', (e) => {
		if (Keymap.isModEvent(e)) h.open(path, e);
		else h.select(path);
	});
	card.addEventListener('dblclick', (e) => h.open(path, e));
	card.addEventListener('keydown', (e) => {
		if (e.target !== card) return;
		if (e.key === 'Enter') h.open(path, e);
		else if (e.key === ' ') {
			e.preventDefault();
			h.select(path);
		}
	});
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
			setTooltip(waiting, waitingTitle(item.waitingOn, item.waitingSince, ctx.now));
			appendIcon(waiting, 'clock');
			avatarEl(waiting, item.waitingOn);
			if (item.waitingSince) waitAgeEl(waiting, waitAge(item.waitingSince, toYmd(ctx.now)), true);
		}
	}

	for (const field of ['status', 'matter', 'type'] as const) {
		const value = item.effective.orphans[field];
		if (value !== undefined) orphanBadge(card, field, value, true, () => ctx.onDismiss(item));
	}
	if (ctx.matterName) {
		const matter = card.createDiv({ cls: ['mtm-card-matter', ...(ctx.matterIcon ? ['has-icon'] : [])] });
		if (ctx.matterIcon) setIcon(matter.createSpan({ cls: 'mtm-matter-icon' }), ctx.matterIcon);
		matter.appendText(ctx.matterName);
	}
	return card;
}
