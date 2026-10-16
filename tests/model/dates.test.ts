import { describe, expect, it } from 'vitest';
import {
	addDays,
	fromInputs,
	addMonths,
	compareMtmDates,
	dateLabel,
	dayLabel,
	shortDate,
	daysBetween,
	formatMtmDate,
	isOverdue,
	parseMtmDate,
	readFigureDate,
	startsAfterDue,
	wallClock,
	weekday,
} from '../../src/model/dates';

describe('parseMtmDate', () => {
	it('reads all-day values', () => {
		expect(parseMtmDate('2026-10-15')).toEqual({ date: '2026-10-15' });
	});

	it('reads timed values', () => {
		expect(parseMtmDate('2026-10-15T10:00')).toEqual({ date: '2026-10-15', time: '10:00' });
	});

	it('accepts seconds and a space separator', () => {
		expect(parseMtmDate('2026-10-20T17:57:00')).toEqual({ date: '2026-10-20', time: '17:57' });
		expect(parseMtmDate('2026-10-16 09:00')).toEqual({ date: '2026-10-16', time: '09:00' });
		expect(parseMtmDate(' 2026-10-16T09:00:00.000 ')).toEqual({ date: '2026-10-16', time: '09:00' });
	});

	it('rejects an impossible time, seconds included, as quick add does', () => {
		for (const raw of ['2026-10-16T10:00:99', '2026-10-16T10:00:60', '2026-10-16T10:60', '2026-10-16T24:00']) {
			expect(parseMtmDate(raw)).toBeNull();
			expect(readFigureDate(raw)).toEqual({ problem: 'not-a-day' });
		}
		expect(parseMtmDate('2026-10-16T23:59:59')).toEqual({ date: '2026-10-16', time: '23:59' });
	});

	it('rejects invalid values', () => {
		for (const raw of ['2026-02-30', '2026-13-01', '2026-10-15T24:00', '15/10/2026', '', 'tomorrow', 20261015, null, undefined, ['2026-10-15']]) {
			expect(parseMtmDate(raw)).toBeNull();
		}
	});

	it('accepts 29 February in leap years only', () => {
		expect(parseMtmDate('2028-02-29')).not.toBeNull();
		expect(parseMtmDate('2026-02-29')).toBeNull();
	});
});

describe('formatMtmDate', () => {
	it('writes exactly the two stored forms', () => {
		expect(formatMtmDate({ date: '2026-10-15' })).toBe('2026-10-15');
		expect(formatMtmDate({ date: '2026-10-15', time: '10:00' })).toBe('2026-10-15T10:00');
	});

	it('round-trips with parseMtmDate', () => {
		for (const raw of ['2026-10-15', '2026-10-15T10:00']) expect(formatMtmDate(parseMtmDate(raw)!)).toBe(raw);
	});
});

describe('day arithmetic', () => {
	it('adds days across months, years and daylight saving changes', () => {
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('adds calendar months, clamping to the end of the month', () => {
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
		expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
	});

	it('counts days between dates', () => {
		expect(daysBetween('2026-10-09', '2026-10-15')).toBe(6);
		expect(daysBetween('2026-10-15', '2026-10-09')).toBe(-6);
	});

	it('knows the weekday', () => {
		expect(weekday('2026-10-09')).toBe(5);
	});
});

describe('compareMtmDates', () => {
	it('sorts all-day before timed on the same day', () => {
		expect(compareMtmDates({ date: '2026-10-15' }, { date: '2026-10-15', time: '08:00' })).toBeLessThan(0);
	});

	it('sorts by date, then time', () => {
		expect(compareMtmDates({ date: '2026-10-14', time: '23:00' }, { date: '2026-10-15' })).toBeLessThan(0);
		expect(compareMtmDates({ date: '2026-10-15', time: '10:00' }, { date: '2026-10-15', time: '09:00' })).toBeGreaterThan(0);
		expect(compareMtmDates({ date: '2026-10-15' }, { date: '2026-10-15' })).toBe(0);
	});
});

describe('isOverdue', () => {
	const now = new Date(2026, 9, 9, 12, 0);

	it('all day: overdue from the next day', () => {
		expect(isOverdue({ date: '2026-10-08' }, now, false)).toBe(true);
		expect(isOverdue({ date: '2026-10-09' }, now, false)).toBe(false);
	});

	it('timed: overdue once the time has passed', () => {
		expect(isOverdue({ date: '2026-10-09', time: '11:59' }, now, false)).toBe(true);
		expect(isOverdue({ date: '2026-10-09', time: '12:01' }, now, false)).toBe(false);
	});

	it('never for closed Actions or without a due date', () => {
		expect(isOverdue({ date: '2026-10-01' }, now, true)).toBe(false);
		expect(isOverdue(null, now, false)).toBe(false);
	});
});

describe('startsAfterDue', () => {
	it('flags a start after the due date', () => {
		expect(startsAfterDue({ date: '2026-10-16' }, { date: '2026-10-15' })).toBe(true);
		expect(startsAfterDue({ date: '2026-10-15' }, { date: '2026-10-15' })).toBe(false);
		expect(startsAfterDue(null, { date: '2026-10-15' })).toBe(false);
	});
});

describe('labels', () => {
	const today = '2026-10-09'; // Friday

	it('uses Today, Tomorrow and weekdays within six days', () => {
		expect(dayLabel('2026-10-09', today)).toBe('Today');
		expect(dayLabel('2026-10-10', today)).toBe('Tomorrow');
		expect(dayLabel('2026-10-11', today)).toBe('Sunday');
		expect(dayLabel('2026-10-15', today)).toBe('Thursday');
	});

	it('uses Yesterday for the day before', () => {
		expect(dayLabel('2026-10-08', today)).toBe('Yesterday');
	});

	it('uses the short form beyond six days and further in the past', () => {
		expect(dayLabel('2026-10-16', today)).toBe('Fri 16 Oct');
		expect(dayLabel('2026-10-07', today)).toBe('Wed 7 Oct');
	});

	it('adds the year outside the current year', () => {
		expect(dayLabel('2027-01-05', today)).toBe('Tue 5 Jan 2027');
	});

	it('adds the time for timed values', () => {
		expect(dateLabel({ date: '2026-10-10', time: '10:00' }, today)).toBe('Tomorrow 10:00');
		expect(dateLabel({ date: '2026-10-10' }, today)).toBe('Tomorrow');
	});
});

describe('fromInputs', () => {
	it('builds all-day and timed values', () => {
		expect(fromInputs('2026-10-15', '')).toEqual({ date: '2026-10-15' });
		expect(fromInputs('2026-10-15', '09:30')).toEqual({ date: '2026-10-15', time: '09:30' });
	});

	it('gives null without a valid date, and ignores an invalid time', () => {
		expect(fromInputs('', '09:30')).toBeNull();
		expect(fromInputs('2026-02-30', '')).toBeNull();
		expect(fromInputs('2026-10-15', '25:00')).toEqual({ date: '2026-10-15' });
	});
});

describe('shortDate', () => {
	it('is the day and short month, with the year when not this year', () => {
		expect(shortDate('2026-09-23', '2026-10-10')).toBe('23 Sep');
		expect(shortDate('2026-10-09', '2026-10-10')).toBe('9 Oct');
		expect(shortDate('2025-12-30', '2026-01-02')).toBe('30 Dec 2025');
	});
});

describe('readFigureDate', () => {
	it.each([
		['2026-10-16', { date: '2026-10-16' }],
		['2026/10/16', { date: '2026-10-16' }],
		['2026-1-5', { date: '2026-01-05' }],
		['2026-10-16T10:00', { date: '2026-10-16', time: '10:00' }],
		['2026-10-16 9:05', { date: '2026-10-16', time: '09:05' }],
		['2026-10-16T10:00:59.5', { date: '2026-10-16', time: '10:00' }],
		['2028-02-29', { date: '2028-02-29' }],
	])('%j names a real day', (text, date) => {
		expect(readFigureDate(text)).toEqual({ date });
	});

	it.each(['2026-13-12', '2026-00-10', '2026-10-32', '2026-02-29', '2026-10-16T24:00', '2026-10-16T10:60', '2026-10-16T10:00:60'])('%j names no real day or time', (text) => {
		expect(readFigureDate(text)).toEqual({ problem: 'not-a-day' });
	});

	it.each(['2026-10-16T10:00Z', '2026-10-16T10:00z', '2026-10-16T10:00+05:00', '2026-10-16T10:00-0800', '2026-10-16T10:00+02', '2026-13-12T10:00Z'])('%j has a time zone', (text) => {
		expect(readFigureDate(text)).toEqual({ problem: 'time-zone' });
	});

	it.each(['', 'friday', '16/10/2026', '2026-10', '26-10-16', '2026-10-16 at 10', '2026-10-16T10'])('%j is not a date in figures', (text) => {
		expect(readFigureDate(text)).toBeNull();
	});
});

describe('wallClock', () => {
	const fields = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
	// 23:30 UTC on 13 October 2026.
	const instant = new Date(Date.UTC(2026, 9, 13, 23, 30));

	it('without a zone, the same moment', () => {
		expect(wallClock(instant)).toBe(instant);
	});

	it.each([
		['UTC', [2026, 10, 13, 23, 30]],
		['Europe/Madrid', [2026, 10, 14, 1, 30]],
		['America/New_York', [2026, 10, 13, 19, 30]],
		['Asia/Kolkata', [2026, 10, 14, 5, 0]],
	])('%s: the local fields show that zone’s wall clock', (zone, expected) => {
		expect(fields(wallClock(instant, zone))).toEqual(expected);
	});

	it('across a daylight-saving change', () => {
		// Madrid goes back from 03:00 to 02:00 on 25 October 2026 (01:00 UTC).
		expect(fields(wallClock(new Date(Date.UTC(2026, 9, 25, 0, 30)), 'Europe/Madrid'))).toEqual([2026, 10, 25, 2, 30]);
		expect(fields(wallClock(new Date(Date.UTC(2026, 9, 25, 1, 30)), 'Europe/Madrid'))).toEqual([2026, 10, 25, 2, 30]);
		expect(fields(wallClock(new Date(Date.UTC(2026, 9, 25, 2, 30)), 'Europe/Madrid'))).toEqual([2026, 10, 25, 3, 30]);
	});
});
