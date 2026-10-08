// What the calendar shows: the month grid, where each Action goes, bar rows per week, and drag shifts. Pure.

import { addDays, daysBetween, weekday, type MtmDate, type Ymd } from '../model/dates';
import { compareCards } from '../model/actions';
import type { ActionItem } from './actionItems';

/** Chips shown in a day before "N more" (bars and their spacers count). */
export const DAY_CHIPS = 3;

export type WeekStart = 'monday' | 'sunday';

/** The first day of the month containing `ymd`. */
export function monthOf(ymd: Ymd): Ymd {
	return `${ymd.slice(0, 7)}-01`;
}

/** The first day of the month `n` months after `month` (a first day). */
export function addMonthsTo(month: Ymd, n: number): Ymd {
	const [y = 2000, m = 1] = month.split('-').map(Number);
	const index = y * 12 + (m - 1) + n;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** Whole weeks covering the month, starting on the week start. */
export function monthWeeks(month: Ymd, weekStart: WeekStart): Ymd[][] {
	const first = monthOf(month);
	const startDay = weekStart === 'monday' ? 1 : 0;
	const lead = (weekday(first) - startDay + 7) % 7;
	let day = addDays(first, -lead);
	const next = addMonthsTo(first, 1);
	const weeks: Ymd[][] = [];
	while (day < next) {
		const week: Ymd[] = [];
		for (let i = 0; i < 7; i++) {
			week.push(day);
			day = addDays(day, 1);
		}
		weeks.push(week);
	}
	return weeks;
}

/** Days an Action covers: start → due; start only or due only is one day; start after due goes by due only. */
export function placement(item: Pick<ActionItem, 'start' | 'due'>): { from: Ymd; to: Ymd } | null {
	const { start, due } = item;
	if (start && due) return start.date <= due.date ? { from: start.date, to: due.date } : { from: due.date, to: due.date };
	const only = due ?? start;
	return only ? { from: only.date, to: only.date } : null;
}

export type DayEntry =
	| { kind: 'span'; item: ActionItem; pos: 'start' | 'mid' | 'end'; label: boolean }
	| { kind: 'slot' }
	| { kind: 'single'; item: ActionItem };

export interface CalendarDay {
	date: Ymd;
	inMonth: boolean;
	isToday: boolean;
	isWeekend: boolean;
	/** Bars (with spacers that keep each bar in its row), then all-day, then timed Actions. */
	entries: DayEntry[];
	/** Every Action on the day, in entry order. */
	items: ActionItem[];
}

/** The time shown for a single-day Action: the due time, or the start time when it has only a start. */
function timeOf(item: ActionItem): string | null {
	return (item.due ?? item.start)?.time ?? null;
}

function compareSingles(a: ActionItem, b: ActionItem): number {
	const ta = timeOf(a);
	const tb = timeOf(b);
	if (!ta !== !tb) return ta ? 1 : -1;
	if (ta && tb && ta !== tb) return ta.localeCompare(tb);
	return compareCards(a, b);
}

export function buildCalendar(items: readonly ActionItem[], weeks: readonly Ymd[][], month: Ymd, today: Ymd): CalendarDay[][] {
	const placed = items.flatMap((item) => {
		const p = placement(item);
		return p ? [{ item, ...p }] : [];
	});
	const spans = placed.filter((p) => p.from < p.to);
	const singles = placed.filter((p) => p.from === p.to);
	const inMonth = month.slice(0, 7);

	return weeks.map((week) => {
		const first = week[0] ?? '';
		const last = week[week.length - 1] ?? '';
		// Bars in this week, longest first among those starting together, each in the first free row.
		const mine = spans
			.filter((s) => s.from <= last && s.to >= first)
			.sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to) || compareCards(a.item, b.item));
		const rows: { to: Ymd; span: (typeof mine)[number] }[][] = [];
		const rowOf = new Map<(typeof mine)[number], number>();
		for (const span of mine) {
			const from = span.from < first ? first : span.from;
			let row = rows.findIndex((r) => r.every((x) => x.to < from || x.span.from > (span.to > last ? last : span.to)));
			if (row < 0) row = rows.push([]) - 1;
			rows[row]?.push({ to: span.to > last ? last : span.to, span });
			rowOf.set(span, row);
		}

		return week.map((date, col) => {
			const entries: DayEntry[] = [];
			const active = mine.filter((s) => s.from <= date && s.to >= date);
			const used = Math.max(-1, ...active.map((s) => rowOf.get(s) ?? 0));
			for (let r = 0; r <= used; r++) {
				const span = active.find((s) => rowOf.get(s) === r);
				if (!span) {
					entries.push({ kind: 'slot' });
					continue;
				}
				const pos = date === span.from ? 'start' : date === span.to ? 'end' : 'mid';
				entries.push({ kind: 'span', item: span.item, pos, label: pos === 'start' || col === 0 });
			}
			const day = singles
				.filter((s) => s.from === date)
				.map((s) => s.item)
				.sort(compareSingles);
			for (const item of day) entries.push({ kind: 'single', item });
			const dow = weekday(date);
			return {
				date,
				inMonth: date.slice(0, 7) === inMonth,
				isToday: date === today,
				isWeekend: dow === 0 || dow === 6,
				entries,
				items: entries.flatMap((e) => (e.kind === 'slot' ? [] : [e.item])),
			};
		});
	});
}

/** Dates after dragging from `fromDay` to `toDay`: both move by the same days, so a span keeps its length; times stay. */
export function shiftDates(start: MtmDate | null, due: MtmDate | null, fromDay: Ymd, toDay: Ymd): { start: MtmDate | null; due: MtmDate | null } {
	const delta = daysBetween(fromDay, toDay);
	const move = (d: MtmDate | null): MtmDate | null => (d ? { ...d, date: addDays(d.date, delta) } : null);
	return { start: move(start), due: move(due) };
}

