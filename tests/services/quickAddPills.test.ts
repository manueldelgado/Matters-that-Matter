import { describe, expect, it } from 'vitest';
import { parseQuickAdd, type QuickAddContext } from '../../src/services/quickAddParser';
import { applyPills, carryPills, clearedPills, givenPills, noPills, pickType, removePill, type Pills } from '../../src/services/quickAddPills';

// Friday 9 October 2026, 12:00 local time.
const ctx: QuickAddContext = {
	now: new Date(2026, 9, 9, 12, 0),
	types: [
		{ id: 'call', names: ['call', 'Call'] },
		{ id: 'message', names: ['message', 'Message'] },
	],
	matters: [
		{ path: 'M/Kitchen renovation.md', names: ['Kitchen renovation'] },
		{ path: 'M/Garden.md', names: ['Garden'] },
	],
	people: [
		{ path: 'P/Marco Rossi.md', names: ['Marco Rossi'], rank: 0 },
		{ path: 'P/Ana Gil.md', names: ['Ana Gil'], rank: 0 },
	],
};

/** A capture: each step is the text after a keystroke (caret at its end), or a caret move. */
class Capture {
	pills: Pills = noPills();
	text = '';
	ignoredDates: string[] = [];
	ignoredTokens: string[] = [];

	private read(text: string, caret: number, moved: boolean): this {
		const chips = parseQuickAdd(text, { ...ctx, ignoredDates: this.ignoredDates, ignoredTokens: this.ignoredTokens }).chips;
		this.pills = carryPills(this.pills, text, chips, caret, moved);
		this.text = text;
		return this;
	}

	/** Types `text` one character at a time at the end. */
	type(text: string): this {
		for (const ch of text) this.read(this.text + ch, this.text.length + 1, false);
		return this;
	}

	/** Deletes characters at the end one at a time, as Backspace. */
	backspace(n: number): this {
		for (let i = 0; i < n; i++) this.read(this.text.slice(0, -1), this.text.length - 1, false);
		return this;
	}

	/** Replaces `from` with `to` in one edit, the caret after it (a selection deleted or typed over). */
	edit(from: string, to: string): this {
		const at = this.text.indexOf(from);
		if (at < 0) throw new Error(`No "${from}" in "${this.text}"`);
		return this.read(this.text.slice(0, at) + to + this.text.slice(at + from.length), at + to.length, false);
	}

	/** Clicks at the end of the text. */
	click(): this {
		return this.read(this.text, this.text.length, true);
	}

	remove(kind: string): this {
		const pill = this.pills.list.find((p) => p.chip.kind === kind);
		if (!pill) throw new Error(`No ${kind} pill`);
		if (pill.inText) (kind === 'date' ? this.ignoredDates : this.ignoredTokens).push(pill.words);
		this.pills = removePill(this.pills, pill.id);
		return this.read(this.text, this.text.length, false);
	}

	get result() {
		return applyPills(parseQuickAdd(this.text, { ...ctx, ignoredDates: this.ignoredDates, ignoredTokens: this.ignoredTokens }), this.pills);
	}
}

const capture = () => new Capture();

describe('pills while typing', () => {
	it('set what the text says, as the parser reads it', () => {
		const r = capture().type('Call @Marco Rossi on friday 10am /call #Garden !2').result;
		expect(r).toMatchObject({
			title: 'Call Marco Rossi on friday 10am',
			typeId: 'call',
			matterPath: 'M/Garden.md',
			people: ['P/Marco Rossi.md'],
			priority: 2,
			due: '2026-10-16T10:00',
		});
	});

	it('follow their words: a date grows, a name grows', () => {
		const c = capture().type('Call tue');
		expect(c.result.due).toBe('2026-10-13');
		c.type(' 10:00');
		expect(c.result.due).toBe('2026-10-13T10:00');
		const d = capture().type('Meet @Ana');
		expect(d.result.people).toEqual(['P/Ana Gil.md']);
		d.type(' Gil');
		expect(d.result.people).toEqual(['P/Ana Gil.md']);
	});

	it('backspacing a pill the caret never left takes it with the words', () => {
		const c = capture().type('Call tomorrow').backspace(8);
		expect(c.result.title).toBe('Call');
		expect(c.result.due).toBeNull();
		// Typed past, it counts: backspacing its words keeps it.
		expect(capture().type('Call tue 10:00').backspace(9).result).toMatchObject({ title: 'Call', due: '2026-10-13T10:00' });
		expect(capture().type('Meet @Jo').backspace(3).result.chips).toEqual([]);
	});
});

describe('pills outlive their words', () => {
	it('a date typed as shorthand, then deleted, is still set and the title is clean', () => {
		const c = capture().type('Call Charlie about the delivery tue 10:00').click().edit(' tue 10:00', '');
		expect(c.result).toMatchObject({ title: 'Call Charlie about the delivery', due: '2026-10-13T10:00' });
		expect(c.result.chips.map((x) => x.kind)).toEqual(['date']);
	});

	it('count once the caret leaves them, by typing on', () => {
		const c = capture().type('Call @Marco Rossi about tiles').edit('@Marco Rossi ', '');
		expect(c.result).toMatchObject({ title: 'Call about tiles', people: ['P/Marco Rossi.md'] });
	});

	it('deleting some of their words leaves them as they are', () => {
		const c = capture().type('Call tue 10:00 now').edit(' 10:00', '');
		expect(c.text).toBe('Call tue now');
		expect(c.result.due).toBe('2026-10-13T10:00');
	});

	it('an edit elsewhere in the text leaves them as they are', () => {
		const c = capture().type('Call tue 10:00 now').edit(' 10:00', '').type(' please').edit('Call', 'Ring');
		expect(c.result).toMatchObject({ title: 'Ring tue now please', due: '2026-10-13T10:00' });
	});

	it('typing into their words reads them again', () => {
		const c = capture().type('Call tue 10:00 now').edit('tue', 'wed');
		expect(c.result.due).toBe('2026-10-14T10:00');
	});

	it('every kind stays: type, Matter and priority too', () => {
		const c = capture().type('Plant bulbs #Garden /call !1 soon').edit('#Garden /call !1 ', '');
		expect(c.result).toMatchObject({ title: 'Plant bulbs soon', typeId: 'call', matterPath: 'M/Garden.md', priority: 1 });
	});

	it('an unmatched name stays too, setting nothing', () => {
		const c = capture().type('Ask @Nobody now').edit('@Nobody ', '');
		expect(c.result.people).toEqual([]);
		expect(c.result.chips).toMatchObject([{ kind: 'person', path: null, query: 'Nobody' }]);
	});

	it('× removes one; its words, if still there, are plain words', () => {
		const c = capture().type('Call @Marco tomorrow now').remove('person').remove('date');
		expect(c.result).toMatchObject({ title: 'Call Marco tomorrow now', people: [], due: null, chips: [] });
		const d = capture().type('Call tomorrow now').edit('tomorrow ', '').remove('date');
		expect(d.result).toMatchObject({ title: 'Call now', due: null, chips: [] });
	});
});

describe('several people, one value of everything else', () => {
	it('people accumulate, each once, and removing one keeps the others', () => {
		const c = capture().type('Meet @Marco Rossi and @Ana Gil and @Marco Rossi now');
		expect(c.result.people).toEqual(['P/Marco Rossi.md', 'P/Ana Gil.md']);
		expect(c.result.chips.filter((x) => x.kind === 'person')).toHaveLength(2);
		c.edit('@Marco Rossi and @Ana Gil and @Marco Rossi ', '');
		expect(c.result.people).toEqual(['P/Marco Rossi.md', 'P/Ana Gil.md']);
		const ana = c.pills.list.find((p) => p.chip.kind === 'person' && p.chip.path === 'P/Ana Gil.md');
		c.pills = removePill(c.pills, ana?.id ?? 0);
		expect(c.click().result.people).toEqual(['P/Marco Rossi.md']);
	});

	it('the date typed last is set, even when typed before the other', () => {
		const c = capture().type('Call Marco friday now');
		expect(c.result.due).toBe('2026-10-16');
		expect(parseQuickAdd('Call Marco friday now', ctx).due).toBe('2026-10-16');
		c.edit('Marco', 'Marco tomorrow');
		expect(c.result.due).toBe('2026-10-10');
		expect(c.result.chips.filter((x) => x.kind === 'date')).toHaveLength(1);
		expect(c.result.title).toBe('Call Marco tomorrow friday now');
	});

	it('a new date replaces one whose words are gone', () => {
		const c = capture().type('Call tue 10:00 now').edit(' tue 10:00', '').click().type(' friday');
		expect(c.result.due).toBe('2026-10-16');
		expect(c.pills.list.filter((p) => p.chip.kind === 'date')).toHaveLength(1);
	});

	it('the latest type, Matter and priority are set', () => {
		const c = capture().type('Call /call #Garden !1 x').type(' /message #Kitchen renovation !3 y');
		expect(c.result).toMatchObject({ typeId: 'message', matterPath: 'M/Kitchen renovation.md', priority: 3 });
	});
});

describe('the type picker and given pills', () => {
	it('a picked type applies, unseen among the chips, until another is typed', () => {
		const c = capture().type('Call Marco /call x');
		c.pills = pickType(c.pills, 'message', 'Message');
		expect(c.click().result).toMatchObject({ typeId: 'message', chips: [] });
		c.type(' /call');
		expect(c.result.typeId).toBe('call');
	});

	it('given pills set their values without words in the title, and stay after Shift+Enter', () => {
		const c = capture();
		c.pills = givenPills(c.pills, parseQuickAdd('@Marco Rossi tomorrow', ctx).chips);
		c.type('Ask about the tiles');
		expect(c.result).toMatchObject({ title: 'Ask about the tiles', people: ['P/Marco Rossi.md'], due: '2026-10-10' });
		c.pills = clearedPills(c.pills);
		c.text = '';
		expect(c.type('Next one').result).toMatchObject({ title: 'Next one', people: ['P/Marco Rossi.md'] });
	});
});
