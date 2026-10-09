// "What matters today?": what the panel in a new tab shows. Pure.

import type { StatusDef } from '../settings';
import { isOverdue, toYmd } from '../model/dates';
import { compareCards, isToday, waitAge } from '../model/actions';
import type { ActionItem } from './actionItems';
import type { MatterInfo } from './boardModel';
import { nextStepStatus } from './nextAction';

/** Cards shown before "N more on the board". */
export const TODAY_CARDS = 6;

export interface TodayInput {
	items: readonly ActionItem[];
	matters: readonly MatterInfo[];
	statuses: readonly StatusDef[];
	inboxPath: string;
	now: Date;
}

export interface TodayModel {
	/** Due today or late, not closed, in card order. */
	due: ActionItem[];
	/** Not late yet (a timed Action whose time has passed is late, as its card shows). */
	dueToday: number;
	late: number;
	/** With nothing due: the first open status after the backlog, and its open Actions in card order. */
	nextStatus: StatusDef | null;
	next: ActionItem[];
	/** Open Actions in the Inbox (the ribbon's count). */
	inbox: number;
	/** Active Matters whose review is due, never-reviewed ones with a cadence included; most overdue first. */
	reviews: MatterInfo[];
	/** Open Actions waiting on someone, the longest wait first. */
	waiting: ActionItem[];
	/** Waits of two weeks or more. */
	longWaits: number;
}

export function todayModel(input: TodayInput): TodayModel {
	const { items, now } = input;
	const today = toYmd(now);
	const open = items.filter((i) => i.category !== 'closed');

	const due = open.filter((i) => isToday(i.due, i.category, now)).sort(compareCards);
	const late = due.filter((i) => isOverdue(i.due, now, false)).length;

	const nextStatus = nextStepStatus(input.statuses);
	const next = due.length || !nextStatus ? [] : open.filter((i) => i.effective.status.id === nextStatus.id).sort(compareCards);

	const reviews = input.matters
		.filter((m) => !m.isInbox && m.state === 'active' && m.review?.due)
		.sort((a, b) => (b.review?.daysSince ?? Infinity) - (a.review?.daysSince ?? Infinity) || a.name.localeCompare(b.name));

	const waiting = open
		.filter((i) => i.waitingOn)
		.sort((a, b) => (a.waitingSince ?? '9999').localeCompare(b.waitingSince ?? '9999') || compareCards(a, b));
	const longWaits = waiting.filter((i) => i.waitingSince && waitAge(i.waitingSince, today).isLong).length;

	return {
		due,
		dueToday: due.length - late,
		late,
		nextStatus,
		next,
		inbox: open.filter((i) => i.effective.matterPath === input.inboxPath).length,
		reviews,
		waiting,
		longWaits,
	};
}
