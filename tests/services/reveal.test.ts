import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type SphereDef } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { buildBoard, type BoardOptions, type MatterInfo } from '../../src/services/boardModel';
import type { ResolveLink } from '../../src/services/effective';
import { pendingRevealFor, revealPlan } from '../../src/services/reveal';
import { NO_SPHERE } from '../../src/services/spheres';
import { firstViewName } from '../../src/services/baseFile';

const settings = DEFAULT_SETTINGS;
const today = '2026-10-09';
const now = new Date(2026, 9, 9, 12);
const spheres: SphereDef[] = [
	{ id: 'home', label: 'Home', icon: 'house' },
	{ id: 'work', label: 'Work', icon: 'briefcase' },
];

const matter = (name: string, extra: Partial<MatterInfo> = {}): MatterInfo => ({
	path: `M/${name}.md`,
	name,
	laneOrder: null,
	isInbox: false,
	icon: 'circle-dot',
	state: 'active',
	review: null,
	sphere: null,
	sphereOrphan: null,
	outcome: null,
	...extra,
});

const inbox = matter('Inbox', { path: settings.inboxPath, isInbox: true, icon: 'inbox' });
const kitchen = matter('Kitchen', { laneOrder: 1, sphere: 'home' });
const shed = matter('Garden shed', { laneOrder: 2, sphere: 'home' });
const gencs = matter('GenCS', { laneOrder: 3, sphere: 'work' });
const loose = matter('Loose', { laneOrder: 4 });
const attic = matter('Attic', { laneOrder: 5, sphere: 'home', state: 'dormant' });
const matters = [inbox, kitchen, shed, gencs, loose, attic];

const resolve: ResolveLink = (text) => {
	const m = matters.find((x) => x.name === text);
	return m ? { path: m.path, isMatter: true } : null;
};
const action = (title: string, matterName: string) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', 'mtm-matter': `[[${matterName}]]`, 'mtm-status': 'next' }, settings, resolve);

// Garden shed has no Actions; the rest have one each, the Inbox too.
const actions = [action('Worktop', 'Kitchen'), action('Contract', 'GenCS'), action('Odd job', 'Loose'), action('Boxes', 'Attic'), action('Idea', 'Inbox')];

const options = (over: Partial<BoardOptions> = {}): BoardOptions => ({
	inboxPosition: 'top',
	showDone: false,
	doneDays: null,
	hideEmptyLanes: false,
	typesOff: new Set(),
	laneToggles: {},
	spheres,
	spheresOff: new Set(),
	spheresCollapsed: new Set(),
	...over,
});

/** As the board builds it for a reveal: every Sphere chip on, the rest as the board has it. */
const plan = (path: string, over: Partial<BoardOptions> = {}) => {
	const o = options(over);
	const model = buildBoard(actions, matters, settings.statuses, { ...o, spheresOff: new Set() }, today, now);
	return revealPlan(model, o, path, matters);
};

describe('revealPlan', () => {
	it('needs nothing for a lane already in view', () => {
		expect(plan(kitchen.path)).toEqual({ steps: [], blocked: null });
	});

	it('expands a collapsed Sphere band', () => {
		expect(plan(kitchen.path, { spheresCollapsed: new Set(['home']) })).toEqual({
			steps: [{ kind: 'expand-band', key: 'home' }],
			blocked: null,
		});
	});

	it('leaves other collapsed bands alone', () => {
		expect(plan(kitchen.path, { spheresCollapsed: new Set(['work', NO_SPHERE]) }).steps).toEqual([]);
	});

	it('expands a lane the user collapsed', () => {
		expect(plan(kitchen.path, { laneToggles: { [kitchen.path]: 'collapsed' } })).toEqual({
			steps: [{ kind: 'expand-lane', path: kitchen.path }],
			blocked: null,
		});
	});

	it('expands a dormant Matter, which starts collapsed', () => {
		expect(plan(attic.path).steps).toEqual([{ kind: 'expand-lane', path: attic.path }]);
		expect(plan(attic.path, { laneToggles: { [attic.path]: 'expanded' } }).steps).toEqual([]);
	});

	it('turns the Sphere chip on', () => {
		expect(plan(gencs.path, { spheresOff: new Set(['work']) }).steps).toEqual([{ kind: 'sphere-on', key: 'work' }]);
	});

	it('turns the chip on, then expands the band, then the lane', () => {
		const p = plan(attic.path, { spheresOff: new Set(['home', 'work']), spheresCollapsed: new Set(['home']) });
		expect(p.steps).toEqual([
			{ kind: 'sphere-on', key: 'home' },
			{ kind: 'expand-band', key: 'home' },
			{ kind: 'expand-lane', path: attic.path },
		]);
	});

	it('uses "No Sphere" for a Matter without one', () => {
		const p = plan(loose.path, { spheresOff: new Set([NO_SPHERE]), spheresCollapsed: new Set([NO_SPHERE]) });
		expect(p.steps).toEqual([
			{ kind: 'sphere-on', key: NO_SPHERE },
			{ kind: 'expand-band', key: NO_SPHERE },
		]);
	});

	it('ignores Spheres when none are set up', () => {
		expect(plan(loose.path, { spheres: [], spheresOff: new Set([NO_SPHERE]), spheresCollapsed: new Set([NO_SPHERE]) }).steps).toEqual([]);
	});

	it('is blocked for a Matter with no Actions on a board that hides empty lanes', () => {
		expect(plan(shed.path, { hideEmptyLanes: true })).toEqual({ steps: [], blocked: 'hidden-empty' });
		expect(plan(shed.path, { hideEmptyLanes: true, spheresOff: new Set(['home']) }).blocked).toBe('hidden-empty');
		// Shown when the board keeps empty lanes.
		expect(plan(shed.path).blocked).toBeNull();
	});

	it('turns the chip on for a Matter with Actions on a board that hides empty lanes', () => {
		expect(plan(gencs.path, { hideEmptyLanes: true, spheresOff: new Set(['work']) })).toEqual({
			steps: [{ kind: 'sphere-on', key: 'work' }],
			blocked: null,
		});
	});

	it('is blocked for the Inbox on a board that hides it', () => {
		expect(plan(inbox.path, { inboxPosition: 'hidden' })).toEqual({ steps: [], blocked: 'inbox-hidden' });
	});

	it('never touches chips or bands for the Inbox', () => {
		expect(plan(inbox.path, { spheresOff: new Set(['home', 'work', NO_SPHERE]), spheresCollapsed: new Set(['home']) }).steps).toEqual([]);
		expect(plan(inbox.path, { inboxPosition: 'bottom' }).blocked).toBeNull();
	});

	it('is blocked for a path that is no Matter', () => {
		expect(plan('M/Nowhere.md').blocked).toBe('missing');
	});
});

describe('pendingRevealFor', () => {
	const pending = { matterPath: kitchen.path, boardPath: 'MTM/Boards/Matters.base', expires: 10_000 };

	it('is taken by a board of that file', () => {
		expect(pendingRevealFor(pending, 'MTM/Boards/Matters.base', 9_000)).toBe('take');
	});

	it('waits for its own file', () => {
		expect(pendingRevealFor(pending, 'MTM/Boards/Other.base', 9_000)).toBe('keep');
		expect(pendingRevealFor(null, 'MTM/Boards/Matters.base', 9_000)).toBe('keep');
	});

	it('is dropped once it has waited too long', () => {
		expect(pendingRevealFor(pending, 'MTM/Boards/Matters.base', 10_001)).toBe('drop');
		expect(pendingRevealFor(pending, 'MTM/Boards/Other.base', 10_001)).toBe('drop');
	});
});

describe('firstViewName', () => {
	it('finds the first view of a type', () => {
		const parsed = { views: [{ type: 'mtm-list', name: 'List' }, { type: 'mtm-board', name: 'Board' }, { type: 'mtm-board', name: 'Second' }] };
		expect(firstViewName(parsed, 'mtm-board')).toBe('Board');
	});

	it('is null without one, or for something that is not a base', () => {
		expect(firstViewName({ views: [{ type: 'table', name: 'Table' }] }, 'mtm-board')).toBeNull();
		expect(firstViewName({ views: [{ type: 'mtm-board' }] }, 'mtm-board')).toBeNull();
		expect(firstViewName(null, 'mtm-board')).toBeNull();
		expect(firstViewName('views', 'mtm-board')).toBeNull();
	});
});
