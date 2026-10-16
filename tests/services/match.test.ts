import { describe, expect, it } from 'vitest';
import { matchDefined, matchNote, type Match, type NamedNote } from '../../src/services/match';
import { DEFAULT_SETTINGS } from '../../src/settings';

const picked = <T extends { id?: string | null; path?: string }>(m: Match<T>) =>
	m.kind === 'match' ? (m.item.id ?? m.item.path) : m.kind === 'ambiguous' ? m.items.map((i) => i.id ?? i.path) : null;

describe('matchDefined: statuses, types and Spheres', () => {
	const statuses = [...DEFAULT_SETTINGS.statuses, { id: 'waiting-2', label: 'Waiting room', tone: 'ink' as const, category: 'open' as const }];
	const types = [
		{ id: 'call', label: 'Calls' },
		{ id: 'computer', label: 'Computer' },
		{ id: 'cafe', label: 'Café' },
		{ id: 'errands', label: 'Errands' },
	];

	it.each([
		['by exact ID', 'next', statuses, 'next'],
		['by label, ignoring case', 'DOING', statuses, 'doing'],
		['by label, ignoring accents', 'cafe', types, 'cafe'],
		['by label with accents typed', 'Café', types, 'cafe'],
		['an ID wins over a label', 'call', types, 'call'],
		['by a strong fuzzy match on labels', 'err', types, 'errands'],
		['by the first words of a label', 'waiting r', statuses, 'waiting-2'],
	] as const)('%s', (_, query, items, expected) => {
		expect(picked(matchDefined(query, items))).toBe(expected);
	});

	it('several equally good matches are ambiguous', () => {
		expect(picked(matchDefined('c', types))).toEqual(['call', 'computer', 'cafe']);
		expect(picked(matchDefined('co', types))).toBe('computer');
	});

	it('an exact label wins over a longer one it starts', () => {
		expect(picked(matchDefined('Waiting', statuses))).toBe('waiting');
	});

	it.each(['Someday', '', '   ', 'xyz'])('%j matches nothing', (query) => {
		expect(matchDefined(query, statuses).kind).toBe('none');
	});
});

describe('matchNote: Matters, people and Actions', () => {
	const notes: NamedNote[] = [
		{ path: 'MTM/Matters/Kitchen renovation.md', name: 'Kitchen renovation' },
		{ path: 'MTM/Matters/Kitchen garden.md', name: 'Kitchen garden' },
		{ path: 'MTM/Matters/Inbox.md', name: 'Inbox' },
		{ path: 'Work/Inbox.md', name: 'Inbox' },
		{ path: 'People/Marco Rossi.md', name: 'Marco Rossi', rank: 0 },
		{ path: 'Elsewhere/Marco Polo.md', name: 'Marco Polo', rank: 1 },
	];
	const resolve = (text: string) => (text === 'Matters/Kitchen renovation' ? 'MTM/Matters/Kitchen renovation.md' : null);

	it.each([
		['by path', 'MTM/Matters/Kitchen garden.md', 'MTM/Matters/Kitchen garden.md'],
		['by path without .md', 'MTM/Matters/Kitchen garden', 'MTM/Matters/Kitchen garden.md'],
		['by path ignoring case', 'mtm/matters/kitchen GARDEN.md', 'MTM/Matters/Kitchen garden.md'],
		['by path, where names clash', 'Work/Inbox', 'Work/Inbox.md'],
		['by name', 'Kitchen renovation', 'MTM/Matters/Kitchen renovation.md'],
		['by name ignoring case', 'kitchen renovation', 'MTM/Matters/Kitchen renovation.md'],
		['by a wikilink, with alias and heading', '[[Kitchen garden#Plan|the garden]]', 'MTM/Matters/Kitchen garden.md'],
		['by link text as a wikilink resolves it', 'Matters/Kitchen renovation', 'MTM/Matters/Kitchen renovation.md'],
		['by a strong fuzzy match', 'kitchen ren', 'MTM/Matters/Kitchen renovation.md'],
		['by a fuzzy match ignoring accents', 'kítchen gar', 'MTM/Matters/Kitchen garden.md'],
		['the lower rank wins a tie (the people folder first)', 'Marco', 'People/Marco Rossi.md'],
	])('%s', (_, query, expected) => {
		expect(picked(matchNote(query, notes, resolve))).toBe(expected);
	});

	it('two notes with the same name are ambiguous, even where a wikilink would pick one', () => {
		expect(picked(matchNote('Inbox', notes, () => 'MTM/Matters/Inbox.md'))).toEqual(['MTM/Matters/Inbox.md', 'Work/Inbox.md']);
	});

	it('the same name: the lower rank wins, equal ranks are ambiguous', () => {
		const twins: NamedNote[] = [
			{ path: 'Notes/Marco Rossi.md', name: 'Marco Rossi', rank: 1 },
			{ path: 'People/Marco Rossi.md', name: 'Marco Rossi', rank: 0 },
			{ path: 'Archive/Marco Rossi.md', name: 'Marco Rossi', rank: 1 },
		];
		expect(picked(matchNote('Marco Rossi', twins))).toBe('People/Marco Rossi.md');
		expect(picked(matchNote('Marco Rossi', twins.filter((n) => n.rank === 1)))).toEqual(['Notes/Marco Rossi.md', 'Archive/Marco Rossi.md']);
	});

	it('with anyStrong, every strong fuzzy match counts, not only the best', () => {
		const actions: NamedNote[] = [
			{ path: 'A/Call Marco about the quote.md', name: 'Call Marco about the quote' },
			{ path: 'A/Call Marcos.md', name: 'Call Marcos' },
		];
		expect(picked(matchNote('Call Marco', actions))).toBe('A/Call Marco about the quote.md');
		expect(picked(matchNote('Call Marco', actions, undefined, { anyStrong: true }))).toEqual(['A/Call Marco about the quote.md', 'A/Call Marcos.md']);
		expect(picked(matchNote('Call Marco ab', actions, undefined, { anyStrong: true }))).toBe('A/Call Marco about the quote.md');
	});

	it('equally good fuzzy matches are ambiguous', () => {
		expect(picked(matchNote('Kitchen', notes))).toEqual(['MTM/Matters/Kitchen renovation.md', 'MTM/Matters/Kitchen garden.md']);
	});

	it.each(['Gym', '', '[[]]', 'ktch'])('%j matches nothing', (query) => {
		expect(matchNote(query, notes, resolve).kind).toBe('none');
	});

	it('a resolved path that is not among the notes is no match', () => {
		expect(matchNote('Elsewhere thing', notes, () => 'Some/other.md').kind).toBe('none');
	});
});
