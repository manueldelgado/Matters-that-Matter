// Action rules: priority, derived values, card order and done visibility.

import type { StatusCategory } from '../settings';
import { STRINGS } from '../strings';
import { compareMtmDates, daysBetween, parseMtmDate, toYmd, type MtmDate, type Ymd } from './dates';

export type Priority = 1 | 2 | 3;

/** 1 high, 2 medium, 3 low; anything else means no priority. */
export function parsePriority(raw: unknown): Priority | null {
	const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
	return n === 1 || n === 2 || n === 3 ? n : null;
}

function hasValue(raw: unknown): boolean {
	if (raw === undefined || raw === null) return false;
	if (typeof raw === 'string') return raw.trim() !== '';
	if (Array.isArray(raw)) return raw.some(hasValue);
	return true;
}

/** Has mtm-waiting-on and is not closed. */
export function isWaiting(waitingOn: unknown, category: StatusCategory): boolean {
	return category !== 'closed' && hasValue(waitingOn);
}

/** Due today or overdue, and not closed. */
export function isToday(due: MtmDate | null, category: StatusCategory, now: Date): boolean {
	return category !== 'closed' && !!due && due.date <= toYmd(now);
}

/** Waits of this many days or more are highlighted (never in the overdue red). */
export const LONG_WAIT_DAYS = 14;

export interface WaitAge {
	days: number;
	/** "today", "10 days", "3 weeks", "2 months". */
	long: string;
	/** "today", "10d", "3w", "2mo". */
	short: string;
	isLong: boolean;
}

/** Days under two weeks, then whole weeks under about two months, then whole months. A future date counts as today. */
export function waitAge(since: Ymd, today: Ymd): WaitAge {
	const days = Math.max(0, daysBetween(since, today));
	const [unit, n] = days === 0 ? (['today', 0] as const) : days < LONG_WAIT_DAYS ? (['days', days] as const) : days < 60 ? (['weeks', Math.floor(days / 7)] as const) : (['months', Math.floor(days / 30)] as const);
	return { days, long: STRINGS.waitAge.long(unit, n), short: STRINGS.waitAge.short(unit, n), isLong: days >= LONG_WAIT_DAYS };
}

export interface CardKey {
	title: string;
	priority: Priority | null;
	due: MtmDate | null;
}

/** Priority (1 first, none last), then due date (soonest first, undated last), then title. */
export function compareCards(a: CardKey, b: CardKey): number {
	const pa = a.priority ?? 4, pb = b.priority ?? 4;
	if (pa !== pb) return pa - pb;
	if (a.due && b.due) {
		const d = compareMtmDates(a.due, b.due);
		if (d !== 0) return d;
	} else if (a.due || b.due) {
		return a.due ? -1 : 1;
	}
	return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
}

/** Closed ÷ all Actions; 0 for a Matter without Actions. */
export function progress(categories: readonly StatusCategory[]): { closed: number; total: number; ratio: number } {
	const closed = categories.filter((c) => c === 'closed').length;
	const total = categories.length;
	return { closed, total, ratio: total ? closed / total : 0 };
}

// ——— Show done ———

export type ShowDoneOption = 'inherit' | 'show' | 'hide';

export function resolveShowDone(option: unknown, globalShowDone: boolean): boolean {
	return option === 'show' ? true : option === 'hide' ? false : globalShowDone;
}

export type InboxOption = 'inherit' | 'top' | 'bottom' | 'hidden';

export function resolveInboxPosition(option: unknown, globalDefault: 'top' | 'bottom'): 'top' | 'bottom' | 'hidden' {
	return option === 'top' || option === 'bottom' || option === 'hidden' ? option : globalDefault;
}

/**
 * Whether an Action is shown, given Show done and the optional "last N days" window.
 * The window counts today as day 1 and hides closed Actions without mtm-completed.
 */
export function isShownByDone(
	category: StatusCategory,
	completedRaw: unknown,
	showDone: boolean,
	lastDays: number | null,
	today: Ymd,
): boolean {
	if (category !== 'closed') return true;
	if (!showDone) return false;
	if (lastDays === null) return true;
	const completed = parseMtmDate(completedRaw);
	if (!completed) return false;
	return daysBetween(completed.date, today) < lastDays;
}
