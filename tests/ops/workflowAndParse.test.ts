import { describe, expect, it } from 'vitest';
import { getWorkflow } from '../../src/ops/getWorkflow';
import { parseQuickAdd } from '../../src/ops/parseQuickAdd';
import type { OpResult } from '../../src/ops/types';
import { vault } from './snapshot';

const s = vault();

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

describe('getWorkflow', () => {
	it('lists statuses, types and Spheres with IDs, labels, categories and flags', () => {
		const value = ok(getWorkflow(s)).value;
		expect(value.statuses[0]).toEqual({ id: 'later', label: 'Later', category: 'open', tone: 'ink', backlog: true, done: false });
		expect(value.statuses.find((x) => x.done)?.id).toBe('done');
		expect(value.types.find((x) => x.default)).toEqual({ id: 'write', label: 'Write', icon: 'pencil-line', tone: 'butter', default: true });
		expect(value.spheres).toEqual([
			{ id: 'home', label: 'Home', icon: 'house' },
			{ id: 'work', label: 'Work', icon: 'briefcase' },
		]);
	});

	it('the vault needs a workflow', () => {
		expect(getWorkflow(vault({}, { settings: { statuses: [] } }))).toMatchObject({ ok: false, error: { code: 'not-ready' } });
	});
});

describe('parseQuickAdd', () => {
	it('says what adding would make, without planning anything', () => {
		const r = ok(parseQuickAdd('Call @Marco about the quote /call #Kitchen fri 10:00 !1', s));
		expect(r.plan).toEqual({ creates: [], edits: [], bodies: [], renames: [] });
		expect(r.value).toEqual({
			title: 'Call Marco about the quote fri 10.00',
			status: { id: 'later', label: 'Later' },
			type: { id: 'call', label: 'Call', isDefault: false },
			matter: { path: 'MTM/Matters/Kitchen renovation.md', name: 'Kitchen renovation', isDefault: false },
			people: [{ path: 'MTM/People/Marco Rossi.md', name: 'Marco Rossi' }],
			priority: 1,
			start: null,
			due: '2026-10-16T10:00',
			chips: [
				{ kind: 'person', text: '@Marco', valid: true },
				{ kind: 'type', text: '/call', valid: true },
				{ kind: 'matter', text: '#Kitchen', valid: true },
				{ kind: 'date', text: 'fri 10:00', valid: true },
				{ kind: 'priority', text: '!1', valid: true },
			],
		});
		expect(r.warnings).toEqual([]);
	});

	it('defaults and names that match nothing', () => {
		const r = ok(parseQuickAdd('Ask about the gym /fax #Gym', s));
		expect(r.value).toMatchObject({
			title: 'Ask about the gym',
			type: { id: 'write', isDefault: true },
			matter: { path: 'MTM/Matters/Inbox.md', name: 'Inbox', isDefault: true },
			chips: [
				{ kind: 'type', text: '/fax', valid: false },
				{ kind: 'matter', text: '#Gym', valid: false },
			],
		});
		expect(r.warnings.map((w) => w.message)).toEqual([
			'No type matches “fax”, so it uses the default type, Write.',
			'No Matter matches “Gym”, so it goes to the Inbox.',
		]);
	});

	it('a date that isn’t read is a date chip that isn’t valid', () => {
		const r = ok(parseQuickAdd('Call the bank 2026-10-16T10:00Z', s));
		expect(r.value).toMatchObject({ title: 'Call the bank 2026-10-16T10.00Z', due: null, chips: [{ kind: 'date', text: '2026-10-16T10:00Z', valid: false }] });
		expect(r.warnings.map((w) => [w.code, w.message])).toEqual([
			['unreadable-date', '“2026-10-16T10:00Z” has a time zone, so no date is set. Dates are in local time: leave the zone out.'],
		]);
	});
});
