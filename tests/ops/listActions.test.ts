import { describe, expect, it } from 'vitest';
import { listActions } from '../../src/ops/listActions';
import type { ListActionsInput, OpResult } from '../../src/ops/types';
import { vault } from './snapshot';

const s = vault();

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

const titles = (input: ListActionsInput) => ok(listActions(input, s)).value.map((a) => a.title);

describe('listActions', () => {
	it('lists open Actions as the list view: Matters in board order, then status, then card order', () => {
		expect(titles({})).toEqual([
			// The Inbox at the top; its orphaned status reads as the backlog.
			'Call Marco back',
			'Mystery',
			'Pay the council tax',
			// Kitchen renovation (Home), then Advisory work (Work); Garden has no Sphere.
			'Confirm the worktop measurements',
			'Call Marco about the quote',
			'Revised quote from Marco',
			'Send the invoice',
		]);
	});

	it.each([
		['Matter', { matter: 'Kitchen' }, ['Confirm the worktop measurements', 'Call Marco about the quote', 'Revised quote from Marco']],
		['status', { status: 'Next' }, ['Pay the council tax', 'Confirm the worktop measurements', 'Call Marco about the quote']],
		['type', { type: 'call' }, ['Call Marco back', 'Confirm the worktop measurements', 'Call Marco about the quote']],
		['Sphere', { sphere: 'Work' }, ['Send the invoice']],
		['person', { person: 'Marco' }, ['Call Marco about the quote', 'Revised quote from Marco']],
		['person', { person: 'Lucía Pérez' }, ['Call Marco about the quote']],
		['waiting', { waiting: true }, ['Revised quote from Marco']],
		['due range', { dueFrom: '2026-10-09', dueTo: '2026-10-31' }, ['Confirm the worktop measurements', 'Send the invoice']],
		['due by, in words', { dueTo: 'today' }, ['Pay the council tax', 'Confirm the worktop measurements']],
		['several filters', { matter: 'Kitchen renovation', type: 'Call' }, ['Confirm the worktop measurements', 'Call Marco about the quote']],
	] as const)('by %s', (_, input, expected) => {
		expect(titles(input)).toEqual(expected);
	});

	it.each([
		['dueFrom', 'due-from', '2026-10-09T00:00:00Z'],
		['dueTo', 'due-to', '2026-13-12'],
	] as const)('%s reads dates as adding does: a time zone or a month 13 is refused', (key, field, value) => {
		expect(listActions({ [key]: value }, s)).toMatchObject({ ok: false, error: { code: 'invalid', field, value } });
	});

	it('closed Actions only when asked, or when the status asked for is closed', () => {
		expect(titles({ matter: 'Kitchen renovation', done: true })).toContain('Order the tiles');
		expect(titles({ status: 'Done' })).toEqual(['Order the tiles']);
		expect(titles({})).not.toContain('Order the tiles');
	});

	it('returns what scripts need without re-implementing the rules', () => {
		const [first] = ok(listActions({ matter: 'Kitchen' }, s)).value;
		expect(first).toMatchObject({
			path: 'MTM/Actions/Confirm the worktop measurements.md',
			matter: { path: 'MTM/Matters/Kitchen renovation.md', name: 'Kitchen renovation' },
			status: { id: 'next', label: 'Next', category: 'open' },
			type: { id: 'call', label: 'Call' },
			due: '2026-10-09T10:00',
			priority: 1,
			overdue: true,
			today: true,
			orphans: [],
		});
	});

	it.each([
		['matter', { matter: 'Gym' }, 'unmatched'],
		['status', { status: 'Someday' }, 'unmatched'],
		['sphere', { sphere: 'Family' }, 'unmatched'],
		['person', { person: 'Nobody' }, 'unmatched'],
		['due-to', { dueTo: 'whenever' }, 'invalid'],
	] as const)('a filter that matches nothing is an error: %s', (field, input, code) => {
		expect(listActions(input, s)).toMatchObject({ ok: false, error: { code, field } });
	});
});
