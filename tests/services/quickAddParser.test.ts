import { describe, expect, it } from 'vitest';
import { parseQuickAdd, type QuickAddContext } from '../../src/services/quickAddParser';

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
	it('recognises each token and removes it from the title', () => {
		const r = parse('/call Marco about the worktop #Kitchen @Marco !1');
		expect(r.title).toBe('Marco about the worktop');
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
		expect(r.title).toBe('Fix fence');
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
		expect(r.title).toBe('Call Marco');
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
		expect(r).toMatchObject({ start: '2026-10-12', due: '2026-10-14', title: 'Holiday' });
	});

	it('joins Spanish ranges', () => {
		const r = parse('Vacaciones del lunes al miércoles');
		expect(r).toMatchObject({ start: '2026-10-12', due: '2026-10-14', title: 'Vacaciones' });
	});

	it('uses the longest match across languages', () => {
		const r = parse('Revisar en 3 días');
		expect(r.due).toBe('2026-10-12');
		expect(r.title).toBe('Revisar');
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

	it('returns the date chip with its source text', () => {
		const chip = parse('Call Marco tomorrow 10am').chips.find((c) => c.kind === 'date');
		expect(chip).toMatchObject({ kind: 'date', text: 'tomorrow 10am', startDate: null, due: '2026-10-10T10:00' });
	});
});

describe('unmatched names', () => {
	it('keep the surname of a new person', () => {
		const r = parse('Confirm the quote with @Ana García tomorrow');
		expect(r.chips.find((c) => c.kind === 'person')).toMatchObject({ text: '@Ana García', query: 'Ana García', path: null });
		expect(r.title).toBe('Confirm the quote with');
	});

	it('take particles between capitalised words', () => {
		expect(parse('@Juan de la Cruz about the van').chips[0]).toMatchObject({ query: 'Juan de la Cruz' });
		expect(parse('Visit @Ana de').chips[0]).toMatchObject({ query: 'Ana' });
	});

	it('stop at lowercase words, conjunctions, date words and punctuation', () => {
		expect(parse('@Ana call her back').title).toBe('call her back');
		expect(parse('@Ana y Marco').chips[0]).toMatchObject({ query: 'Ana' });
		const monday = parse('@Ana Monday');
		expect(monday.chips[0]).toMatchObject({ query: 'Ana' });
		expect(monday.due).toBe('2026-10-12');
		expect(parse('@Ana, Pedro').chips[0]).toMatchObject({ query: 'Ana,' });
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
