import { describe, expect, it } from 'vitest';
import { updateAction } from '../../src/ops/updateAction';
import type { OpResult, UpdateActionInput } from '../../src/ops/types';
import { snapshot, VAULT, vault } from './snapshot';

const s = vault();
const WORKTOP = 'MTM/Actions/Confirm the worktop measurements.md';
const QUOTE = 'MTM/Actions/Revised quote from Marco.md';
const CALL = 'MTM/Actions/Call Marco about the quote.md';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

const update = (input: UpdateActionInput, snap = s) => ok(updateAction(input, snap));
const edit = (input: UpdateActionInput, snap = s) => {
	const r = update(input, snap);
	const e = r.plan.edits[0];
	if (!e) throw new Error('no edit planned');
	return { r, ...e };
};

describe('updateAction: changing fields', () => {
	it('writes status, type and Matter explicitly with every frontmatter change', () => {
		const { set, remove, path, r } = edit({ action: WORKTOP, priority: 2 });
		expect(path).toBe(WORKTOP);
		expect(set).toEqual({ 'mtm-status': 'next', 'mtm-type': 'call', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-priority': 2 });
		expect(remove).toEqual([]);
		expect(r.changes).toEqual([{ kind: 'property', path: WORKTOP, key: 'mtm-priority', from: 1, to: 2 }]);
		expect(r.value.changed).toBe(true);
		expect(r.value.action.priority).toBe(2);
	});

	it('moves to another status, type and Matter by label or name', () => {
		const { set } = edit({ action: WORKTOP, status: 'doing', type: 'Visit', matter: 'advisory' });
		expect(set).toMatchObject({ 'mtm-status': 'doing', 'mtm-type': 'visit', 'mtm-matter': '[[Advisory work]]' });
	});

	it('removes values given as null', () => {
		const { set, remove } = edit({ action: WORKTOP, due: null, priority: null });
		expect(remove.sort()).toEqual(['mtm-due', 'mtm-priority']);
		expect(set).toEqual({ 'mtm-status': 'next', 'mtm-type': 'call', 'mtm-matter': '[[Kitchen renovation]]' });
	});

	it('reads dates in words', () => {
		expect(edit({ action: WORKTOP, due: 'next monday' }).set['mtm-due']).toBe('2026-10-12');
	});

	it('replaces the people', () => {
		const { set, remove } = edit({ action: CALL, people: ['Lucía Pérez'] });
		expect(set['mtm-people']).toEqual(['[[Lucía Pérez]]']);
		expect(edit({ action: CALL, people: [] }).remove).toEqual(['mtm-people']);
		expect(remove).toEqual([]);
	});

	it('writes the orphaned values it shows, which clears the badges', () => {
		const { set, r } = edit({ action: 'Mystery', priority: 3 });
		expect(set).toEqual({ 'mtm-status': 'later', 'mtm-type': 'write', 'mtm-matter': '[[Inbox]]', 'mtm-priority': 3 });
		expect(r.value.action.orphans).toEqual([]);
	});

	it('plans nothing when nothing changes', () => {
		const r = update({ action: WORKTOP, status: 'Next', priority: 1 });
		expect(r.plan).toEqual({ creates: [], edits: [], bodies: [], renames: [] });
		expect(r.changes).toEqual([]);
		expect(r.value.changed).toBe(false);
	});

	it('edits the body: details, checklist items added, a link line', () => {
		const r = update({ action: WORKTOP, details: 'New details.', checklist: ['Book the fitter'], link: 'https://example.com' });
		expect(r.plan.edits).toEqual([]);
		expect(r.plan.bodies).toEqual([
			{ path: WORKTOP, edit: { kind: 'details', text: 'New details.' } },
			{ path: WORKTOP, edit: { kind: 'checklist', items: ['Book the fitter'] } },
			{ path: WORKTOP, edit: { kind: 'link', line: '<https://example.com/>' } },
		]);
		expect(r.changes[0]).toEqual({ kind: 'details', path: WORKTOP, from: 'Confirm the worktop measurements before ordering.', to: 'New details.' });
	});

	it('the same details again plan nothing', () => {
		const r = update({ action: WORKTOP, details: 'Confirm the worktop measurements before ordering.' });
		expect(r.plan.bodies).toEqual([]);
		expect(r.value.changed).toBe(false);
	});

	it.each([
		['people', { people: 'Marco' }],
		['checklist', { checklist: 'One' }],
		['waiting-on', { waitingOn: 3 }],
	])('%s from other tools must have the right shape', (field, extra) => {
		expect(updateAction({ action: WORKTOP, ...(extra as object) }, s)).toMatchObject({ ok: false, error: { code: 'invalid', field } });
	});

	it('warns when the start ends up after the due date', () => {
		expect(update({ action: WORKTOP, start: '2026-10-12' }).warnings.map((w) => w.code)).toEqual(['start-after-due']);
	});
});

describe('updateAction: completion date', () => {
	it('entering a closed status sets it to today', () => {
		const { set, r } = edit({ action: WORKTOP, status: 'done' });
		expect(set['mtm-completed']).toBe('2026-10-09');
		expect(r.value.action.completed).toBe('2026-10-09');
	});

	it('leaving a closed status removes it', () => {
		expect(edit({ action: 'Order the tiles', status: 'next' }).remove).toContain('mtm-completed');
	});

	it('moving between open statuses leaves it alone', () => {
		const { set, remove } = edit({ action: WORKTOP, status: 'doing' });
		expect(set['mtm-completed']).toBeUndefined();
		expect(remove).toEqual([]);
	});
});

describe('updateAction: waiting since', () => {
	it.each([
		['set', WORKTOP, 'Marco Rossi', { 'mtm-waiting-on': '[[Marco Rossi]]', 'mtm-waiting-since': '2026-10-09' }, []],
		['changed to another person', QUOTE, 'Lucía', { 'mtm-waiting-on': '[[Lucía Pérez]]', 'mtm-waiting-since': '2026-10-09' }, []],
		['removed', QUOTE, null, {}, ['mtm-waiting-on', 'mtm-waiting-since']],
	] as const)('%s', (_, action, waitingOn, set, remove) => {
		const e = edit({ action, waitingOn });
		expect(e.set).toMatchObject(set);
		expect(e.remove.sort()).toEqual([...remove].sort());
	});

	it('the same person again keeps the date', () => {
		const r = update({ action: QUOTE, waitingOn: '[[Marco Rossi]]' });
		expect(r.plan.edits).toEqual([]);
	});

	it('setting someone adds them to the people', () => {
		expect(edit({ action: WORKTOP, waitingOn: 'Lucía' }).set['mtm-people']).toEqual(['[[Lucía Pérez]]']);
		expect(edit({ action: QUOTE, waitingOn: 'Lucía' }).set['mtm-people']).toEqual(['[[Marco Rossi]]', '[[Lucía Pérez]]']);
	});
});

describe('updateAction: the position on boards ordered by hand', () => {
	it.each([
		['another status', { status: 'doing' }, true],
		['another Matter', { matter: 'Inbox' }, true],
		['another type', { type: 'message' }, false],
		['a date', { due: '2026-10-30' }, false],
	])('is removed when it moves to %s', (_, fields, removed) => {
		expect(edit({ action: CALL, ...fields }).remove.includes('mtm-order')).toBe(removed);
	});
});

describe('updateAction: renames', () => {
	it('a new title plans a rename in the same folder', () => {
		const r = update({ action: WORKTOP, title: 'Confirm: the sizes' });
		expect(r.plan.renames).toEqual([{ from: WORKTOP, to: 'MTM/Actions/Confirm the sizes.md' }]);
		expect(r.value.action.path).toBe('MTM/Actions/Confirm the sizes.md');
		expect(r.value.action.title).toBe('Confirm the sizes');
	});

	it('appends " 2" when the name is taken, ignoring case', () => {
		const r = update({ action: WORKTOP, title: 'pay the council tax' });
		expect(r.plan.renames).toEqual([{ from: WORKTOP, to: 'MTM/Actions/pay the council tax 2.md' }]);
	});

	it('a change of case renames the note to itself', () => {
		const r = update({ action: WORKTOP, title: 'Confirm the Worktop measurements' });
		expect(r.plan.renames).toEqual([{ from: WORKTOP, to: 'MTM/Actions/Confirm the Worktop measurements.md' }]);
	});

	it('the same title once sanitised plans nothing', () => {
		expect(update({ action: WORKTOP, title: 'Confirm the worktop: measurements' }).plan.renames).toEqual([]);
	});

	it('edits name the path before the rename', () => {
		const r = update({ action: WORKTOP, title: 'Measure', status: 'doing' });
		expect(r.plan.edits[0]?.path).toBe(WORKTOP);
		expect(r.plan.renames).toEqual([{ from: WORKTOP, to: 'MTM/Actions/Measure.md' }]);
		expect(r.changes.at(-1)).toEqual({ kind: 'rename', from: WORKTOP, to: 'MTM/Actions/Measure.md' });
	});
});

describe('updateAction: refusals plan nothing', () => {
	it.each([
		['status', { status: 'Someday' }, 'unmatched', 'No status matches “Someday”. Statuses here: Later, Next, Doing, Waiting, Done.'],
		['type', { type: 'fax' }, 'unmatched', 'No type matches “fax”. Types here: Call, Message, Write, Meet, Buy, Visit.'],
		['matter', { matter: 'Gym' }, 'unmatched', 'No Matter matches “Gym”.'],
		['waiting-on', { waitingOn: 'Nobody' }, 'unmatched', 'No note matches “Nobody”. People are notes, and they’re never created from here.'],
		['people', { people: ['Marco', 'Nobody'] }, 'unmatched', 'No note matches “Nobody”. People are notes, and they’re never created from here.'],
		['priority', { priority: 'soon' }, 'invalid', '“soon” isn’t a priority. Use 1, 2 or 3, or high, medium or low.'],
		['due', { due: 'whenever' }, 'invalid', undefined],
		['link', { link: 'obsidian://open' }, 'invalid', undefined],
		['title', { title: '###' }, 'invalid', 'An Action needs a title.'],
	] as const)('%s', (field, fields, code, message) => {
		const r = updateAction({ action: WORKTOP, ...fields }, s);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatchObject({ code, field });
		if (message) expect(r.error.message).toBe(message);
		expect('plan' in r).toBe(false);
	});

	it('the valid labels come with an unmatched status', () => {
		const r = updateAction({ action: WORKTOP, status: 'Someday' }, s);
		expect(r.ok ? null : r.error.candidates).toEqual(['Later', 'Next', 'Doing', 'Waiting', 'Done']);
	});

	it('nothing to change', () => {
		expect(updateAction({ action: WORKTOP }, s)).toMatchObject({ ok: false, error: { code: 'invalid', message: 'Nothing to change: name at least one field.' } });
	});

	it('before setup', () => {
		expect(updateAction({ action: WORKTOP, priority: 1 }, vault({}, { settings: { setupDone: false } }))).toMatchObject({ ok: false, error: { code: 'not-ready' } });
	});
});

describe('updateAction: naming the Action', () => {
	it.each([
		['its path', WORKTOP],
		['its path without .md', 'MTM/Actions/Confirm the worktop measurements'],
		['its title', 'Confirm the worktop measurements'],
		['a wikilink', '[[Confirm the worktop measurements]]'],
		['the start of its title', 'Confirm the worktop'],
	])('by %s', (_, action) => {
		expect(edit({ action, priority: 3 }).path).toBe(WORKTOP);
	});

	it('several matches are an error listing them', () => {
		expect(updateAction({ action: 'Call Marco', priority: 1 }, s)).toEqual({
			ok: false,
			error: {
				code: 'ambiguous',
				field: 'action',
				value: 'Call Marco',
				message: 'Several Actions match “Call Marco”.',
				candidates: ['MTM/Actions/Call Marco about the quote.md', 'MTM/Actions/Call Marco back.md'],
			},
		});
	});

	it('every strong match counts, not only the best one', () => {
		// "Call Marco about the quote" scores higher than "Call Marcos", but both are strong: a write never guesses.
		const rest = Object.fromEntries(Object.entries(VAULT).filter(([path]) => path !== 'MTM/Actions/Call Marco back.md'));
		const s2 = snapshot({ ...rest, 'MTM/Actions/Call Marcos.md': { frontmatter: { 'mtm-kind': 'action' } } });
		const r = updateAction({ action: 'Call Marco', status: 'done' }, s2);
		expect(r).toMatchObject({ ok: false, error: { code: 'ambiguous', candidates: ['MTM/Actions/Call Marco about the quote.md', 'MTM/Actions/Call Marcos.md'] } });
	});

	it('two Actions with the same title in different folders are ambiguous by title', () => {
		const s2 = vault({ 'Archive/Pay the council tax.md': { frontmatter: { 'mtm-kind': 'action' } } });
		const r = updateAction({ action: 'Pay the council tax', priority: 1 }, s2);
		expect(r.ok ? null : r.error.code).toBe('ambiguous');
		expect(ok(updateAction({ action: 'Archive/Pay the council tax', priority: 1 }, s2)).plan.edits[0]?.path).toBe('Archive/Pay the council tax.md');
	});

	it('a note that is not an Action is not found', () => {
		expect(updateAction({ action: 'Some note', priority: 1 }, s)).toMatchObject({ ok: false, error: { code: 'not-found', message: 'No Action matches “Some note”.' } });
	});
});
