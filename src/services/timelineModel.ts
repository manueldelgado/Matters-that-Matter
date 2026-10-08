// What the timeline shows: the date range, rows by Matter, bar positions, and drag edits. Pure.

import { addDays, daysBetween, weekday, type MtmDate, type Ymd } from '../model/dates';
import { compareCards } from '../model/actions';
import type { ActionItem } from './actionItems';
import type { MatterInfo } from './boardModel';
import { placement, type WeekStart } from './calendarModel';

/** How far the timeline reaches back and ahead of today. */
const MAX_BACK = 182;
const MAX_AHEAD = 365;

export function weekStartOf(ymd: Ymd, weekStart: WeekStart): Ymd {
	const first = weekStart === 'monday' ? 1 : 0;
	return addDays(ymd, -((weekday(ymd) - first + 7) % 7));
}

/** Where the timeline opens: the start of the week before today. */
export function openingDay(today: Ymd, weekStart: WeekStart): Ymd {
	return addDays(weekStartOf(today, weekStart), -7);
}

export interface TimelineRange {
	from: Ymd;
	days: number;
}

/** Six months back to a year ahead of today, in whole weeks, so there is always room to scroll either way. */
export function timelineRange(today: Ymd, weekStart: WeekStart): TimelineRange {
	const from = weekStartOf(addDays(today, -MAX_BACK), weekStart);
	const to = addDays(today, MAX_AHEAD);
	return { from, days: Math.ceil((daysBetween(from, to) + 1) / 7) * 7 };
}

export interface TimelineRow {
	item: ActionItem;
	/** Day index of the bar's first day in the range, and its length in days (clipped to the range). */
	start: number;
	span: number;
	/** One day: a diamond on the day. */
	milestone: boolean;
}

export interface TimelineGroup {
	matter: MatterInfo;
	rows: TimelineRow[];
}

/** `matters` in lane order. Matters without dated Actions in the range are left out. */
export function buildTimeline(items: readonly ActionItem[], matters: readonly MatterInfo[], range: TimelineRange): TimelineGroup[] {
	const last = range.days - 1;
	const byMatter = new Map<string, TimelineRow[]>();
	for (const item of items) {
		const p = placement(item);
		if (!p) continue;
		const a = daysBetween(range.from, p.from);
		const b = daysBetween(range.from, p.to);
		if (b < 0 || a > last) continue;
		const start = Math.max(0, a);
		const row: TimelineRow = { item, start, span: Math.min(last, b) - start + 1, milestone: p.from === p.to };
		const list = byMatter.get(item.effective.matterPath) ?? [];
		list.push(row);
		byMatter.set(item.effective.matterPath, list);
	}
	const groups: TimelineGroup[] = [];
	for (const matter of matters) {
		const rows = byMatter.get(matter.path);
		if (!rows?.length) continue;
		rows.sort((x, y) => x.start - y.start || x.start + x.span - (y.start + y.span) || compareCards(x.item, y.item));
		groups.push({ matter, rows });
	}
	return groups;
}

export type DragEdge = 'move' | 'start' | 'end';

const shift = (d: MtmDate, days: number): MtmDate => ({ ...d, date: addDays(d.date, days) });

/**
 * Dates after dragging a bar by `days`: moving shifts both; pulling the start or the end changes only that date,
 * never past the other one. Times are kept. Only dates the Action has are returned.
 */
export function dragDates(start: MtmDate | null, due: MtmDate | null, edge: DragEdge, days: number): { start?: MtmDate; due?: MtmDate } {
	if (edge === 'move') return { ...(start ? { start: shift(start, days) } : {}), ...(due ? { due: shift(due, days) } : {}) };
	if (!start || !due) return {};
	if (edge === 'start') {
		const next = shift(start, days);
		return { start: next.date > due.date ? { ...next, date: due.date } : next };
	}
	const next = shift(due, days);
	return { due: next.date < start.date ? { ...next, date: start.date } : next };
}
