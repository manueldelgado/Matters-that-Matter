// Review session: which Matters come up, what one Matter's step shows, and the end screen's tally. Pure.

import type { StatusDef } from '../settings';
import { addDays, isOverdue, parseMtmDate, toYmd, type Ymd } from '../model/dates';
import { addCadence, type Cadence } from '../model/matters';
import { compareCards, waitAge } from '../model/actions';
import type { ActionItem } from './actionItems';
import type { MatterInfo } from './boardModel';
import { lacksNextAction, nextStepStatus } from './nextAction';
import { NO_SPHERE } from './spheres';

/** Without a last review, "since" covers this many days. */
export const SINCE_FALLBACK_DAYS = 30;

export interface QueueOptions {
	/** "due": Matters whose review is due; "all": every active Matter (dormant ones still only when due). */
	scope: 'due' | 'all';
	/** A Sphere ID, NO_SPHERE for Matters without one, or null for every Sphere. */
	sphere: string | null;
}

/** Never reviewed first, then the longest since the last review; ties by name. */
function overdueFirst(a: MatterInfo, b: MatterInfo): number {
	return (b.review?.daysSince ?? Infinity) - (a.review?.daysSince ?? Infinity) || a.name.localeCompare(b.name);
}

/**
 * The session's Matters: active ones (due, or all of them), most overdue first; then dormant ones whose review is due.
 * Never the Inbox, never closed Matters. With "all", Matters that aren't due follow the due ones in the given order.
 */
export function reviewQueue(matters: readonly MatterInfo[], options: QueueOptions): MatterInfo[] {
	const inSphere = (m: MatterInfo) => options.sphere === null || (m.sphere ?? NO_SPHERE) === options.sphere;
	const candidates = matters.filter((m) => !m.isInbox && inSphere(m));
	const due = (m: MatterInfo) => m.review?.due === true;
	const active = candidates.filter((m) => m.state === 'active');
	const activeDue = active.filter(due).sort(overdueFirst);
	const activeRest = options.scope === 'all' ? active.filter((m) => !due(m)) : [];
	const dormant = candidates.filter((m) => m.state === 'dormant' && due(m)).sort(overdueFirst);
	return [...activeDue, ...activeRest, ...dormant];
}

export interface ReviewStep {
	matter: MatterInfo;
	/** A dormant Matter gets the lighter step. */
	dormant: boolean;
	/** The day "since" counts from: the last review, else SINCE_FALLBACK_DAYS ago. */
	since: Ymd;
	/** Whether `since` is the last review (false: the fallback window). */
	sinceReview: boolean;
	/** Closed with mtm-completed on or after `since`, most recent first. */
	doneSince: ActionItem[];
	/** Not closed and overdue, in card order. */
	overdue: ActionItem[];
	/** Waiting on someone for two weeks or more (not already overdue), the longest first. */
	longWaits: ActionItem[];
	/** An active Matter with nothing in motion. */
	noNextAction: boolean;
	/** Open Actions in the next-step status that "Needs a look" doesn't already show, in card order. */
	next: ActionItem[];
	/** Next-step Actions already shown under "Needs a look", named instead of repeated. */
	nextAbove: ActionItem[];
}

export function reviewStep(matter: MatterInfo, items: readonly ActionItem[], statuses: readonly StatusDef[], now: Date): ReviewStep {
	const today = toYmd(now);
	const mine = items.filter((i) => i.effective.matterPath === matter.path);
	const last = matter.review?.lastReviewed ?? null;
	const since = last ?? addDays(today, -SINCE_FALLBACK_DAYS);

	const doneSince = mine
		.filter((i) => i.category === 'closed')
		.map((i) => ({ i, day: parseMtmDate(i.completed)?.date ?? null }))
		.filter((x): x is { i: ActionItem; day: Ymd } => x.day !== null && x.day >= since)
		.sort((a, b) => b.day.localeCompare(a.day) || a.i.title.localeCompare(b.i.title))
		.map((x) => x.i);

	const open = mine.filter((i) => i.category !== 'closed');
	const overdue = open.filter((i) => isOverdue(i.due, now, false)).sort(compareCards);
	const longWaits = open
		.filter((i) => i.waitingSince && waitAge(i.waitingSince, today).isLong && !overdue.includes(i))
		.sort((a, b) => (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '') || compareCards(a, b));

	const nextStatus = nextStepStatus(statuses);
	const shown = new Set([...overdue, ...longWaits]);
	const nextAll = nextStatus ? open.filter((i) => i.effective.status.id === nextStatus.id).sort(compareCards) : [];

	return {
		matter,
		dormant: matter.state === 'dormant',
		since,
		sinceReview: last !== null,
		doneSince,
		overdue,
		longWaits,
		noNextAction: lacksNextAction(matter, mine),
		next: nextAll.filter((i) => !shown.has(i)),
		nextAbove: nextAll.filter((i) => shown.has(i)),
	};
}

/** Nothing late, nothing stuck. */
export function needsNoLook(step: ReviewStep): boolean {
	return !step.overdue.length && !step.longWaits.length && !step.noNextAction;
}

/** The next review if the Matter is reviewed on `today`; null without a rhythm. */
export function nextReview(cadence: Cadence | null, today: Ymd): Ymd | null {
	return cadence ? addCadence(today, cadence) : null;
}

/** Waits of two weeks or more across every Matter, the longest first. */
export function longWaitsAcross(items: readonly ActionItem[], now: Date): ActionItem[] {
	const today = toYmd(now);
	return items
		.filter((i) => i.category !== 'closed' && i.waitingSince && waitAge(i.waitingSince, today).isLong)
		.sort((a, b) => (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '') || compareCards(a, b));
}

/** What a session did, for the end screen. */
export interface ReviewTally {
	reviewed: number;
	skipped: number;
	woken: number;
	madeDormant: number;
	closed: number;
	nextAdded: number;
	outcomes: number;
}

export function emptyTally(): ReviewTally {
	return { reviewed: 0, skipped: 0, woken: 0, madeDormant: 0, closed: 0, nextAdded: 0, outcomes: 0 };
}

export type TallyKey = keyof ReviewTally;

/** The tally's lines in a fixed order, without zeros. */
export function tallyLines(t: ReviewTally): { key: TallyKey; count: number }[] {
	const order: TallyKey[] = ['reviewed', 'nextAdded', 'outcomes', 'woken', 'madeDormant', 'closed', 'skipped'];
	return order.filter((key) => t[key] > 0).map((key) => ({ key, count: t[key] }));
}
