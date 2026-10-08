// What the Matter overview shows: stats and Actions by status. Pure.

import type { StatusDef } from '../settings';
import { compareCards, isToday } from '../model/actions';
import { daysBetween, parseMtmDate, type Ymd } from '../model/dates';
import type { ReviewInfo } from '../model/matters';
import type { ActionItem } from './actionItems';

/** Closed sections show Actions completed in this many days (today counts as day 1) until "Show all". */
export const OVERVIEW_DONE_DAYS = 30;

export interface OverviewSection {
	status: StatusDef;
	items: ActionItem[];
	/** Closed Actions left out by the window ("Show all N"). */
	hidden: number;
}

export interface OverviewStats {
	open: number;
	/** Due today or overdue, not closed. */
	today: number;
	waiting: number;
	closed: number;
	total: number;
}

export interface OverviewModel {
	stats: OverviewStats;
	/** Statuses in workflow order; empty ones are left out. */
	sections: OverviewSection[];
}

const completedDay = (item: ActionItem): Ymd | null => parseMtmDate(item.completed)?.date ?? null;

/** Most recently completed first; those without a completion date last, by title. */
function compareClosed(a: ActionItem, b: ActionItem): number {
	const ca = completedDay(a);
	const cb = completedDay(b);
	if (ca !== cb) return ca === null ? 1 : cb === null ? -1 : cb.localeCompare(ca);
	return a.title.localeCompare(b.title);
}

/** `items` are the Matter's Actions (by effective Matter). */
export function overviewModel(items: readonly ActionItem[], statuses: readonly StatusDef[], now: Date, today: Ymd, showAllDone: boolean): OverviewModel {
	const stats: OverviewStats = { open: 0, today: 0, waiting: 0, closed: 0, total: items.length };
	for (const item of items) {
		if (item.category === 'closed') stats.closed++;
		else stats.open++;
		if (isToday(item.due, item.category, now)) stats.today++;
		if (item.waitingOn !== null) stats.waiting++;
	}

	const sections: OverviewSection[] = [];
	for (const status of statuses) {
		const mine = items.filter((i) => i.effective.status.id === status.id);
		if (!mine.length) continue;
		if (status.category !== 'closed') {
			sections.push({ status, items: [...mine].sort((a, b) => compareCards(a, b)), hidden: 0 });
			continue;
		}
		const sorted = [...mine].sort(compareClosed);
		const recent = sorted.filter((i) => {
			const day = completedDay(i);
			return day !== null && daysBetween(day, today) < OVERVIEW_DONE_DAYS;
		});
		const shown = showAllDone ? sorted : recent;
		sections.push({ status, items: shown, hidden: sorted.length - shown.length });
	}
	return { stats, sections };
}

export type ReviewState = 'ontime' | 'overdue' | 'never';

/** Never reviewed counts as due (it shows as "Not reviewed"); overdue counts the days since the review fell due. */
export function reviewState(review: ReviewInfo, today: Ymd): { state: ReviewState; daysLate: number } {
	if (review.lastReviewed === null) return { state: 'never', daysLate: 0 };
	if (!review.due || !review.nextDue) return { state: 'ontime', daysLate: 0 };
	return { state: 'overdue', daysLate: Math.max(0, daysBetween(review.nextDue, today)) };
}
