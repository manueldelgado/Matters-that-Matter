import { describe, expect, it } from 'vitest';
import { parseDateText, parseQuickAdd, type QuickAddContext } from '../../src/services/quickAddParser';

// Tuesday 13 October 2026, 09:30 local time.
const now = new Date(2026, 9, 13, 9, 30);
const ctx: QuickAddContext = { now, types: [], matters: [{ path: 'M/Kitchen.md', names: ['Kitchen'] }], people: [] };
const parse = (input: string, extra: Partial<QuickAddContext> = {}) => parseQuickAdd(input, { ...ctx, ...extra });
const invalid = (input: string) => parse(input).chips.filter((c) => c.kind === 'invalid-date');

describe('dates in figures that name no real day', () => {
	it.each([
		['month 13', 'Call Marco 2026-13-12', '2026-13-12'],
		['day 32', 'Call Marco 2026-10-32', '2026-10-32'],
		['30 February', 'Call Marco 2026-02-30', '2026-02-30'],
		['hour 25', 'Call Marco 2026-10-16T25:00', '2026-10-16T25:00'],
		['minute 60', 'Call Marco 2026-10-16 10:60', '2026-10-16 10:60'],
		['slashes', 'Call Marco 2026/13/12', '2026/13/12'],
	])('%s: an invalid chip, no date, the text kept in the title', (_, input, text) => {
		const r = parse(input);
		expect(r.due).toBeNull();
		expect(r.start).toBeNull();
		expect(r.title).toBe(input);
		expect(r.chips).toEqual([{ kind: 'invalid-date', text, start: input.indexOf(text), end: input.indexOf(text) + text.length, problem: 'not-a-day' }]);
	});

	it('a date in words elsewhere is still read', () => {
		const r = parse('Call fri 2026-13-12');
		expect(r.due).toBe('2026-10-16');
		expect(r.title).toBe('Call 2026-13-12');
		expect(r.chips.map((c) => c.kind)).toEqual(['date', 'invalid-date']);
	});

	it('tokens around it work as before', () => {
		const r = parse('Order tiles 2026-13-12 #Kitchen');
		expect(r.matterPath).toBe('M/Kitchen.md');
		expect(r.title).toBe('Order tiles 2026-13-12');
		expect(r.due).toBeNull();
	});

	it('figures inside a word, a version or a path are not dates', () => {
		for (const input of ['Upgrade to v2026-13-12', 'Read notes/2026-13-12.md', 'Ticket ABC-2026-13-12']) expect(invalid(input)).toEqual([]);
	});
});

describe('dates in figures with a time zone', () => {
	it.each([
		['UTC', 'Call 2026-10-16T10:00Z', '2026-10-16T10:00Z'],
		['lower-case z', 'Call 2026-10-16T10:00z', '2026-10-16T10:00z'],
		['an offset', 'Call 2026-10-16T10:00+05:00', '2026-10-16T10:00+05:00'],
		['a negative offset', 'Call 2026-10-16T10:00-08:00', '2026-10-16T10:00-08:00'],
		['an offset without a colon', 'Call 2026-10-16T10:00+0200', '2026-10-16T10:00+0200'],
		['seconds and UTC', 'Call 2026-10-16T23:30:00Z', '2026-10-16T23:30:00Z'],
	])('%s: an invalid chip, no date, the text kept in the title', (_, input, text) => {
		const r = parse(input);
		expect(r.due).toBeNull();
		expect(r.title).toBe(input);
		expect(r.chips).toEqual([expect.objectContaining({ kind: 'invalid-date', text, problem: 'time-zone' })]);
	});
});

describe('time zones in words', () => {
	it.each([
		['Call fri 10am EST', 'fri 10am EST'],
		['Call fri 10:00 CET', 'fri 10:00 CET'],
		['Meet 10:00 UTC', '10:00 UTC'],
		['Meet 9am ET', '9am ET'],
		['Call fri 10:00 GMT+2', 'fri 10:00 GMT+2'],
		['Call fri 10:00 +02:00', 'fri 10:00 +02:00'],
		['Llamar viernes 10:00 CET', 'viernes 10:00 CET'],
		['Call 2026-10-16 10:00 EST', '2026-10-16 10:00 EST'],
		['Call on the 21st at 10am EST', 'the 21st at 10am EST'],
	])('%j: an invalid chip for %j, no date', (input, text) => {
		const r = parse(input);
		expect(r.due).toBeNull();
		expect(r.title).toBe(input);
		expect(r.chips).toEqual([expect.objectContaining({ kind: 'invalid-date', text, problem: 'time-zone' })]);
	});

	it.each([
		['Kids 5pm art class', 'Kids art class', '2026-10-13T17:00'],
		['Feed 5pm cat food', 'Feed cat food', '2026-10-13T17:00'],
		['Call 4pm mt everest', 'Call mt everest', '2026-10-13T16:00'],
		['Call fri 10am est', 'Call est', '2026-10-16T10:00'],
	])('a word chrono takes for a zone, not written as one, goes back to the title: %j', (input, title, due) => {
		const r = parse(input);
		expect(r.title).toBe(title);
		expect(r.due).toBe(due);
		expect(invalid(input)).toEqual([]);
	});
});

describe('real days in figures read as before', () => {
	it.each([
		['Call 2026-10-16', '2026-10-16'],
		['Call 2026/10/16', '2026-10-16'],
		['Call 2026-1-5', '2026-01-05'],
		['Call 2026-10-16 10:00', '2026-10-16T10:00'],
		['Call 2026-10-16T10:00', '2026-10-16T10:00'],
		['Call 2026-10-16T10:00:00', '2026-10-16T10:00'],
		['Call 2026-10-16 at 10am', '2026-10-16T10:00'],
		['Call 16/10/2026', '2026-10-16'],
	])('%j', (input, due) => {
		const r = parse(input);
		expect(r.due).toBe(due);
		expect(r.title).toBe('Call');
		expect(invalid(input)).toEqual([]);
	});

	it('a prefix of a real date is never an invalid one while it is being typed', () => {
		for (const typed of ['Call 2026', 'Call 2026-1', 'Call 2026-10-', 'Call 2026-10-1', 'Call 2026-10-16T1', 'Call 2026-10-16T10:0']) {
			expect(invalid(typed)).toEqual([]);
		}
	});
});

describe('parseDateText: a date on its own that isn’t read', () => {
	it.each([
		['2026-13-12', 'not-a-day'],
		['2026-10-16T10:00Z', 'time-zone'],
		['fri 10am EST', 'time-zone'],
		['by fri 10:00 GMT+2', 'time-zone'],
	])('%j: %s', (text, problem) => {
		expect(parseDateText(text, now, ['en', 'es'])).toEqual({ problem });
	});

	it('a lower-case word after the time is not a zone, so the text is not a date on its own', () => {
		expect(parseDateText('fri 10am art', now, ['en'])).toBeNull();
	});
});

describe('the time zone, given', () => {
	// 23:30 UTC on Tuesday 13 October: Wednesday 01:30 in Madrid, Tuesday 19:30 in New York, Wednesday 08:30 in Tokyo.
	const instant = new Date(Date.UTC(2026, 9, 13, 23, 30));
	const due = (text: string, timeZone?: string) => parseDateText(text, instant, ['en'], timeZone);

	it.each([
		['Europe/Madrid', '2026-10-15', '2026-10-14T21:00', '2026-10-14T10:00'],
		['America/New_York', '2026-10-14', '2026-10-13T21:00', '2026-10-14T10:00'],
		['Asia/Tokyo', '2026-10-15', '2026-10-14T21:00', '2026-10-14T10:00'],
	])('%s: "tomorrow", "tonight 9pm" and a passed time read in that zone', (zone, tomorrow, tonight, ten) => {
		expect(due('tomorrow', zone)).toEqual({ start: null, due: tomorrow });
		expect(due('tonight 9pm', zone)).toEqual({ start: null, due: tonight });
		// 10:00 has passed in every one of them except New York, where it is still the evening before.
		expect(due('10:00', zone)).toEqual({ start: null, due: zone === 'America/New_York' ? '2026-10-14T10:00' : ten });
		expect(due('fri', zone)).toEqual({ start: null, due: '2026-10-16' });
	});

	it('quick add takes it too', () => {
		expect(parseQuickAdd('Call tomorrow', { ...ctx, now: instant, timeZone: 'America/New_York' }).due).toBe('2026-10-14');
		expect(parseQuickAdd('Call tomorrow', { ...ctx, now: instant, timeZone: 'Asia/Tokyo' }).due).toBe('2026-10-15');
	});

	it('without one, the host’s zone, as before', () => {
		expect(due('tomorrow')).toEqual(due('tomorrow', Intl.DateTimeFormat().resolvedOptions().timeZone));
	});
});
