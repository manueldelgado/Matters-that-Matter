import { describe, expect, it } from 'vitest';
import { addAction } from '../../src/ops/addAction';
import { addMatter } from '../../src/ops/addMatter';
import { getAction } from '../../src/ops/getAction';
import { markAsDone } from '../../src/ops/markAsDone';
import type { OpResult, Snapshot } from '../../src/ops/types';
import { updateAction } from '../../src/ops/updateAction';
import { vault, type TestVault } from './snapshot';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

const ID = '6f1c2a4e-8b3d-4c6a-9e2f-1d7b5a3c9e40';
const withIds = (extra: TestVault = {}): Snapshot => {
	let n = 0;
	return { ...vault(extra), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
};

describe('mtm-id', () => {
	it('a new Action gets one, right after mtm-kind', () => {
		const r = ok(addAction({ title: 'Ring the bank' }, withIds()));
		const [create] = r.plan.creates;
		expect(create?.frontmatter.slice(0, 2)).toEqual([
			['mtm-kind', 'action'],
			['mtm-id', '00000000-0000-4000-8000-000000000001'],
		]);
		expect(r.value.action.id).toBe('00000000-0000-4000-8000-000000000001');
	});

	it('a new Matter gets one', () => {
		const r = ok(addMatter({ name: 'Garden shed' }, withIds()));
		expect(r.plan.creates[0]?.frontmatter[1]).toEqual(['mtm-id', '00000000-0000-4000-8000-000000000001']);
		expect(r.value.id).toBe('00000000-0000-4000-8000-000000000001');
	});

	it('an Action without one gets it with its first write, and the change says so', () => {
		const r = ok(markAsDone('Call Marco about the quote', withIds()));
		expect(r.plan.edits[0]?.set['mtm-id']).toBe('00000000-0000-4000-8000-000000000001');
		expect(r.changes).toContainEqual({ kind: 'property', path: 'MTM/Actions/Call Marco about the quote.md', key: 'mtm-id', from: null, to: '00000000-0000-4000-8000-000000000001' });
		expect(r.value.action.id).toBe('00000000-0000-4000-8000-000000000001');
	});

	it('nothing is written only to add one', () => {
		const r = ok(markAsDone('Order the tiles', withIds()));
		expect(r.plan.edits).toEqual([]);
		expect(r.changes).toEqual([]);
	});

	it('one already there is kept', () => {
		const s = withIds({ 'MTM/Actions/Post the forms.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-id': ID, 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]' } } });
		const r = ok(markAsDone('Post the forms', s));
		expect(r.plan.edits[0]?.set['mtm-id']).toBeUndefined();
		expect(r.value.action.id).toBe(ID);
	});

	it('a host that makes no IDs writes none', () => {
		const r = ok(addAction({ title: 'Ring the bank' }, vault()));
		expect(r.plan.creates[0]?.frontmatter.map(([k]) => k)).not.toContain('mtm-id');
		expect(r.value.action.id).toBeNull();
	});

	it('names an Action across a rename, in any case', () => {
		const s = withIds({ 'MTM/Actions/Post the forms.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-id': ID, 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]' } } });
		expect(ok(getAction(ID, s)).value.title).toBe('Post the forms');
		expect(ok(getAction(ID.toUpperCase(), s)).value.title).toBe('Post the forms');
		expect(ok(updateAction({ action: ID, priority: 1 }, s)).plan.edits[0]?.path).toBe('MTM/Actions/Post the forms.md');
	});

	it('names a Matter by its ID', () => {
		const s = withIds({ 'MTM/Matters/Garden shed.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-id': ID, 'mtm-icon': 'fence', 'mtm-state': 'active' } } });
		const r = ok(addAction({ title: 'Paint the door', matter: ID }, s));
		expect(r.value.action.matter.name).toBe('Garden shed');
	});

	it('two notes holding one ID (a copied file) are ambiguous by it', () => {
		const note = { frontmatter: { 'mtm-kind': 'action', 'mtm-id': ID, 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]' } };
		const s = withIds({ 'MTM/Actions/Post the forms.md': note, 'MTM/Actions/Post the forms 2.md': note });
		const r = getAction(ID, s);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe('ambiguous');
	});

	it('a body-only or rename-only write gives the Action its ID too', () => {
		const body = ok(updateAction({ action: 'Call Marco about the quote', checklist: ['Ask about tiles'] }, withIds()));
		expect(body.plan.edits).toEqual([{ path: 'MTM/Actions/Call Marco about the quote.md', set: { 'mtm-id': '00000000-0000-4000-8000-000000000001' }, remove: [] }]);
		expect(body.value.action.id).toBe('00000000-0000-4000-8000-000000000001');
		const renamed = ok(updateAction({ action: 'Call Marco about the quote', title: 'Ring Marco' }, withIds()));
		expect(renamed.plan.edits[0]?.set['mtm-id']).toBe('00000000-0000-4000-8000-000000000001');
	});

	it('a value that isn’t a UUID names nothing, and is never replaced', () => {
		const s = withIds({ 'MTM/Actions/Post the forms.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-id': 'Kitchen renovation', 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]' } } });
		const r = ok(addAction({ title: 'Paint', matter: 'Kitchen renovation' }, s));
		expect(r.value.action.matter.path).toBe('MTM/Matters/Kitchen renovation.md');
		const done = ok(markAsDone('Post the forms', s));
		expect(done.plan.edits[0]?.set['mtm-id']).toBeUndefined();
	});
});
