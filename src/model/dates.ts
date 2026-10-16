// Dates as stored in mtm-start and mtm-due: 'YYYY-MM-DD' (all day) or 'YYYY-MM-DDTHH:mm' (timed).
// Day arithmetic works on 'YYYY-MM-DD' strings through UTC, so daylight saving never shifts a day.

import { STRINGS } from '../strings';

/** A calendar day, 'YYYY-MM-DD'. */
export type Ymd = string;

export interface MtmDate {
	date: Ymd;
	/** 'HH:mm'; absent for all-day values. */
	time?: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Days in a month (1–12) of a year. */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses a raw frontmatter value. Accepts seconds and a space separator; anything else, or no real day or time, is null. */
export function parseMtmDate(raw: unknown): MtmDate | null {
	if (typeof raw !== 'string') return null;
	const m = DATE_RE.exec(raw.trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, s] = m;
	const year = Number(y), month = Number(mo), day = Number(d);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	const date = `${y}-${mo}-${d}`;
	if (h === undefined || mi === undefined) return { date };
	if (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return null;
	return { date, time: `${h}:${mi}` };
}

/** Why a date as typed isn't read: it names no real day or time, or it carries a time zone (dates are local). */
export type DateProblem = 'not-a-day' | 'time-zone';

const FIGURE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * A date written in figures, year first ('2026-10-16', '2026/10/16', '2026-1-5', with an optional time): the date it
 * names, or why it can't be read. Null when the text isn't one. Quick add and the operations share this rule; the
 * operations' fields further require a stored form (`parseMtmDate`).
 */
export function readFigureDate(text: string): { date: MtmDate } | { problem: DateProblem } | null {
	const m = FIGURE_RE.exec(text.trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, s, zone] = m;
	if (zone) return { problem: 'time-zone' };
	const year = Number(y), month = Number(mo), day = Number(d);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return { problem: 'not-a-day' };
	const date = `${y}-${pad(month)}-${pad(day)}`;
	if (h === undefined || mi === undefined) return { date: { date } };
	if (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return { problem: 'not-a-day' };
	return { date: { date, time: `${pad(Number(h))}:${mi}` } };
}

/**
 * The wall-clock time in a time zone (an IANA name), as a Date whose local fields show it; `now` itself without one.
 * Date rules read the local fields, so a zone given here makes "today" and "now" that zone's, whatever the host's.
 */
export function wallClock(now: Date, timeZone?: string): Date {
	if (!timeZone) return now;
	const parts: Record<string, number> = {};
	for (const p of zoneFormat(timeZone).formatToParts(now)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
	return new Date(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, now.getMilliseconds());
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(timeZone: string): Intl.DateTimeFormat {
	let f = zoneFormats.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
		zoneFormats.set(timeZone, f);
	}
	return f;
}

/** The exact form the plugin writes. */
export function formatMtmDate(d: MtmDate): string {
	return d.time ? `${d.date}T${d.time}` : d.date;
}

/** The local calendar day of a Date. */
export function toYmd(date: Date): Ymd {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local time of a Date, 'HH:mm'. */
export function toHm(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ymdToUtc(ymd: Ymd): number {
	const [y, m, d] = ymd.split('-').map(Number);
	return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function utcToYmd(ms: number): Ymd {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(ymd: Ymd, days: number): Ymd {
	return utcToYmd(ymdToUtc(ymd) + days * 86_400_000);
}

/** Adds calendar months, clamping to the last day of the month (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(ymd: Ymd, months: number): Ymd {
	const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
	const total = y * 12 + (m - 1) + months;
	const year = Math.floor(total / 12), month = (total % 12) + 1;
	return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: Ymd, b: Ymd): number {
	return Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(ymd: Ymd): number {
	return new Date(ymdToUtc(ymd)).getUTCDay();
}

/** Orders dates; an all-day value sorts as midnight, before a timed value on the same day. */
export function compareMtmDates(a: MtmDate, b: MtmDate): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	const at = a.time ?? '', bt = b.time ?? '';
	return at === bt ? 0 : at < bt ? -1 : 1;
}

/** Date-only: due before today. Timed: due time has passed. Never for closed Actions. */
export function isOverdue(due: MtmDate | null, now: Date, closed: boolean): boolean {
	if (!due || closed) return false;
	const today = toYmd(now);
	if (!due.time) return due.date < today;
	return due.date < today || (due.date === today && due.time < toHm(now));
}

/** Start after due gets a warning in the inspector; nothing is rewritten. */
export function startsAfterDue(start: MtmDate | null, due: MtmDate | null): boolean {
	return !!start && !!due && compareMtmDates(start, due) > 0;
}

/** "Today", "Tomorrow", "Yesterday", a weekday within the next 6 days, otherwise "Tue 20 Oct" (with the year if not this year). */
export function dayLabel(ymd: Ymd, today: Ymd): string {
	const diff = daysBetween(today, ymd);
	const { dates } = STRINGS;
	if (diff === 0) return dates.today;
	if (diff === 1) return dates.tomorrow;
	if (diff === -1) return dates.yesterday;
	const wd = weekday(ymd);
	if (diff > 1 && diff <= 6) return dates.weekdays[wd] ?? '';
	const [y, m = 1, d = 1] = ymd.split('-').map(Number);
	const label = `${dates.weekdaysShort[wd] ?? ''} ${d} ${dates.monthsShort[m - 1] ?? ''}`;
	return ymd.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${y}`;
}

/** "23 Sep", with the year when it is not this year ("23 Sep 2025"). */
export function shortDate(ymd: Ymd, today: Ymd): string {
	const [y, m = 1, d = 1] = ymd.split('-').map(Number);
	const label = `${d} ${STRINGS.dates.monthsShort[m - 1] ?? ''}`;
	return ymd.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${y}`;
}

/** The day label, followed by the time for timed values: "Tomorrow 10:00". */
export function dateLabel(d: MtmDate, today: Ymd): string {
	const day = dayLabel(d.date, today);
	return d.time ? `${day} ${d.time}` : day;
}

/**
 * A date from the inspector's inputs: 'YYYY-MM-DD' and optional 'HH:mm'.
 * An empty or invalid date gives null; an empty or invalid time gives an all-day value.
 */
export function fromInputs(date: string, time: string): MtmDate | null {
	const day = parseMtmDate(date);
	if (!day || day.time) return null;
	const timed = time.trim() ? parseMtmDate(`${day.date}T${time.trim()}`) : null;
	return timed ?? day;
}
