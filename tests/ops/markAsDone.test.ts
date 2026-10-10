import { describe, expect, it } from 'vitest';
import { markAsDone } from '../../src/ops/markAsDone';
import { reopen } from '../../src/ops/reopen';
import type { OpResult } from '../../src/ops/types';
import { vault } from './snapshot';

const s = vault();
const CALL = 'MTM/Actions/Call Marco about the quote.md';
const TILES = 'MTM/Actions/Order the tiles.md';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

describe('markAsDone', () => {
	it('sets the done status and today as the completion date, and drops the position by hand', () => {
		const r = ok(markAsDone('Call Marco about the quote', s));
		expect(r.plan.edits).toEqual([
			{
				path: CALL,
				set: { 'mtm-status': 'done', 'mtm-type': 'call', 'mtm-matter': '[[Kitchen renovation]]', 'mtm-completed': '2026-10-09' },
				remove: ['mtm-order'],
			},
		]);
		expect(r.changes).toEqual([
			{ kind: 'property', path: CALL, key: 'mtm-status', from: 'next', to: 'done' },
			{ kind: 'property', path: CALL, key: 'mtm-order', from: 20, to: null },
			{ kind: 'property', path: CALL, key: 'mtm-completed', from: null, to: '2026-10-09' },
		]);
		expect(r.value).toMatchObject({ changed: true, action: { status: { id: 'done', category: 'closed' }, completed: '2026-10-09', today: false } });
	});

	it('an Action already done is left as it is', () => {
		const r = ok(markAsDone(TILES, s));
		expect(r.plan).toEqual({ creates: [], edits: [], bodies: [], renames: [] });
		expect(r.value.changed).toBe(false);
	});

	it('an Action in another closed status moves to the done status and keeps its date', () => {
		const statuses = [...s.settings.statuses, { id: 'dropped', label: 'Dropped', tone: 'ink' as const, category: 'closed' as const }];
		const s2 = vault({ 'MTM/Actions/Dropped.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-status': 'dropped', 'mtm-completed': '2026-09-01' } } }, { settings: { statuses } });
		const r = ok(markAsDone('Dropped', s2));
		expect(r.plan.edits[0]?.set['mtm-status']).toBe('done');
		expect(r.plan.edits[0]?.set['mtm-completed']).toBeUndefined();
		expect(r.plan.edits[0]?.remove).toEqual([]);
	});

	it('names the Action strictly', () => {
		expect(markAsDone('Call Marco', s)).toMatchObject({ ok: false, error: { code: 'ambiguous' } });
		expect(markAsDone('Nothing like it', s)).toMatchObject({ ok: false, error: { code: 'not-found' } });
	});
});

describe('reopen', () => {
	it('moves a closed Action to the backlog status and removes its completion date', () => {
		const r = ok(reopen('Order the tiles', s));
		expect(r.plan.edits).toEqual([
			{ path: TILES, set: { 'mtm-status': 'later', 'mtm-type': 'buy', 'mtm-matter': '[[Kitchen renovation]]' }, remove: ['mtm-completed'] },
		]);
		expect(r.value.action.status.id).toBe('later');
		expect(r.value.action.completed).toBeNull();
	});

	it('an open Action is left as it is', () => {
		const r = ok(reopen(CALL, s));
		expect(r.plan.edits).toEqual([]);
		expect(r.value.changed).toBe(false);
	});

	it('needs setup', () => {
		expect(reopen(TILES, vault({}, { settings: { setupDone: false } }))).toMatchObject({ ok: false, error: { code: 'not-ready' } });
	});
});
