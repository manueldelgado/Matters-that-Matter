import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { addMonthsTo, buildCalendar, monthOf, monthWeeks, placement, shiftDates, type DayEntry } from '../../src/services/calendarModel';

const resolve = () => null;
const action = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', 'mtm-status': 'next', ...fm }, DEFAULT_SETTINGS, resolve);

describe('months', () => {
	it('finds the month and moves between months', () => {
		expect(monthOf('2026-10-08')).toBe('2026-10-01');
		expect(addMonthsTo('2026-10-01', 3)).toBe('2027-01-01');
		expect(addMonthsTo('2026-01-01', -1)).toBe('2025-12-01');
	});

	it('covers the month with whole weeks from the week start', () => {
		const monday = monthWeeks('2026-10-01', 'monday');
		expect(monday).toHaveLength(5);
		expect(monday[0]?.[0]).toBe('2026-09-28');
		expect(monday[4]?.[6]).toBe('2026-11-01');
		const sunday = monthWeeks('2026-10-01', 'sunday');
		expect(sunday[0]?.[0]).toBe('2026-09-27');
		expect(monthWeeks('2026-08-01', 'monday')).toHaveLength(6);
	});
});

describe('placement', () => {
	it('spans start to due, else one day; start after due goes by due', () => {
		expect(placement(action('a', { 'mtm-start': '2026-10-12', 'mtm-due': '2026-10-15' }))).toEqual({ from: '2026-10-12', to: '2026-10-15' });
		expect(placement(action('b', { 'mtm-start': '2026-10-12' }))).toEqual({ from: '2026-10-12', to: '2026-10-12' });
		expect(placement(action('c', { 'mtm-due': '2026-10-15T10:00' }))).toEqual({ from: '2026-10-15', to: '2026-10-15' });
		expect(placement(action('d', { 'mtm-start': '2026-10-20', 'mtm-due': '2026-10-15' }))).toEqual({ from: '2026-10-15', to: '2026-10-15' });
		expect(placement(action('e', {}))).toBeNull();
	});
});

const kinds = (entries: DayEntry[]) => entries.map((e) => (e.kind === 'slot' ? 'slot' : `${e.kind}:${e.item.title}${e.kind === 'span' ? ':' + e.pos + (e.label ? '+' : '') : ''}`));

describe('buildCalendar', () => {
	const weeks = monthWeeks('2026-10-01', 'monday');
	const day = (cal: ReturnType<typeof buildCalendar>, date: string) => cal.flat().find((d) => d.date === date);

	it('orders bars, then all-day, then timed by time', () => {
		const cal = buildCalendar(
			[
				action('Dentist', { 'mtm-due': '2026-10-14T09:30' }),
				action('Plumber', { 'mtm-due': '2026-10-14T08:00' }),
				action('Handles', { 'mtm-due': '2026-10-14' }),
				action('Brief', { 'mtm-start': '2026-10-12', 'mtm-due': '2026-10-15' }),
			],
			weeks,
			'2026-10-01',
			'2026-10-08',
		);
		expect(kinds(day(cal, '2026-10-14')?.entries ?? [])).toEqual(['span:Brief:mid', 'single:Handles', 'single:Plumber', 'single:Dentist']);
		expect(kinds(day(cal, '2026-10-12')?.entries ?? [])).toEqual(['span:Brief:start+']);
		expect(day(cal, '2026-10-08')).toMatchObject({ isToday: true, inMonth: true, isWeekend: false });
		expect(day(cal, '2026-09-28')).toMatchObject({ inMonth: false });
		expect(day(cal, '2026-10-10')).toMatchObject({ isWeekend: true });
	});

	it('labels a bar again at the start of each week row', () => {
		const cal = buildCalendar([action('Trip', { 'mtm-start': '2026-10-16', 'mtm-due': '2026-10-20' })], weeks, '2026-10-01', '2026-10-08');
		expect(kinds(day(cal, '2026-10-18')?.entries ?? [])).toEqual(['span:Trip:mid']);
		expect(kinds(day(cal, '2026-10-19')?.entries ?? [])).toEqual(['span:Trip:mid+']);
		expect(kinds(day(cal, '2026-10-20')?.entries ?? [])).toEqual(['span:Trip:end']);
	});

	it('gives bars rows per week, reusing a row once it is free, with spacers to keep rows', () => {
		const cal = buildCalendar(
			[
				action('Long', { 'mtm-start': '2026-10-12', 'mtm-due': '2026-10-17' }),
				action('Early', { 'mtm-start': '2026-10-13', 'mtm-due': '2026-10-14' }),
				action('Late', { 'mtm-start': '2026-10-16', 'mtm-due': '2026-10-18' }),
			],
			weeks,
			'2026-10-01',
			'2026-10-08',
		);
		expect(kinds(day(cal, '2026-10-13')?.entries ?? [])).toEqual(['span:Long:mid', 'span:Early:start+']);
		// Late takes row 2, which Early freed.
		expect(kinds(day(cal, '2026-10-16')?.entries ?? [])).toEqual(['span:Long:mid', 'span:Late:start+']);
		expect(kinds(day(cal, '2026-10-18')?.entries ?? [])).toEqual(['slot', 'span:Late:end']);
	});
});

describe('shiftDates', () => {
	it('moves start and due by the same days and keeps times', () => {
		expect(shiftDates({ date: '2026-10-12' }, { date: '2026-10-15', time: '10:00' }, '2026-10-13', '2026-10-20')).toEqual({
			start: { date: '2026-10-19' },
			due: { date: '2026-10-22', time: '10:00' },
		});
		expect(shiftDates(null, { date: '2026-10-09' }, '2026-10-09', '2026-10-08')).toEqual({ start: null, due: { date: '2026-10-08' } });
	});
});
