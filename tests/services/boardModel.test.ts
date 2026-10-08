import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem, initials } from '../../src/services/actionItems';
import { buildBoard, isLaneCollapsed, typeShown, type BoardOptions, type MatterInfo } from '../../src/services/boardModel';
import type { ResolveLink } from '../../src/services/effective';
import { buildList, buildListLayout } from '../../src/services/listModel';

const settings = DEFAULT_SETTINGS;
const typeIds = settings.types.map((t) => t.id);
const today = '2026-10-09';

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
	...extra,
});

const inbox = matter('Inbox', { path: settings.inboxPath, isInbox: true, icon: 'inbox' });
const kitchen = matter('Kitchen', { laneOrder: 1 });
const garden = matter('Garden', { laneOrder: 2 });
const shed = matter('Shed', { state: 'dormant' });
const matters = [kitchen, inbox, garden, shed];

const resolve: ResolveLink = (text) => {
	const m = matters.find((x) => x.name === text);
	return m ? { path: m.path, isMatter: true } : null;
};

const action = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', ...fm }, settings, resolve);

const actions = [
	action('Call plumber', { 'mtm-matter': '[[Kitchen]]', 'mtm-status': 'next', 'mtm-type': 'call', 'mtm-priority': 1 }),
	action('Buy tiles', { 'mtm-matter': '[[Kitchen]]', 'mtm-status': 'next', 'mtm-type': 'buy' }),
	action('Ask Ana', { 'mtm-matter': '[[Kitchen]]', 'mtm-status': 'waiting', 'mtm-waiting-on': '[[Ana Gil]]' }),
	action('Old task', { 'mtm-matter': '[[Kitchen]]', 'mtm-status': 'done', 'mtm-completed': '2026-10-08' }),
	action('Ancient task', { 'mtm-matter': '[[Kitchen]]', 'mtm-status': 'done', 'mtm-completed': '2026-08-01' }),
	action('Loose end', {}),
	action('Lost', { 'mtm-matter': '[[Nowhere]]', 'mtm-status': 'someday' }),
];

const options = (over: Partial<BoardOptions> = {}): BoardOptions => ({
	inboxPosition: 'top',
	showDone: false,
	doneDays: null,
	hideEmptyLanes: false,
	typesOff: new Set(),
	laneToggles: {},
	spheres: [],
	spheresOff: new Set(),
	spheresCollapsed: new Set(),
	...over,
});

const titles = (list: { title: string }[] | undefined) => (list ?? []).map((a) => a.title);

describe('toActionItem', () => {
	it('combines raw and effective values', () => {
		const a = actions[2]!;
		expect(a.category).toBe('active');
		expect(a.waitingOn).toBe('Ana Gil');
		expect(a.effective.matterPath).toBe('M/Kitchen.md');
	});

	it('drops waiting-on for closed Actions', () => {
		const a = action('x', { 'mtm-status': 'done', 'mtm-waiting-on': '[[Ana Gil]]' });
		expect(a.waitingOn).toBeNull();
	});

	it('makes initials', () => {
		expect(initials('Marco Rossi')).toBe('MR');
		expect(initials('People/ana')).toBe('A');
		expect(initials('Jean Luc Picard')).toBe('JL');
	});
});

describe('buildBoard', () => {
	const board = buildBoard(actions, matters, settings.statuses, typeIds, options(), today);

	it('hides closed columns when Show done is off', () => {
		expect(board.columns.map((c) => c.id)).toEqual(['later', 'next', 'doing', 'waiting']);
	});

	it('orders lanes with the Inbox at its position', () => {
		expect(board.lanes.map((l) => l.matter.name)).toEqual(['Inbox', 'Kitchen', 'Garden', 'Shed']);
		const bottom = buildBoard(actions, matters, settings.statuses, typeIds, options({ inboxPosition: 'bottom' }), today);
		expect(bottom.lanes.at(-1)?.matter.name).toBe('Inbox');
	});

	it('places cards by effective status and Matter, sorted', () => {
		const k = board.lanes[1]!;
		expect(titles(k.cells.get('next'))).toEqual(['Call plumber', 'Buy tiles']);
		expect(titles(k.cells.get('waiting'))).toEqual(['Ask Ana']);
		expect(titles(board.lanes[0]!.cells.get('later'))).toEqual(['Loose end', 'Lost']);
	});

	it('counts open and waiting Actions per lane, and cards per column', () => {
		expect(board.lanes[1]).toMatchObject({ openCount: 3, waitingCount: 1 });
		expect(board.columnCounts.get('next')).toBe(2);
		expect(board.columnCounts.get('later')).toBe(2);
		expect(board.openCount).toBe(5);
	});

	it('shows done Actions within the window when Show done is on', () => {
		const all = buildBoard(actions, matters, settings.statuses, typeIds, options({ showDone: true }), today);
		expect(titles(all.lanes[1]!.cells.get('done'))).toEqual(['Ancient task', 'Old task']);
		const recent = buildBoard(actions, matters, settings.statuses, typeIds, options({ showDone: true, doneDays: 7 }), today);
		expect(titles(recent.lanes[1]!.cells.get('done'))).toEqual(['Old task']);
	});

	it('hides the Inbox lane and its Actions', () => {
		const b = buildBoard(actions, matters, settings.statuses, typeIds, options({ inboxPosition: 'hidden' }), today);
		expect(b.lanes.map((l) => l.matter.name)).not.toContain('Inbox');
		expect(b.openCount).toBe(3);
	});

	it('hides empty lanes on request', () => {
		const b = buildBoard(actions, matters, settings.statuses, typeIds, options({ hideEmptyLanes: true }), today);
		expect(b.lanes.map((l) => l.matter.name)).toEqual(['Inbox', 'Kitchen']);
	});

	it('filters by type chips', () => {
		const b = buildBoard(actions, matters, settings.statuses, typeIds, options({ typesOff: new Set(['buy']) }), today);
		expect(titles(b.lanes[1]!.cells.get('next'))).toEqual(['Call plumber']);
	});

	it('shows all types when every chip is off', () => {
		expect(typeShown('call', new Set(typeIds), typeIds)).toBe(true);
		expect(typeShown('call', new Set(['call']), typeIds)).toBe(false);
	});

	it('collapses dormant lanes unless the board says otherwise', () => {
		expect(board.lanes[3]!.collapsed).toBe(true);
		expect(isLaneCollapsed(shed, { [shed.path]: 'expanded' })).toBe(false);
		expect(isLaneCollapsed(kitchen, { [kitchen.path]: 'collapsed' })).toBe(true);
	});

	it('reports an empty board only without any Actions', () => {
		expect(board.empty).toBe(false);
		expect(buildBoard([], matters, settings.statuses, typeIds, options(), today).empty).toBe(true);
	});
});

describe('buildList', () => {
	it('keeps lane order, drops empty groups and lists rows by status, then card order', () => {
		const board = buildBoard(actions, matters, settings.statuses, typeIds, options({ showDone: true }), today);
		const groups = buildList(board);
		expect(groups.map((g) => g.lane.matter.name)).toEqual(['Inbox', 'Kitchen']);
		expect(groups[1]?.rows.map((r) => r.title)).toEqual(['Call plumber', 'Buy tiles', 'Ask Ana', 'Ancient task', 'Old task']);
	});
});

describe('Sphere bands', () => {
	const spheres = [
		{ id: 'home', label: 'Home', icon: 'house' },
		{ id: 'work', label: 'Work', icon: 'briefcase' },
	];
	// Garden is in Home, Kitchen in Work (ahead of Garden by lane order), Shed in none.
	const sphered = [{ ...kitchen, sphere: 'work' }, inbox, { ...garden, sphere: 'home' }, shed];
	const build = (over: Partial<BoardOptions> = {}) =>
		buildBoard(actions, sphered, settings.statuses, typeIds, options({ spheres, ...over }), today, new Date(2026, 9, 9, 12));

	it('without Spheres there are no bands and no chips', () => {
		const b = buildBoard(actions, sphered, settings.statuses, typeIds, options(), today);
		expect(b.bands).toBeNull();
		expect(b.sphereKeys).toEqual([]);
	});

	it('orders lanes by Sphere in settings order, No Sphere last, the Inbox at its position', () => {
		const b = build();
		expect(b.lanes.map((l) => l.matter.name)).toEqual(['Inbox', 'Garden', 'Kitchen', 'Shed']);
		expect(b.bands?.map((band) => band.sphere?.id ?? null)).toEqual(['home', 'work', null]);
		expect(b.sphereKeys).toEqual(['home', 'work', '']);
	});

	it('counts each band per column, with what is due today or late', () => {
		const work = build().bands?.find((band) => band.sphere?.id === 'work');
		expect(work?.counts.open).toBe(3);
		expect(work?.counts.waiting).toBe(1);
		expect(work?.counts.byStatus.get('next')).toEqual({ count: 2, late: 0 });
	});

	it('focus hides other Spheres, never the Inbox', () => {
		const b = build({ spheresOff: new Set(['home', '']) });
		expect(b.lanes.map((l) => l.matter.name)).toEqual(['Inbox', 'Kitchen']);
		expect(b.columnCounts.get('next')).toBe(2);
		// Every chip off shows everything, like type chips.
		expect(build({ spheresOff: new Set(['home', 'work', '']) }).lanes).toHaveLength(4);
	});

	it('keeps collapsed bands with their lanes and counts', () => {
		const b = build({ spheresCollapsed: new Set(['work']) });
		expect(b.bands?.find((band) => band.sphere?.id === 'work')?.collapsed).toBe(true);
		expect(b.columnCounts.get('next')).toBe(2);
	});

	it('gives the list Sphere sections and keeps the Inbox outside them', () => {
		const layout = buildListLayout(build());
		expect(layout.inbox?.lane.matter.name).toBe('Inbox');
		expect(layout.sections?.map((s) => s.sphere?.id ?? null)).toEqual(['work']);
	});
});
