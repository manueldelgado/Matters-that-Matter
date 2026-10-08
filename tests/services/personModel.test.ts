import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { firstName, personModel, personToken } from '../../src/services/personModel';

const now = new Date(2026, 9, 8, 12, 0);
const item = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', ...fm }, DEFAULT_SETTINGS, () => null);

describe('personModel', () => {
	const marco = '[[Marco Rossi]]';
	const entries = [
		{ item: item('Recent wait', { 'mtm-status': 'waiting', 'mtm-waiting-on': marco, 'mtm-waiting-since': '2026-10-01' }), waiting: true },
		{ item: item('Old wait', { 'mtm-status': 'waiting', 'mtm-waiting-on': marco, 'mtm-waiting-since': '2026-09-15' }), waiting: true },
		{ item: item('Undated wait', { 'mtm-status': 'waiting', 'mtm-waiting-on': marco }), waiting: true },
		{ item: item('Tiles', { 'mtm-status': 'next', 'mtm-due': '2026-10-13' }), waiting: false },
		{ item: item('Measure', { 'mtm-status': 'next', 'mtm-due': '2026-10-07', 'mtm-priority': 1 }), waiting: false },
		{ item: item('Old call', { 'mtm-status': 'done', 'mtm-completed': '2026-09-30' }), waiting: false },
		{ item: item('Older call', { 'mtm-status': 'done', 'mtm-completed': '2026-09-02' }), waiting: true },
	];

	it('lists waits oldest first, undated last, and the rest in card order', () => {
		const m = personModel(entries, now);
		expect(m.waiting.map((i) => i.title)).toEqual(['Old wait', 'Recent wait', 'Undated wait']);
		expect(m.withThem.map((i) => i.title)).toEqual(['Measure', 'Tiles']);
	});

	it('counts late and done, with the last completion', () => {
		expect(personModel(entries, now)).toMatchObject({ late: 1, done: 2, lastDone: '2026-09-30' });
	});
});

describe('person names', () => {
	it('takes the first name and quotes multi-word tokens', () => {
		expect(firstName('Marco Rossi')).toBe('Marco');
		expect(personToken('Marco Rossi')).toBe('@"Marco Rossi" ');
		expect(personToken('Lucía')).toBe('@Lucía ');
	});
});
