import { describe, expect, it } from 'vitest';
import {
	addDays,
	addMonths,
	compareMtmDates,
	dateLabel,
	dayLabel,
	daysBetween,
	formatMtmDate,
	isOverdue,
	parseMtmDate,
	startsAfterDue,
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
