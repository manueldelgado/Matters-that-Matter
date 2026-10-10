import { describe, expect, it } from 'vitest';
import { getAction } from '../../src/ops/getAction';
import type { OpResult } from '../../src/ops/types';
import { vault } from './snapshot';

const s = vault();

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

describe('getAction', () => {
	it('returns raw and effective values, details, checklist, people and linked notes', () => {
		const r = ok(getAction('Confirm the worktop measurements', s));
		expect(r.plan).toEqual({ creates: [], edits: [], bodies: [], renames: [] });
		expect(r.value).toEqual({
			path: 'MTM/Actions/Confirm the worktop measurements.md',
			title: 'Confirm the worktop measurements',
			matter: { path: 'MTM/Matters/Kitchen renovation.md', name: 'Kitchen renovation', isInbox: false },
			status: { id: 'next', label: 'Next', category: 'open' },
			type: { id: 'call', label: 'Call' },
			priority: 1,
			start: null,
			due: '2026-10-09T10:00',
			today: true,
			overdue: true,
			waitingOn: null,
			waitingSince: null,
			completed: null,
			orphans: [],
			raw: { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-due': '2026-10-09T10:00', 'mtm-priority': 1 },
			details: 'Confirm the worktop measurements before ordering.',
			checklist: [
				{ text: 'Ask for the revised quote', checked: false },
				{ text: 'Measure the wall', checked: true },
			],
			// The Matter is left out; the person isn't named in the Action's properties, so it counts as a linked note.
			linkedNotes: [
				{ path: 'Notes/Some note.md', name: 'Some note' },
				{ path: 'MTM/People/Marco Rossi.md', name: 'Marco Rossi' },
			],
			people: [],
			startsAfterDue: false,
		});
	});

	it('waiting on someone: the person, the date, the people', () => {
		const r = ok(getAction('Revised quote from Marco', s));
		expect(r.value).toMatchObject({
			waitingOn: { path: 'MTM/People/Marco Rossi.md', name: 'Marco Rossi' },
			waitingSince: '2026-09-23',
			people: [{ path: 'MTM/People/Marco Rossi.md', name: 'Marco Rossi' }],
		});
	});

	it('orphaned values: the effective values stand in, and the raw ones are listed', () => {
		const r = ok(getAction('Mystery', s));
		expect(r.value).toMatchObject({
			status: { id: 'later' },
			type: { id: 'write' },
			matter: { path: 'MTM/Matters/Inbox.md', name: 'Inbox', isInbox: true },
			orphans: [
				{ field: 'status', raw: 'someday' },
				{ field: 'type', raw: 'fax' },
				{ field: 'matter', raw: '[[Nowhere]]' },
			],
			raw: { 'mtm-type': 'fax', 'mtm-status': 'someday', 'mtm-matter': '[[Nowhere]]' },
		});
	});

	it('only mtm- properties are returned', () => {
		const s2 = vault({ 'MTM/Actions/Private.md': { frontmatter: { 'mtm-kind': 'action', secret: 'x' } } });
		expect(ok(getAction('Private', s2)).value.raw).toEqual({ 'mtm-kind': 'action' });
	});

	it('a person no longer there keeps their name', () => {
		const s2 = vault({ 'MTM/Actions/Ghost.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-people': ['[[Gone Person]]'] } } });
		expect(ok(getAction('Ghost', s2)).value.people).toEqual([{ path: null, name: 'Gone Person' }]);
	});

	it('works before setup (reads only)', () => {
		expect(getAction('Mystery', vault({}, { settings: { setupDone: false } })).ok).toBe(true);
	});

	it('warns when the settings are newer than this version knows', () => {
		const r = ok(getAction('Mystery', vault({}, { settings: { schemaVersion: 999 } })));
		expect(r.warnings.map((w) => w.code)).toEqual(['newer-settings']);
	});
});
