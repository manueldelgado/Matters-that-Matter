// What Action notes and file explorer entries show outside the views: classes and the banner's date. Pure.

import { STRINGS } from '../strings';
import { isToday } from '../model/actions';
import { dateLabel, dayLabel, daysBetween, isOverdue, parseMtmDate, startsAfterDue, type Ymd } from '../model/dates';
import type { ActionItem } from './actionItems';
import { classId } from './ids';

/** Every class the plugin adds to a note or explorer entry, so they can be swapped as a set. */
export const DECOR_PREFIXES = ['mtm-action-note', 'mtm-matter-note', 'mtm-nav-action', 'mtm-type-', 'mtm-tone-', 'mtm-status-', 'mtm-priority-', 'mtm-due-', 'mtm-is-done'] as const;

function typeAndStatus(item: ActionItem): string[] {
	const { type, status } = item.effective;
	return [`mtm-type-${classId(type.id)}`, `mtm-tone-${type.tone}`, `mtm-status-${classId(status.id)}`, `mtm-status-tone-${status.tone}`];
}

/** Classes for the content container of an open Action note. */
export function actionNoteClasses(item: ActionItem, now: Date): string[] {
	const closed = item.category === 'closed';
	const out = ['mtm-action-note', ...typeAndStatus(item)];
	if (item.priority) out.push(`mtm-priority-${item.priority}`);
	if (isOverdue(item.due, now, closed)) out.push('mtm-due-overdue');
	else if (isToday(item.due, item.category, now)) out.push('mtm-due-today');
	if (closed) out.push('mtm-is-done');
	return out;
}

/** Classes for an Action's entry in the file explorer. */
export function explorerClasses(item: ActionItem): string[] {
	return ['mtm-nav-action', ...typeAndStatus(item), ...(item.category === 'closed' ? ['mtm-is-done'] : [])];
}

export interface BannerDate {
	icon: string;
	label: string;
	state: 'overdue' | 'today' | null;
}

/**
 * The banner's date: when it was done for closed Actions; otherwise start → due for a span over several days,
 * the due date, or the start date alone.
 */
export function bannerDate(item: ActionItem, now: Date, today: Ymd): BannerDate | null {
	const s = STRINGS.noteBanner;
	if (item.category === 'closed') {
		const done = parseMtmDate(item.completed);
		if (!done) return null;
		const diff = daysBetween(today, done.date);
		const label = diff === 0 ? s.doneToday : diff === -1 ? s.doneYesterday : s.doneOn(dayLabel(done.date, today));
		return { icon: 'circle-check', label, state: null };
	}
	const { start, due } = item;
	if (!due) return start ? { icon: 'calendar', label: dateLabel(start, today), state: null } : null;
	const state = isOverdue(due, now, false) ? 'overdue' : isToday(due, item.category, now) ? 'today' : null;
	if (start && !startsAfterDue(start, due) && start.date !== due.date) {
		return { icon: 'calendar-range', label: `${dateLabel(start, today)} → ${dateLabel(due, today)}`, state };
	}
	return { icon: state === 'overdue' ? 'circle-alert' : due.time ? 'clock' : 'calendar', label: dateLabel(due, today), state };
}
