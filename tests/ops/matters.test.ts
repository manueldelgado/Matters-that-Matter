import { describe, expect, it } from 'vitest';
import { addMatter } from '../../src/ops/addMatter';
import { listMatters } from '../../src/ops/listMatters';
import type { AddMatterInput, OpResult } from '../../src/ops/types';
import { vault } from './snapshot';

const s = vault();

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

const created = (input: AddMatterInput, snap = s) => {
	const r = ok(addMatter(input, snap));
	const create = r.plan.creates[0];
	if (!create) throw new Error('nothing created');
	return { r, create };
};

describe('addMatter', () => {
	it('creates an active Matter last in lane order (the Inbox’s order doesn’t count)', () => {
		const { r, create } = created({ name: 'Bathroom', icon: 'bath', sphere: 'home', outcome: '  A bathroom   that works ', reviewEvery: '1M' });
		expect(create).toEqual({
			path: 'MTM/Matters/Bathroom.md',
			frontmatter: [
				['mtm-kind', 'matter'],
				['mtm-icon', 'bath'],
				['mtm-state', 'active'],
				['mtm-lane-order', 4],
				['mtm-review-every', '1m'],
				['mtm-sphere', 'home'],
				['mtm-outcome', 'A bathroom that works'],
			],
			body: '',
		});
		expect(r.warnings).toEqual([]);
		expect(r.value).toMatchObject({
			path: 'MTM/Matters/Bathroom.md',
			name: 'Bathroom',
			icon: 'bath',
			state: 'active',
			sphere: { id: 'home', label: 'Home' },
			outcome: 'A bathroom that works',
			laneOrder: 4,
			review: { every: '1m', lastReviewed: null, due: true },
			counts: { open: 0, total: 0 },
		});
	});

	it('defaults: the default icon, active, no Sphere, no rhythm', () => {
		const { create } = created({ name: 'Taxes' });
		expect(Object.fromEntries(create.frontmatter)).toEqual({ 'mtm-kind': 'matter', 'mtm-icon': 'circle-dot', 'mtm-state': 'active', 'mtm-lane-order': 4 });
	});

	it('can start dormant or closed', () => {
		expect(Object.fromEntries(created({ name: 'Someday', state: 'Dormant' }).create.frontmatter)['mtm-state']).toBe('dormant');
	});

	it('a Sphere that matches nothing leaves it without one, with a warning', () => {
		const { create, r } = created({ name: 'Family trip', sphere: 'Family' });
		expect(Object.fromEntries(create.frontmatter)['mtm-sphere']).toBeUndefined();
		expect(r.warnings.map((w) => w.message)).toEqual(['No Sphere matches “Family”, so the Matter has no Sphere.']);
	});

	it('a taken name gets " 2"; no duplicate check otherwise', () => {
		expect(created({ name: 'kitchen renovation' }).create.path).toBe('MTM/Matters/kitchen renovation 2.md');
	});

	it('a name a note has elsewhere is taken too, so its links keep reaching it', () => {
		expect(created({ name: 'Some note' }).create.path).toBe('MTM/Matters/Some note 2.md');
		expect(created({ name: 'confirm the worktop measurements' }).create.path).toBe('MTM/Matters/confirm the worktop measurements 2.md');
	});

	it('the first Matter gets lane order 1, whatever the Inbox’s', () => {
		const bare = vault({ 'MTM/Matters/Kitchen renovation.md': {}, 'MTM/Matters/Advisory work.md': {}, 'MTM/Matters/Garden.md': {} });
		expect(Object.fromEntries(created({ name: 'First' }, bare).create.frontmatter)['mtm-lane-order']).toBe(1);
	});

	it.each([
		['name', { name: '  ' }],
		['state', { name: 'X', state: 'paused' }],
		['review-every', { name: 'X', reviewEvery: 'weekly' }],
		['icon', { name: 'X', icon: 'Not An Icon' }],
	] as const)('an unreadable %s is invalid', (field, input) => {
		expect(addMatter(input, s)).toMatchObject({ ok: false, error: { code: 'invalid', field } });
	});

	it.each(['Inbox', 'inbox', '  INBOX ', 'Inbox 2', 'Inbox?'])('refuses a Matter named like the Inbox: %j', (name) => {
		const r = addMatter({ name }, s);
		expect(r).toMatchObject({ ok: false, error: { code: 'invalid', field: 'name', message: 'The Inbox exists already: add Actions to it, or give the new Matter another name.' } });
		expect('plan' in r).toBe(false);
	});

	it('names that only contain the Inbox’s name are fine', () => {
		expect(created({ name: 'Inbox zero' }).create.path).toBe('MTM/Matters/Inbox zero.md');
	});

	it('needs setup', () => {
		expect(addMatter({ name: 'X' }, vault({}, { settings: { setupDone: false } }))).toMatchObject({ ok: false, error: { code: 'not-ready' } });
	});
});

describe('listMatters', () => {
	it('lists every lane in board order: the Inbox, then by Sphere, then lane order', () => {
		const value = ok(listMatters(s)).value;
		expect(value.map((m) => m.name)).toEqual(['Inbox', 'Kitchen renovation', 'Advisory work', 'Garden']);
	});

	it('with state, Sphere, outcome, review and counts', () => {
		const [inbox, kitchen, , garden] = ok(listMatters(s)).value;
		expect(inbox).toMatchObject({ isInbox: true, icon: 'inbox', sphere: null, review: null, outcome: null, counts: { open: 3, today: 1, waiting: 0, closed: 0, total: 3 }, noNextAction: false });
		expect(kitchen).toMatchObject({
			path: 'MTM/Matters/Kitchen renovation.md',
			state: 'active',
			sphere: { id: 'home', label: 'Home' },
			outcome: 'A kitchen we can cook in',
			review: { every: '2w', lastReviewed: '2026-09-20', nextDue: '2026-10-04', due: true, daysSince: 19 },
			counts: { open: 3, today: 1, waiting: 1, closed: 1, total: 4 },
			noNextAction: false,
		});
		expect(garden).toMatchObject({ state: 'dormant', counts: { total: 0 }, noNextAction: false });
	});

	it('an active Matter with nothing in motion has no next Action', () => {
		const s2 = vault({ 'MTM/Matters/Empty.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-lane-order': 9 } } });
		expect(ok(listMatters(s2)).value.find((m) => m.name === 'Empty')?.noNextAction).toBe(true);
	});

	it('the Inbox shows even when its note lost mtm-kind, or is missing', () => {
		const lost = vault({ 'MTM/Matters/Inbox.md': { body: 'not a Matter any more' } });
		expect(ok(listMatters(lost)).value[0]).toMatchObject({ name: 'Inbox', isInbox: true });
		const missing = vault({}, { settings: { inboxPath: 'MTM/Matters/Capture.md' } });
		expect(ok(listMatters(missing)).value[0]).toMatchObject({ path: 'MTM/Matters/Capture.md', name: 'Capture', isInbox: true });
	});
});
