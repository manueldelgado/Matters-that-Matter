import { describe, expect, it } from 'vitest';
import { nextDayOfMonth, parseDateText, parseQuickAdd, type QuickAddContext } from '../../src/services/quickAddParser';

// Friday 9 October 2026, 12:00 local time.
const now = new Date(2026, 9, 9, 12, 0);

const ctx: QuickAddContext = {
	now,
	types: [
		{ id: 'call', names: ['call', 'Call'] },
		{ id: 'message', names: ['message', 'Message'] },
		{ id: 'follow-up', names: ['follow-up', 'Follow up'] },
	],
	matters: [
		{ path: 'M/Kitchen renovation.md', names: ['Kitchen renovation'] },
		{ path: 'M/Garden.md', names: ['Garden'] },
		{ path: 'M/Inbox.md', names: ['Inbox'] },
	],
	people: [
		{ path: 'P/Marco Rossi.md', names: ['Marco Rossi'], rank: 0 },
		{ path: 'Notes/Marcos.md', names: ['Marcos'], rank: 1 },
		{ path: 'P/Ana Gil.md', names: ['Ana Gil'], rank: 0 },
	],
};

const parse = (input: string, extra: Partial<QuickAddContext> = {}) => parseQuickAdd(input, { ...ctx, ...extra });

describe('plain text', () => {
	it('keeps the title and applies nothing', () => {
		expect(parse('Buy paint')).toEqual({
			title: 'Buy paint',
			chips: [],
			typeId: null,
			matterPath: null,
			people: [],
			priority: null,
			start: null,
			due: null,
		});
	});

	it('does not read sigils inside words', () => {
		const r = parse('Learn C# and/or email ana@example.com');
		expect(r.chips).toEqual([]);
		expect(r.title).toBe('Learn C# and/or email ana@example.com');
	});
});

describe('type, Matter, person and priority tokens', () => {
	it('recognises each token; the filing tokens leave the title, a person stays as the name', () => {
		const r = parse('/call Marco about the worktop #Kitchen @Marco !1');
		expect(r.title).toBe('Marco about the worktop Marco');
		expect(r.typeId).toBe('call');
		expect(r.matterPath).toBe('M/Kitchen renovation.md');
		expect(r.people).toEqual(['P/Marco Rossi.md']);
		expect(r.priority).toBe(1);
		expect(r.chips.map((c) => c.kind)).toEqual(['type', 'matter', 'person', 'priority']);
	});

	it('matches multi-word names by the longest strong run', () => {
		const r = parse('Order tiles #Kitchen renovation carefully');
		expect(r.matterPath).toBe('M/Kitchen renovation.md');
		expect(r.title).toBe('Order tiles carefully');
	});

	it('forces a span with quotes', () => {
		const r = parse('Plan #"Kitchen renovation" soon');
		expect(r.matterPath).toBe('M/Kitchen renovation.md');
		expect(r.title).toBe('Plan soon');
	});

	it('matches types by label', () => {
		expect(parse('/follow up with Ana').typeId).toBe('follow-up');
	});

	it('prefers people in the people folder', () => {
		expect(parse('@Marco').people).toEqual(['P/Marco Rossi.md']);
		expect(parse('@Marcos').people).toEqual(['Notes/Marcos.md']);
	});

	it('collects several people', () => {
		expect(parse('Meet @Ana and @Marco').people).toEqual(['P/Ana Gil.md', 'P/Marco Rossi.md']);
	});

	it('shows unmatched tokens as invalid chips and does not apply them', () => {
		const r = parse('Fix fence #Shed /fax @Nobody');
		expect(r.matterPath).toBeNull();
		expect(r.typeId).toBeNull();
		expect(r.people).toEqual([]);
		expect(r.title).toBe('Fix fence Nobody');
		expect(r.chips).toMatchObject([
			{ kind: 'matter', query: 'Shed', path: null },
			{ kind: 'type', query: 'fax', id: null },
			{ kind: 'person', query: 'Nobody', path: null },
		]);
	});

	it('ignores a bare sigil', () => {
		expect(parse('Note # to self').chips).toEqual([]);
	});

	it('only accepts priorities 1 to 3', () => {
		expect(parse('Task !4').priority).toBeNull();
		expect(parse('Task !2').priority).toBe(2);
		expect(parse('Wow!1').priority).toBeNull();
	});

	it('lets a later token replace an earlier one', () => {
		const r = parse('#Garden #Kitchen x');
		expect(r.matterPath).toBe('M/Kitchen renovation.md');
		const t = parse('Call /call /message !1 !3 x');
		expect([t.typeId, t.priority, t.title]).toEqual(['message', 3, 'Call x']);
	});

	it('keeps a person in the title as the name written, without the sigil and the quotes', () => {
		expect(parse('Call @Jon Evans on Wednesday').title).toBe('Call Jon Evans on Wednesday');
		expect(parse('Call @"Marco Rossi", then lunch').title).toBe('Call Marco Rossi, then lunch');
		expect(parse('Email @marco').title).toBe('Email marco');
		expect(parse('Meet @Marco Rossi and @Ana Gil at the site').title).toBe('Meet Marco Rossi and Ana Gil at the site');
		expect(parse('@Marco Rossi').title).toBe('Marco Rossi');
	});

	it('links every person once', () => {
		expect(parse('Meet @Marco Rossi and @Ana Gil').people).toEqual(['P/Marco Rossi.md', 'P/Ana Gil.md']);
		expect(parse('Meet @Marco Rossi @Marco Rossi').people).toEqual(['P/Marco Rossi.md']);
	});

	it('reads removed tokens as plain words', () => {
		const r = parse('Call @Marco /call #Garden !1', { ignoredTokens: ['@Marco', '/call', '#garden', '!1'] });
		expect(r.chips).toEqual([]);
		// A removed person still reads as a name.
		expect(r.title).toBe('Call Marco /call #Garden !1');
	});

	it('records chip positions in the input', () => {
		const input = 'Call #Garden';
		const chip = parse(input).chips[0]!;
		expect(input.slice(chip.start, chip.end)).toBe('#Garden');
		expect(chip.text).toBe('#Garden');
	});
});

describe('dates', () => {
	it('sets the due date from one date', () => {
		const r = parse('Call Marco tomorrow');
		expect(r.due).toBe('2026-10-10');
		expect(r.start).toBeNull();
		expect(r.title).toBe('Call Marco tomorrow');
	});

	it('keeps times', () => {
		expect(parse('Dentist tomorrow 10am').due).toBe('2026-10-10T10:00');
		expect(parse('Dentista mañana a las 10').due).toBe('2026-10-10T10:00');
	});

	it('reads a bare weekday as the next occurrence after today', () => {
		expect(parse('Call Marco fri').due).toBe('2026-10-16');
		expect(parse('Llamar viernes').due).toBe('2026-10-16');
		expect(parse('Call Marco mon').due).toBe('2026-10-12');
	});

	it('reads times from 1 to 7 without am or pm as afternoon', () => {
		expect(parse('Meet at 3').due).toBe('2026-10-09T15:00');
		expect(parse('Reunión a las 5').due).toBe('2026-10-09T17:00');
		expect(parse('Breakfast at 7am').due).toBe('2026-10-10T07:00');
	});

	it('moves a time that has passed today to tomorrow', () => {
		expect(parse('Call at 11:00').due).toBe('2026-10-10T11:00');
	});

	it('reads day-first dates in English and Spanish', () => {
		expect(parse('Pay 15/10').due).toBe('2026-10-15');
		expect(parse('Pagar 15 de octubre').due).toBe('2026-10-15');
		expect(parse('Pay 15 oct').due).toBe('2026-10-15');
	});

	it('sets start and due from a range', () => {
		const r = parse('Holiday from mon to wed');
		expect(r).toMatchObject({ start: '2026-10-12', due: '2026-10-14', title: 'Holiday from mon to wed' });
	});

	it('joins Spanish ranges', () => {
		const r = parse('Vacaciones del lunes al miércoles');
		expect(r).toMatchObject({ start: '2026-10-12', due: '2026-10-14', title: 'Vacaciones del lunes al miércoles' });
	});

	it('uses the longest match across languages', () => {
		const r = parse('Revisar en 3 días');
		expect(r.due).toBe('2026-10-12');
		expect(r.title).toBe('Revisar en 3 días');
	});

	it('keeps a removed date chip in the title', () => {
		const r = parse('Buy sun cream', { ignoredDates: ['sun'] });
		expect(r.due).toBeNull();
		expect(r.title).toBe('Buy sun cream');
	});

	it('does not read dates inside tokens', () => {
		const r = parse('Plan #Garden today');
		expect(r.matterPath).toBe('M/Garden.md');
		expect(r.due).toBe('2026-10-09');
	});

	it('honours the configured languages', () => {
		expect(parse('Llamar mañana', { languages: ['en'] }).due).toBeNull();
	});

	it('with English only, leaves Spanish dates in the title', () => {
		for (const input of ['Llamar a Marco el viernes', 'Llamar a Marco viernes por la tarde', 'Pagar el día 5', 'Revisar el martes que viene']) {
			const r = parse(input, { languages: ['en'] });
			expect([input, r.due, r.start]).toEqual([input, null, null]);
			expect(r.title).toBe(input);
		}
		expect(parse('Call Marco friday', { languages: ['en'] }).due).toBe('2026-10-16');
	});

	it('with Spanish only, leaves English dates in the title', () => {
		for (const input of ['Call Marco friday', 'Call Marco tomorrow afternoon', 'Pay on the 1st', 'Review next Tuesday']) {
			const r = parse(input, { languages: ['es'] });
			expect([input, r.due, r.start]).toEqual([input, null, null]);
			expect(r.title).toBe(input);
		}
		expect(parse('Llamar a Marco el viernes', { languages: ['es'] }).due).toBe('2026-10-16');
	});

	it('reads every date and takes the last one in the text', () => {
		const r = parse('Call Marco tomorrow, no, friday');
		expect(r.due).toBe('2026-10-16');
		expect(r.chips.map((c) => c.kind === 'date' && c.text)).toEqual(['tomorrow', 'friday']);
		expect(r.title).toBe('Call Marco tomorrow, no, friday');
		expect(parse('Call Marco friday 10am, no, tomorrow').due).toBe('2026-10-10');
		// Overlapping readings are still one date, the longest.
		expect(parse('Call friday 10am').chips.filter((c) => c.kind === 'date')).toHaveLength(1);
	});

	it('returns the date chip with its source text', () => {
		const chip = parse('Call Marco tomorrow 10am').chips.find((c) => c.kind === 'date');
		expect(chip).toMatchObject({ kind: 'date', text: 'tomorrow 10am', startDate: null, due: '2026-10-10T10:00' });
	});
});

describe('unmatched names', () => {
	it('keep the surname of a new person', () => {
		const r = parse('Confirm the quote with @Ana García tomorrow');
		expect(r.chips.find((c) => c.kind === 'person')).toMatchObject({ text: '@Ana García', query: 'Ana García', path: null });
		expect(r.title).toBe('Confirm the quote with Ana García tomorrow');
	});

	it('take particles between capitalised words', () => {
		expect(parse('@Juan de la Cruz about the van').chips[0]).toMatchObject({ query: 'Juan de la Cruz' });
		expect(parse('Visit @Ana de').chips[0]).toMatchObject({ query: 'Ana' });
	});

	it('stop at lowercase words, conjunctions, date words and punctuation', () => {
		expect(parse('@Ana call her back').title).toBe('Ana call her back');
		expect(parse('@Ana y Marco').chips[0]).toMatchObject({ query: 'Ana' });
		const monday = parse('@Ana Monday');
		expect(monday.chips[0]).toMatchObject({ query: 'Ana' });
		expect(monday.due).toBe('2026-10-12');
		expect(parse('@Ana, Pedro').chips[0]).toMatchObject({ query: 'Ana' });
	});

	it('are someone else when the name runs on past a match on its first words', () => {
		// "Ana Gil" exists; "Ana García" is a different person.
		expect(parse('@Ana García').people).toEqual([]);
		expect(parse('@Ana Gil').people).toEqual(['P/Ana Gil.md']);
		expect(parse('@Ana about it').people).toEqual(['P/Ana Gil.md']);
	});

	it('prefer a strong match, and leave types to one word', () => {
		expect(parse('@Marco Rossi Tomorrow').people).toEqual(['P/Marco Rossi.md']);
		expect(parse('/shop Paint').chips[0]).toMatchObject({ text: '/shop', id: null });
		expect(parse('/shop Paint').title).toBe('Paint');
	});

	it('also apply to new Matters', () => {
		expect(parse('Paint #Garden Shed').chips[0]).toMatchObject({ query: 'Garden Shed', path: null });
	});
});

describe('QA 8 October 2026', () => {
	const date = (input: string, extra: Partial<QuickAddContext> = {}) => {
		const r = parse(input, extra);
		return { title: r.title, start: r.start, due: r.due };
	};

	it('reads a month name followed by a day as a day, not a year', () => {
		expect(date('Call Ana oct 12')).toEqual({ title: 'Call Ana oct 12', start: null, due: '2026-10-12' });
		expect(date('Call Ana October 12 at 3pm')).toEqual({ title: 'Call Ana October 12 at 3pm', start: null, due: '2026-10-12T15:00' });
		expect(date('dec 25 party')).toEqual({ title: 'dec 25 party', start: null, due: '2026-12-25' });
		expect(date('Trip oct 12 - oct 14')).toEqual({ title: 'Trip oct 12 - oct 14', start: '2026-10-12', due: '2026-10-14' });
		expect(date('Dentist 15/10 at 16:30').due).toBe('2026-10-15T16:30');
	});

	it('leaves ordinary words in the title', () => {
		for (const t of ['Morning run', 'Weekend trip', 'Noon meeting', 'March planning', 'Fix the sun deck', 'Buy mar salt', 'Plan the weekend']) {
			expect(date(t)).toEqual({ title: t, start: null, due: null });
		}
		expect(date('Call tomorrow morning').due?.slice(0, 10)).toBe('2026-10-10');
		expect(date('Weekend 20-22 oct')).toEqual({ title: 'Weekend 20-22 oct', start: '2026-10-20', due: '2026-10-22' });
	});

	it('reads a date across a token, and a range followed by a token', () => {
		const r = parse('Call Marco tomorrow #Kitchen 5pm');
		expect(r).toMatchObject({ title: 'Call Marco tomorrow 5pm', due: '2026-10-10T17:00', matterPath: 'M/Kitchen renovation.md' });
		expect(date('Weekend away 20-22 oct #Garden')).toEqual({ title: 'Weekend away 20-22 oct', start: '2026-10-20', due: '2026-10-22' });
	});

	it('a removed date chip also ignores the dates inside it', () => {
		const first = parse('Call Ana friday 10am');
		const chip = first.chips.find((c) => c.kind === 'date');
		expect(chip?.text).toBe('friday 10am');
		expect(date('Call Ana friday 10am', { ignoredDates: [chip?.text ?? ''] })).toEqual({ title: 'Call Ana friday 10am', start: null, due: null });
	});

	it('keeps a weekday range in order', () => {
		expect(date('Trip friday until monday')).toEqual({ title: 'Trip friday until monday', start: '2026-10-16', due: '2026-10-19' });
	});

	it('reads more Spanish', () => {
		expect(date('Comprar pan pasado mañana')).toEqual({ title: 'Comprar pan pasado mañana', start: null, due: '2026-10-11' });
		expect(date('Fin de semana del 20 al 22 de octubre')).toEqual({ title: 'Fin de semana del 20 al 22 de octubre', start: '2026-10-20', due: '2026-10-22' });
		expect(date('Pagar la luz el viernes')).toEqual({ title: 'Pagar la luz el viernes', start: null, due: '2026-10-16' });
	});

	it('drops a word that only introduces the date', () => {
		expect(date('Prepare taxes by end of month').title).toBe('Prepare taxes by end of month');
		expect(date('Pay rent on friday').title).toBe('Pay rent on friday');
	});

	it('reads a day of the month with no month as the next one after today', () => {
		expect(date('Pay rent on the 1st')).toEqual({ title: 'Pay rent on the 1st', start: null, due: '2026-11-01' });
		expect(date('Send the report by the 21st')).toEqual({ title: 'Send the report by the 21st', start: null, due: '2026-10-21' });
		expect(date('Book the hall before the 9th').due).toBe('2026-11-09');
		expect(date('Pay rent on the 1st at 10am')).toEqual({ title: 'Pay rent on the 1st at 10am', start: null, due: '2026-11-01T10:00' });
		expect(date('Pay rent on the 1st #Kitchen')).toMatchObject({ title: 'Pay rent on the 1st', due: '2026-11-01' });
		expect(date('Pagar el alquiler el día 1')).toEqual({ title: 'Pagar el alquiler el día 1', start: null, due: '2026-11-01' });
		expect(date('Pagar el alquiler el día 15 a las 10').due).toBe('2026-10-15T10:00');
	});

	it('skips months too short for the day', () => {
		expect(nextDayOfMonth(new Date(2027, 0, 31), 31)).toBe('2027-03-31');
		expect(nextDayOfMonth(new Date(2027, 0, 30), 30)).toBe('2027-03-30');
		expect(nextDayOfMonth(now, 32)).toBeNull();
	});

	it('needs the lead word and no word after the day', () => {
		for (const t of ['Write the 2nd draft', 'Fix the light on the 2nd floor', 'Tickets for the 1st night']) {
			expect(date(t)).toEqual({ title: t, start: null, due: null });
		}
	});

	it('keeps punctuation after a token out of the name', () => {
		expect(parse('Talk about #Kitchen, tomorrow')).toMatchObject({ title: 'Talk about tomorrow', matterPath: 'M/Kitchen renovation.md', due: '2026-10-10' });
	});
});

describe('parseDateText: a date on its own', () => {
	it.each([
		['tomorrow', null, '2026-10-10'],
		['fri 10:00', null, '2026-10-16T10:00'],
		['by Friday', null, '2026-10-16'],
		['on the 21st', null, '2026-10-21'],
		['el viernes a las 10', null, '2026-10-16T10:00'],
		['del 20 al 22 de octubre', '2026-10-20', '2026-10-22'],
		['  next   monday. ', null, '2026-10-12'],
	])('%j', (text, start, due) => {
		expect(parseDateText(text, now, ['en', 'es'])).toEqual({ start, due });
	});

	it.each(['', 'whenever', 'call Marco tomorrow', 'tomorrow at the office', 'march'])('%j is not a date on its own', (text) => {
		expect(parseDateText(text, now, ['en', 'es'])).toBeNull();
	});

	it('reads only the languages given', () => {
		expect(parseDateText('mañana', now, ['en'])).toBeNull();
		expect(parseDateText('mañana', now, ['es'])).toEqual({ start: null, due: '2026-10-10' });
	});
});

describe('times written in figures', () => {
	const date = (input: string) => {
		const r = parse(input);
		return { title: r.title, start: r.start, due: r.due };
	};

	it('reads an hour written with two digits as written, never as afternoon', () => {
		expect(date('Call 2026-10-16T06:00')).toEqual({ title: 'Call 2026-10-16T06:00', start: null, due: '2026-10-16T06:00' });
		expect(date('Call 2026-10-16 06:00')).toEqual({ title: 'Call 2026-10-16 06:00', start: null, due: '2026-10-16T06:00' });
		expect(date('Call 2026-10-16T01:00').due).toBe('2026-10-16T01:00');
		expect(date('Call 16/10/2026 06:00').due).toBe('2026-10-16T06:00');
		expect(date('Flight 06:30 tomorrow')).toEqual({ title: 'Flight 06:30 tomorrow', start: null, due: '2026-10-10T06:30' });
		expect(date('Vuelo mañana a las 07:00')).toEqual({ title: 'Vuelo mañana a las 07:00', start: null, due: '2026-10-10T07:00' });
		expect(date('Vuelo a las 06:30')).toEqual({ title: 'Vuelo a las 06:30', start: null, due: '2026-10-10T06:30' });
	});

	it('still reads an hour written with one digit, without am or pm, as afternoon', () => {
		expect(date('Meet at 3').due).toBe('2026-10-09T15:00');
		expect(date('Meet 3:30').due).toBe('2026-10-09T15:30');
		expect(date('Call 7:30').due).toBe('2026-10-09T19:30');
		expect(date('Vuelo mañana a las 6').due).toBe('2026-10-10T18:00');
		expect(date('Call 2026-10-16 at 3').due).toBe('2026-10-16T15:00');
		expect(date('Call fri 5pm').due).toBe('2026-10-16T17:00');
		expect(date('Call fri 5am').due).toBe('2026-10-16T05:00');
	});

	it('reads both ends of a range', () => {
		expect(date('Fly fri 23:00 to sat 02:00')).toEqual({ title: 'Fly fri 23:00 to sat 02:00', start: '2026-10-16T23:00', due: '2026-10-17T02:00' });
		expect(date('Fly fri 23:00 to 02:00')).toEqual({ title: 'Fly fri 23:00 to 02:00', start: '2026-10-16T23:00', due: '2026-10-17T02:00' });
	});

	it('reads a date on its own the same way', () => {
		expect(parseDateText('2026-10-16T06:00', now)).toEqual({ start: null, due: '2026-10-16T06:00' });
		expect(parseDateText('tomorrow 06:00', now)).toEqual({ start: null, due: '2026-10-10T06:00' });
		expect(parseDateText('mañana a las 06:00', now)).toEqual({ start: null, due: '2026-10-10T06:00' });
		expect(parseDateText('tomorrow 6:00', now)).toEqual({ start: null, due: '2026-10-10T18:00' });
	});
});

describe('ranges ending in a time', () => {
	it('put the end on the start\'s day', () => {
		expect(parse('Reunión 20/10 10:00 hasta 12:00')).toMatchObject({ title: 'Reunión 20/10 10:00 hasta 12:00', start: '2026-10-20T10:00', due: '2026-10-20T12:00' });
		expect(parse('Meet 20/10 10:00 y 12:00')).toMatchObject({ title: 'Meet 20/10 10:00 y 12:00', start: '2026-10-20T10:00', due: '2026-10-20T12:00' });
		expect(parse('Meet fri 10:00 y 12:00')).toMatchObject({ title: 'Meet fri 10:00 y 12:00', start: '2026-10-16T10:00', due: '2026-10-16T12:00' });
		expect(parseDateText('fri 10:00 y 12:00', now)).toEqual({ start: '2026-10-16T10:00', due: '2026-10-16T12:00' });
	});

	it('put the end on the next day when it isn\'t later than the start', () => {
		expect(parse('Guardia 20/10 23:00 hasta 01:00')).toMatchObject({ start: '2026-10-20T23:00', due: '2026-10-21T01:00' });
	});
});

describe('Spanish ranges of days', () => {
	it('make a day the month doesn\'t have an invalid date, with no date set', () => {
		for (const [input, text] of [
			['Viaje del 29 al 31 de abril', 'del 29 al 31 de abril'],
			['Viaje del 30 al 31 de febrero', 'del 30 al 31 de febrero'],
		] as const) {
			const r = parse(input);
			expect([r.start, r.due, r.title]).toEqual([null, null, input]);
			expect(r.chips).toEqual([{ kind: 'invalid-date', text, start: input.indexOf(text), end: input.length, problem: 'not-a-day' }]);
		}
		expect(parseDateText('del 29 al 31 de abril', now)).toEqual({ problem: 'not-a-day' });
	});

	it('read a first day after the last as a day of the month before', () => {
		expect(parse('Viaje del 28 al 2 de noviembre')).toMatchObject({ title: 'Viaje del 28 al 2 de noviembre', start: '2026-10-28', due: '2026-11-02' });
		expect(parse('Viaje del 28 al 3 de enero')).toMatchObject({ title: 'Viaje del 28 al 3 de enero', start: '2026-12-28', due: '2027-01-03' });
		expect(parse('Viaje del 30 al 2 de marzo').chips.map((c) => c.kind)).toEqual(['invalid-date']);
	});

	it('read English ranges the same way', () => {
		expect(parse('Trip 28 to 2 November')).toMatchObject({ title: 'Trip 28 to 2 November', start: '2026-10-28', due: '2026-11-02' });
	});
});

describe('Spanish "a las"', () => {
	it('reads the time and keeps its words in the title', () => {
		expect(parse('Reunión a las 5')).toMatchObject({ title: 'Reunión a las 5', due: '2026-10-09T17:00' });
		expect(parse('llamar a Juan a las 10')).toMatchObject({ title: 'llamar a Juan a las 10', due: '2026-10-10T10:00' });
		expect(parse('A las 9 dentista')).toMatchObject({ title: 'A las 9 dentista', due: '2026-10-10T09:00' });
		expect(parse('a las 10 llamar')).toMatchObject({ title: 'a las 10 llamar', due: '2026-10-10T10:00' });
		expect(parse('Reunión a la 1')).toMatchObject({ title: 'Reunión a la 1', due: '2026-10-09T13:00' });
		expect(parse('Reunión mañana a las 5')).toMatchObject({ title: 'Reunión mañana a las 5', due: '2026-10-10T17:00' });
	});

	it('is a date on its own', () => {
		expect(parseDateText('a las 5', now)).toEqual({ start: null, due: '2026-10-09T17:00' });
	});
});

describe('ranges whose times are written differently', () => {
	const range = (input: string, extra: Partial<QuickAddContext> = {}) => {
		const r = parse(input, extra);
		return [r.start, r.due];
	};

	it('read an ambiguous hour at one end as the shortest range after the start', () => {
		expect(range('Meet 06:00 to 7:00')).toEqual(['2026-10-10T06:00', '2026-10-10T07:00']);
		expect(range('Reunión 06:00 hasta 7:00')).toEqual(['2026-10-10T06:00', '2026-10-10T07:00']);
		expect(range('Meet 6:00 to 07:00')).toEqual(['2026-10-10T06:00', '2026-10-10T07:00']);
		expect(range('Meet 6:30 to 07:30')).toEqual(['2026-10-10T06:30', '2026-10-10T07:30']);
		expect(range('Meet 6am to 7')).toEqual(['2026-10-10T06:00', '2026-10-10T07:00']);
		expect(range('Meet 20/10 18:00 hasta 6:00')).toEqual(['2026-10-20T18:00', '2026-10-21T06:00']);
		expect(range('Fly 23:45 to 1:00')).toEqual(['2026-10-09T23:45', '2026-10-10T01:00']);
		expect(range('Fly fri 23:00 to 2')).toEqual(['2026-10-16T23:00', '2026-10-17T02:00']);
		expect(range('Meet fri 10 to 2')).toEqual(['2026-10-16T10:00', '2026-10-16T14:00']);
	});

	it('read the start by the afternoon rule and the end as the shortest range after it when both ends are ambiguous', () => {
		expect(range('Meet 3 to 5')).toEqual(['2026-10-09T15:00', '2026-10-09T17:00']);
		expect(range('Meet 7 to 9')).toEqual(['2026-10-09T19:00', '2026-10-09T21:00']);
		expect(range('Meet 8 to 9')).toEqual(['2026-10-10T08:00', '2026-10-10T09:00']);
		expect(range('Meet fri 10 to 2')).toEqual(['2026-10-16T10:00', '2026-10-16T14:00']);
		expect(range('Reunión 7:00 hasta 9:00')).toEqual(['2026-10-09T19:00', '2026-10-09T21:00']);
	});

	it('read equal times as one moment, not a day', () => {
		expect(range('Meet 23:00 to 23:00')).toEqual(['2026-10-09T23:00', '2026-10-09T23:00']);
		expect(range('Reunión 20/10 10:00 hasta 10:00')).toEqual(['2026-10-20T10:00', '2026-10-20T10:00']);
	});
});

describe('ranges of days that end before they start', () => {
	it('move the start to the month before only when the month is written once, after the last day', () => {
		expect(parse('Trip 28 to 20 October')).toMatchObject({ start: '2026-09-28', due: '2026-10-20' });
		expect(parse('Trip Oct 28 - 20')).toMatchObject({ title: 'Trip Oct 28 - 20', start: '2026-10-28', due: '2026-10-20' });
	});

	it('agree on the year in English and Spanish when the range is already over', () => {
		const later = new Date(2026, 10, 10, 12, 0);
		expect(parse('Trip 28 to 2 November', { now: later })).toMatchObject({ start: '2027-10-28', due: '2027-11-02' });
		expect(parse('Viaje del 28 al 2 de noviembre', { now: later })).toMatchObject({ start: '2027-10-28', due: '2027-11-02' });
	});
});

describe('Spanish "a" after a time', () => {
	it('is not a.m. unless written as one', () => {
		expect(parse('Llamar a las 5 a Juan')).toMatchObject({ title: 'Llamar a las 5 a Juan', due: '2026-10-09T17:00' });
		expect(parse('Cita a las 3 a Ana')).toMatchObject({ title: 'Cita a las 3 a Ana', due: '2026-10-09T15:00' });
		expect(parse('Llamar a las 5 a.m.')).toMatchObject({ title: 'Llamar a las 5 a.m.', due: '2026-10-10T05:00' });
		expect(parse('Llamar a las 5 am')).toMatchObject({ title: 'Llamar a las 5 am', due: '2026-10-10T05:00' });
		expect(parse('Llamar a las 5 a', { languages: ['es'] })).toMatchObject({ title: 'Llamar a las 5 a', due: '2026-10-09T17:00' });
	});
});

describe('overnight ranges', () => {
	const range = (input: string) => {
		const r = parse(input);
		return [r.title, r.start, r.due];
	};

	it('put an end that is only a time, earlier than the start, on the next day', () => {
		expect(range('Meet 18:00 to 6:00')).toEqual(['Meet 18:00 to 6:00', '2026-10-09T18:00', '2026-10-10T06:00']);
		expect(range('Meet 18:00 to 06:00')).toEqual(['Meet 18:00 to 06:00', '2026-10-09T18:00', '2026-10-10T06:00']);
		expect(range('Meet 18:00 - 07:30')).toEqual(['Meet 18:00 - 07:30', '2026-10-09T18:00', '2026-10-10T07:30']);
		// An hour of one digit is still the shortest range after the start.
		expect(range('Meet 18:00 - 7:30')).toEqual(['Meet 18:00 - 7:30', '2026-10-09T18:00', '2026-10-09T19:30']);
		expect(range('Meet 22:00 to 2:00')).toEqual(['Meet 22:00 to 2:00', '2026-10-09T22:00', '2026-10-10T02:00']);
		expect(range('Reunión 18:00 hasta 6:00')).toEqual(['Reunión 18:00 hasta 6:00', '2026-10-09T18:00', '2026-10-10T06:00']);
	});

	it('start on the next such weekday when the start is a weekday', () => {
		expect(range('Meet fri 22:00 to 2:00')).toEqual(['Meet fri 22:00 to 2:00', '2026-10-16T22:00', '2026-10-17T02:00']);
		expect(range('Meet fri 18:00 to 6:00')).toEqual(['Meet fri 18:00 to 6:00', '2026-10-16T18:00', '2026-10-17T06:00']);
		expect(range('Reunión el viernes de 22:00 hasta 2:00')).toEqual(['Reunión el viernes de 22:00 hasta 2:00', '2026-10-16T22:00', '2026-10-17T02:00']);
		expect(parseDateText('el viernes de 22:00 hasta 2:00', now)).toEqual({ start: '2026-10-16T22:00', due: '2026-10-17T02:00' });
	});
});
