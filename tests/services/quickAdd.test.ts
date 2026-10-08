import { describe, expect, it } from 'vitest';
import {
	activeToken,
	dateChipLabel,
	isNameLike,
	draftOf,
	isNewPath,
	newName,
	newPath,
	replaceSpan,
	rewriteTypeToken,
	tokenName,
} from '../../src/services/quickAdd';
import { parseQuickAdd, type QuickAddContext } from '../../src/services/quickAddParser';

// Thursday 8 October 2026, 12:00 local time.
const now = new Date(2026, 9, 8, 12, 0);
const today = '2026-10-08';

const ctx: QuickAddContext = {
	now,
	types: [
		{ id: 'call', names: ['call', 'Call'] },
		{ id: 'follow-up', names: ['follow-up', 'Follow up'] },
	],
	matters: [{ path: 'M/Kitchen renovation.md', names: ['Kitchen renovation'] }],
	people: [{ path: 'P/Marco Rossi.md', names: ['Marco Rossi'], rank: 0 }],
};

describe('activeToken', () => {
	it('finds the # or @ word at the caret', () => {
		const input = 'Call #kit';
		expect(activeToken(input, input.length)).toEqual({ sigil: '#', start: 5, end: 9, query: 'kit', quoted: false });
		expect(activeToken('Call @', 6)).toEqual({ sigil: '@', start: 5, end: 6, query: '', quoted: false });
	});

	it('extends to the end of the word when the caret is inside it', () => {
		expect(activeToken('Call #kitchen now', 8)).toMatchObject({ start: 5, end: 13, query: 'ki' });
	});

	it('carries on across a space, so a surname can follow', () => {
		expect(activeToken('Call @Ana ', 10)).toMatchObject({ start: 5, query: 'Ana' });
		expect(activeToken('Call @Ana García', 16)).toMatchObject({ start: 5, query: 'Ana García' });
	});

	it('spans several words, up to the next token', () => {
		expect(activeToken('#kitchen ren', 12)).toMatchObject({ query: 'kitchen ren' });
		expect(activeToken('#kitchen !1 now', 15)).toBeNull();
		expect(activeToken('#kitchen /call now', 18)).toBeNull();
	});

	it('handles quotes', () => {
		expect(activeToken('Call #"Garden sh', 16)).toEqual({ sigil: '#', start: 5, end: 16, query: 'Garden sh', quoted: true });
		expect(activeToken('Call #"Garden shed" now', 23)).toBeNull();
	});

	it('ignores sigils inside words and other tokens', () => {
		expect(activeToken('mail a@b', 8)).toBeNull();
		expect(activeToken('/call', 5)).toBeNull();
		expect(activeToken('Paint', 5)).toBeNull();
	});
});

describe('replaceSpan and tokenName', () => {
	it('quotes names with spaces', () => {
		expect(tokenName('Kitchen')).toBe('Kitchen');
		expect(tokenName('Kitchen renovation')).toBe('"Kitchen renovation"');
	});

	it('leaves one space after the replacement and puts the caret after it', () => {
		expect(replaceSpan('Call #kit', 5, 9, '#Kitchen')).toEqual({ input: 'Call #Kitchen ', caret: 14 });
		expect(replaceSpan('Call #kit now', 5, 9, '#Kitchen')).toEqual({ input: 'Call #Kitchen now', caret: 14 });
	});
});

describe('rewriteTypeToken', () => {
	it('replaces the last type token, valid or not', () => {
		const input = '/shop Paint /call';
		const { chips } = parseQuickAdd(input, ctx);
		expect(rewriteTypeToken(input, chips, 'Meet')).toBe('/shop Paint /Meet');
		const invalid = parseQuickAdd('/shop Paint', ctx);
		expect(rewriteTypeToken('/shop Paint', invalid.chips, 'Follow up')).toBe('/"Follow up" Paint');
	});

	it('returns null without a type token', () => {
		expect(rewriteTypeToken('Paint', parseQuickAdd('Paint', ctx).chips, 'Meet')).toBeNull();
	});
});

describe('dateChipLabel', () => {
	it('shows relative days with the date', () => {
		expect(dateChipLabel(null, '2026-10-09', today)).toBe('Tomorrow · Fri 9 Oct');
		expect(dateChipLabel(null, '2026-10-08T15:00', today)).toBe('Today · Thu 8 Oct · 15:00');
		expect(dateChipLabel(null, '2026-10-10', today)).toBe('Saturday · 10 Oct');
	});

	it('shows later dates and other years in short form', () => {
		expect(dateChipLabel(null, '2026-10-20', today)).toBe('Tue 20 Oct');
		expect(dateChipLabel(null, '2027-01-05', today)).toBe('Tue 5 Jan 2027');
	});

	it('shows ranges', () => {
		expect(dateChipLabel('2026-10-12', '2026-10-14', today)).toBe('Mon 12 Oct → Wed 14 Oct');
		expect(dateChipLabel('2026-10-12T09:00', '2026-10-12T11:00', today)).toBe('Mon 12 Oct · 09:00 → Mon 12 Oct · 11:00');
	});
});

describe('new Matters and people', () => {
	it('round-trips names through stand-in paths', () => {
		const path = newPath('Garden shed');
		expect(isNewPath(path)).toBe(true);
		expect(isNewPath('M/Garden shed.md')).toBe(false);
		expect(newName(path)).toBe('Garden shed');
	});
});

describe('draftOf', () => {
	const defaults = {
		contextMatter: null,
		contextStatus: null,
		pickedType: null,
		inboxPath: 'M/Inbox.md',
		backlogId: 'later',
		defaultTypeId: 'write',
	};

	it('falls back to the Inbox, the backlog and the default type', () => {
		const draft = draftOf(parseQuickAdd('Paint samples', ctx), defaults);
		expect(draft).toMatchObject({
			title: 'Paint samples',
			typeId: 'write',
			matterPath: 'M/Inbox.md',
			matterIsDefault: true,
			statusId: 'later',
			statusIsDefault: true,
			canAdd: true,
		});
	});

	it('uses the context, then lets tokens replace the Matter', () => {
		const withContext = { ...defaults, contextMatter: 'M/Garden.md', contextStatus: 'doing' };
		expect(draftOf(parseQuickAdd('Paint', ctx), withContext)).toMatchObject({ matterPath: 'M/Garden.md', matterIsDefault: false, statusId: 'doing' });
		expect(draftOf(parseQuickAdd('Paint #kitchen', ctx), withContext).matterPath).toBe('M/Kitchen renovation.md');
	});

	it('prefers a typed type over the picked one', () => {
		const picked = { ...defaults, pickedType: 'follow-up' };
		expect(draftOf(parseQuickAdd('Paint', ctx), picked).typeId).toBe('follow-up');
		expect(draftOf(parseQuickAdd('/call Paint', ctx), picked).typeId).toBe('call');
		expect(draftOf(parseQuickAdd('/shop Paint', ctx), picked).typeId).toBe('follow-up');
	});

	it('uses the context date until a date is typed', () => {
		const withDay = { ...defaults, contextDue: '2026-10-21' };
		expect(draftOf(parseQuickAdd('Paint', ctx), withDay)).toMatchObject({ due: '2026-10-21', dueFromContext: true });
		expect(draftOf(parseQuickAdd('Paint tomorrow', ctx), withDay)).toMatchObject({ due: '2026-10-09', dueFromContext: false });
	});

	it('cannot add without a title', () => {
		expect(draftOf(parseQuickAdd('/call #kitchen', ctx), defaults).canAdd).toBe(false);
	});
});

describe('isNameLike', () => {
	it('accepts surnames and particles', () => {
		expect(isNameLike('Ana')).toBe(true);
		expect(isNameLike('Ana García')).toBe(true);
		expect(isNameLike('Juan de la Cruz')).toBe(true);
		// Still typing: a particle may come last.
		expect(isNameLike('Juan de')).toBe(true);
	});

	it('rejects lowercase words, conjunctions and date words', () => {
		expect(isNameLike('Ana call')).toBe(false);
		expect(isNameLike('Ana y Marco')).toBe(false);
		expect(isNameLike('Ana Monday')).toBe(false);
		expect(isNameLike('Ana Mañana')).toBe(false);
	});
});
