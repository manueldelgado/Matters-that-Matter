import { describe, expect, it } from 'vitest';
import { listMatters } from '../../src/ops/listMatters';
import { markReviewed } from '../../src/ops/markReviewed';
import { applyBodyEdit } from '../../src/ops/plan';
import { updateMatter } from '../../src/ops/updateMatter';
import type { OpResult } from '../../src/ops/types';
import { vault } from './snapshot';

const s = vault();
const KITCHEN = 'MTM/Matters/Kitchen renovation.md';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

function refused<T>(r: OpResult<T>) {
	if (r.ok) throw new Error('expected a refusal');
	return r.error;
}

describe('markReviewed', () => {
	it('sets today as the last review, and the Matter is no longer due', () => {
		const r = ok(markReviewed({ matter: 'Kitchen renovation' }, s));
		expect(r.plan.edits).toEqual([{ path: KITCHEN, set: { 'mtm-last-reviewed': '2026-10-09' }, remove: [] }]);
		expect(r.plan.bodies).toEqual([]);
		expect(r.changes).toEqual([{ kind: 'property', path: KITCHEN, key: 'mtm-last-reviewed', from: '2026-09-20', to: '2026-10-09' }]);
		expect(r.value.changed).toBe(true);
		expect(r.value.matter.review).toMatchObject({ lastReviewed: '2026-10-09', due: false, daysSince: 0, nextDue: '2026-10-23' });
	});

	it('with a note, adds it at the end of the note as the review session writes it', () => {
		const r = ok(markReviewed({ matter: 'Kitchen renovation', note: '  Waiting for the\nplanning decision ' }, s));
		const edit = { kind: 'review-note', date: '2026-10-09', text: 'Waiting for the planning decision' };
		expect(r.plan.bodies).toEqual([{ path: KITCHEN, edit }]);
		expect(r.changes).toContainEqual({ kind: 'review-note', path: KITCHEN, line: '- Reviewed 2026-10-09: Waiting for the planning decision' });
		expect(r.value.matter.lastReviewNote).toEqual({ date: '2026-10-09', text: 'Waiting for the planning decision' });
		expect(applyBodyEdit('---\nmtm-kind: matter\n---\nAbout the kitchen.\n', edit as never)).toBe(
			'---\nmtm-kind: matter\n---\nAbout the kitchen.\n\n- Reviewed 2026-10-09: Waiting for the planning decision\n',
		);
	});

	it('reviewed today already: nothing planned without a note, the note alone with one', () => {
		const today = vault({ [KITCHEN]: { frontmatter: { ...s.notes.find((n) => n.path === KITCHEN)?.frontmatter, 'mtm-last-reviewed': '2026-10-09' } } });
		const none = ok(markReviewed({ matter: 'Kitchen renovation' }, today));
		expect(none.value.changed).toBe(false);
		expect(none.plan).toMatchObject({ edits: [], bodies: [] });
		const blank = ok(markReviewed({ matter: 'Kitchen renovation', note: '   ' }, today));
		expect(blank.value.changed).toBe(false);
		const noted = ok(markReviewed({ matter: 'Kitchen renovation', note: 'Second look' }, today));
		expect(noted.plan.edits).toEqual([]);
		expect(noted.changes.map((c) => c.kind)).toEqual(['review-note']);
	});

	it('works without a rhythm too, as the review session does', () => {
		const r = ok(markReviewed({ matter: 'Advisory work', note: 'Quiet month' }, s));
		expect(r.value.matter.review).toBeNull();
		expect(r.value.matter.lastReviewNote).toEqual({ date: '2026-10-09', text: 'Quiet month' });
	});

	it('refuses the Inbox, and a Matter that matches nothing', () => {
		expect(refused(markReviewed({ matter: 'Inbox' }, s))).toMatchObject({ code: 'invalid', field: 'matter', message: 'The Inbox isn’t reviewed: go through it instead.' });
		expect(refused(markReviewed({ matter: 'Bathroom' }, s)).field).toBe('matter');
	});

	it('gives a Matter without an mtm-id one with its first write', () => {
		const ids = vault({}, {});
		const withId = { ...ids, newId: () => 'new-id' };
		const r = ok(markReviewed({ matter: 'Garden', note: 'Next spring' }, withId));
		expect(r.plan.edits[0]?.set).toMatchObject({ 'mtm-id': 'new-id', 'mtm-last-reviewed': '2026-10-09' });
	});
});

describe('updateMatter', () => {
	it('changes only the fields given, written as the overview writes them', () => {
		const r = ok(updateMatter({ matter: 'Garden', state: 'Active', reviewEvery: '1M', sphere: 'Home', outcome: '  A garden  to sit in ', icon: 'trees' }, s));
		expect(r.plan.edits).toEqual([
			{
				path: 'MTM/Matters/Garden.md',
				set: { 'mtm-icon': 'trees', 'mtm-state': 'active', 'mtm-review-every': '1m', 'mtm-sphere': 'home', 'mtm-outcome': 'A garden to sit in' },
				remove: [],
			},
		]);
		expect(r.value.matter).toMatchObject({ state: 'active', sphere: { id: 'home', label: 'Home' }, outcome: 'A garden to sit in', icon: 'trees', review: { every: '1m', due: true } });
	});

	it('null removes the outcome, the rhythm and the Sphere; the last review stays', () => {
		const r = ok(updateMatter({ matter: 'Kitchen renovation', outcome: null, reviewEvery: null, sphere: null }, s));
		expect(r.plan.edits).toEqual([{ path: KITCHEN, set: {}, remove: ['mtm-sphere', 'mtm-review-every', 'mtm-outcome'] }]);
		expect(r.value.matter).toMatchObject({ outcome: null, sphere: null, review: null });
	});

	it('as asked already: nothing planned', () => {
		const r = ok(updateMatter({ matter: 'Kitchen renovation', state: 'active', icon: 'cooking-pot' }, s));
		expect(r.value.changed).toBe(false);
		expect(r.plan.edits).toEqual([]);
	});

	it('is strict: values that match nothing, empty values and no fields are refused', () => {
		expect(refused(updateMatter({ matter: 'Garden', sphere: 'Family' }, s))).toMatchObject({ code: 'unmatched', field: 'sphere' });
		expect(refused(updateMatter({ matter: 'Garden', state: 'paused' }, s))).toMatchObject({ code: 'invalid', field: 'state' });
		expect(refused(updateMatter({ matter: 'Garden', reviewEvery: 'often' }, s))).toMatchObject({ code: 'invalid', field: 'review-every' });
		expect(refused(updateMatter({ matter: 'Garden', icon: 'Big House' }, s))).toMatchObject({ code: 'invalid', field: 'icon' });
		expect(refused(updateMatter({ matter: 'Garden', outcome: ' ' }, s))).toMatchObject({ code: 'invalid', field: 'outcome', message: '“outcome” is empty. Give a value, or null to remove it.' });
		expect(refused(updateMatter({ matter: 'Garden' }, s))).toMatchObject({ code: 'invalid', message: 'Nothing to change: name at least one field.' });
	});

	it('the Inbox has only its icon to change', () => {
		const r = ok(updateMatter({ matter: 'Inbox', icon: 'tray' }, s));
		expect(r.plan.edits).toEqual([{ path: 'MTM/Matters/Inbox.md', set: { 'mtm-icon': 'tray' }, remove: [] }]);
		expect(refused(updateMatter({ matter: 'Inbox', reviewEvery: '1w' }, s))).toMatchObject({
			code: 'invalid',
			field: 'review-every',
			message: 'The Inbox has only an icon to change, not “review-every”.',
		});
	});

	it('closing a Matter leaves its Actions as they are', () => {
		const r = ok(updateMatter({ matter: 'Kitchen renovation', state: 'closed' }, s));
		expect(r.plan.edits.map((e) => e.path)).toEqual([KITCHEN]);
		expect(r.value.matter.counts.open).toBeGreaterThan(0);
	});
});

describe('listMatters', () => {
	it('gives each Matter’s latest review note, by date', () => {
		const noted = vault({
			'MTM/Matters/Garden.md': {
				frontmatter: { 'mtm-kind': 'matter', 'mtm-state': 'dormant' },
				body: 'About the garden.\n\n- Reviewed 2026-09-01: Prune in spring\n- Reviewed 2026-08-01: Older\n',
			},
		});
		const matters = ok(listMatters(noted)).value;
		expect(matters.find((m) => m.name === 'Garden')?.lastReviewNote).toEqual({ date: '2026-09-01', text: 'Prune in spring' });
		expect(matters.find((m) => m.name === 'Advisory work')?.lastReviewNote).toBeNull();
	});
});
