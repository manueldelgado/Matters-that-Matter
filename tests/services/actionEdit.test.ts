import { describe, expect, it } from 'vitest';
import { applyFieldEdit, peopleList, type KeyOf } from '../../src/services/actionEdit';

// Link text stands in for the resolved path.
const keyOf: KeyOf = (raw) => (typeof raw === 'string' ? raw.replace(/^\[\[|\]\]$/g, '') : null);
const marco = { link: '[[Marco Rossi]]', key: 'Marco Rossi' };
const ana = { link: '[[Ana]]', key: 'Ana' };
const TODAY = '2026-10-08';

describe('peopleList', () => {
	it('accepts a single value, a list or nothing', () => {
		expect(peopleList(undefined)).toEqual([]);
		expect(peopleList('[[Ana]]')).toEqual(['[[Ana]]']);
		expect(peopleList(['[[Ana]]', '[[Bo]]'])).toEqual(['[[Ana]]', '[[Bo]]']);
	});
});

describe('applyFieldEdit', () => {
	it('sets and removes priority and dates', () => {
		const fm: Record<string, unknown> = { 'mtm-priority': 2 };
		applyFieldEdit(fm, { priority: 1, start: { date: '2026-10-15' }, due: { date: '2026-10-16', time: '09:30' } }, keyOf, TODAY);
		expect(fm).toEqual({ 'mtm-priority': 1, 'mtm-start': '2026-10-15', 'mtm-due': '2026-10-16T09:30' });
		applyFieldEdit(fm, { priority: null, start: null }, keyOf, TODAY);
		expect(fm).toEqual({ 'mtm-due': '2026-10-16T09:30' });
	});

	it('leaves fields that are not edited alone', () => {
		const fm: Record<string, unknown> = { 'mtm-people': '[[Ana]]', 'mtm-due': '2026-10-01' };
		applyFieldEdit(fm, { priority: 3 }, keyOf, TODAY);
		expect(fm).toEqual({ 'mtm-people': '[[Ana]]', 'mtm-due': '2026-10-01', 'mtm-priority': 3 });
	});

	it('adds the waiting-on person to the people once', () => {
		const fm: Record<string, unknown> = { 'mtm-people': ['[[Marco Rossi]]'] };
		applyFieldEdit(fm, { waitingOn: marco }, keyOf, TODAY);
		expect(fm).toEqual({ 'mtm-waiting-on': '[[Marco Rossi]]', 'mtm-waiting-since': TODAY, 'mtm-people': ['[[Marco Rossi]]'] });
	});

	it('clearing waiting-on keeps the person among the people', () => {
		const fm: Record<string, unknown> = { 'mtm-waiting-on': '[[Ana]]', 'mtm-waiting-since': '2026-09-01', 'mtm-people': ['[[Ana]]'] };
		applyFieldEdit(fm, { waitingOn: null }, keyOf, TODAY);
		expect(fm).toEqual({ 'mtm-people': ['[[Ana]]'] });
	});

	it('adds and removes people, dropping an empty list', () => {
		const fm: Record<string, unknown> = { 'mtm-people': '[[Ana]]' };
		applyFieldEdit(fm, { addPerson: marco }, keyOf, TODAY);
		expect(fm['mtm-people']).toEqual(['[[Ana]]', '[[Marco Rossi]]']);
		applyFieldEdit(fm, { addPerson: ana }, keyOf, TODAY);
		expect(fm['mtm-people']).toEqual(['[[Ana]]', '[[Marco Rossi]]']);
		applyFieldEdit(fm, { removePerson: 'Ana' }, keyOf, TODAY);
		applyFieldEdit(fm, { removePerson: 'Marco Rossi' }, keyOf, TODAY);
		expect('mtm-people' in fm).toBe(false);
	});

	it('restarts the wait for another person, keeps it for the same one', () => {
		const fm: Record<string, unknown> = { 'mtm-waiting-on': '[[Ana]]', 'mtm-waiting-since': '2026-09-01' };
		applyFieldEdit(fm, { waitingOn: ana }, keyOf, TODAY);
		expect(fm['mtm-waiting-since']).toBe('2026-09-01');
		applyFieldEdit(fm, { waitingOn: marco }, keyOf, TODAY);
		expect(fm['mtm-waiting-since']).toBe(TODAY);
	});

	it('edits the waiting-since date directly', () => {
		const fm: Record<string, unknown> = { 'mtm-waiting-on': '[[Ana]]', 'mtm-waiting-since': TODAY };
		applyFieldEdit(fm, { waitingSince: '2026-09-20' }, keyOf, TODAY);
		expect(fm['mtm-waiting-since']).toBe('2026-09-20');
		applyFieldEdit(fm, { waitingSince: null }, keyOf, TODAY);
		expect('mtm-waiting-since' in fm).toBe(false);
	});
});
