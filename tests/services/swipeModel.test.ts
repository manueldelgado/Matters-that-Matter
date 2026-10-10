import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { reviewInfo } from '../../src/model/matters';
import { toYmd } from '../../src/model/dates';
import type { MatterInfo } from '../../src/services/boardModel';
import { samplePlan, SAMPLE_SPHERES } from '../../src/services/samplePackage';
import { isLinkTo, type PlannedNote } from '../../src/services/setupPlan';
import { buildBoard, type BoardOptions } from '../../src/services/boardModel';
import { chosenPill, openingColumn, swipePills } from '../../src/services/swipeModel';
import { nextStepStatus } from '../../src/services/nextAction';

// The sample package, written and read on Friday 9 October 2026 at noon.
const now = new Date(2026, 9, 9, 12, 0);
const inboxPath = DEFAULT_SETTINGS.inboxPath;
const plan = samplePlan({ now, statuses: DEFAULT_SETTINGS.statuses, types: DEFAULT_SETTINGS.types, inboxPath, laneOrder: 0, exists: () => false });
const base = (p: string) => p.split('/').pop()?.replace(/\.md$/, '') ?? p;
const paths = new Map([...plan.map((n) => [base(n.path), n.path] as const), ['Inbox', inboxPath] as const]);
const link = (v: unknown) => (isLinkTo(v) ? `[[${base(v.linkTo)}]]` : v);
const matterPaths = new Set([inboxPath, ...plan.filter((n) => n.kind === 'matter').map((n) => n.path)]);
const resolve = (raw: string) => {
	const path = paths.get(raw.replace(/^\[\[|\]\]$/g, ''));
	return path ? { path, isMatter: matterPaths.has(path) } : null;
};
const frontmatter = (n: PlannedNote) => Object.fromEntries(Object.entries(n.frontmatter).map(([k, v]) => [k, Array.isArray(v) ? v.map(link) : link(v)]));

const items = plan.filter((n) => n.kind === 'action').map((n) => toActionItem(n.path, base(n.path), frontmatter(n), DEFAULT_SETTINGS, resolve));
const matters: MatterInfo[] = plan
	.filter((n) => n.kind === 'matter')
	.map((n, i) => {
		const fm = n.frontmatter;
		return {
			path: n.path,
			name: base(n.path),
			laneOrder: i,
			isInbox: false,
			icon: typeof fm['mtm-icon'] === 'string' ? fm['mtm-icon'] : 'circle-dot',
			state: fm['mtm-state'] as MatterInfo['state'],
			review: fm['mtm-review-every'] ? reviewInfo(fm['mtm-review-every'], fm['mtm-last-reviewed'], toYmd(now)) : null,
			sphere: typeof fm['mtm-sphere'] === 'string' ? fm['mtm-sphere'] : null,
			sphereOrphan: null,
			outcome: null,
		};
	});
matters.push({ path: inboxPath, name: 'Inbox', laneOrder: null, isInbox: true, icon: 'inbox', state: 'active', review: null, sphere: null, sphereOrphan: null, outcome: null });
const statuses = DEFAULT_SETTINGS.statuses;
const options = (over: Partial<BoardOptions> = {}): BoardOptions => ({
	inboxPosition: 'top',
	showDone: true,
	doneDays: null,
	hideEmptyLanes: false,
	typesOff: new Set(),
	laneToggles: {},
	spheres: [...SAMPLE_SPHERES],
	spheresOff: new Set(),
	spheresCollapsed: new Set(),
	...over,
});
const board = (over: Partial<BoardOptions> = {}) => buildBoard(items, matters, statuses, options(over), toYmd(now), now, items);
const names = (pills: { lane: { matter: { name: string } } }[]) => pills.map((p) => p.lane.matter.name);
const nextId = nextStepStatus(statuses)?.id ?? null;

describe('swipePills on the sample package', () => {
	const pills = swipePills(board(), now);

	it('follows the board: the Inbox first, then each Sphere, dormant and closed Matters last in their group', () => {
		expect(names(pills)).toEqual([
			'Inbox',
			'Kitchen renovation', 'Household admin', 'Learn to sail',
			'Lakeside strategy review', 'Advisory practice',
			'Doctoral thesis', 'Conference paper',
			'Research methods course', 'Course redesign',
			'Half marathon', 'Old blog',
		]);
	});

	it('labels the first pill of each Sphere group', () => {
		const groups = pills.filter((p) => p.group !== undefined).map((p) => [p.lane.matter.name, p.group?.label ?? 'No Sphere']);
		expect(groups).toEqual([
			['Kitchen renovation', 'Home'],
			['Lakeside strategy review', 'Advisory'],
			['Doctoral thesis', 'Research'],
			['Research methods course', 'Teaching'],
			['Half marathon', 'No Sphere'],
		]);
	});

	it('signals what is due today or late, else a review due; dims dormant and closed Matters', () => {
		const signal = (name: string) => pills.find((p) => p.lane.matter.name === name)?.signal;
		expect(signal('Kitchen renovation')).toEqual({ kind: 'count', n: 2 });
		expect(signal('Household admin')).toEqual({ kind: 'count', n: 1 });
		expect(signal('Half marathon')).toEqual({ kind: 'review' });
		expect(signal('Course redesign')).toBeNull();
		expect(signal('Inbox')).toBeNull();
		expect(pills.filter((p) => p.dim).map((p) => p.lane.matter.name)).toEqual(['Learn to sail', 'Old blog']);
	});

	it('puts the Inbox last when the board does, and follows the Sphere chips and Hide empty lanes', () => {
		expect(names(swipePills(board({ inboxPosition: 'bottom' }), now)).at(-1)).toBe('Inbox');
		expect(names(swipePills(board({ spheresOff: new Set(['home', 'advisory', 'research', 'teaching', '']) }), now))).toEqual(['Inbox']);
		expect(names(swipePills(board({ hideEmptyLanes: true, showDone: false }), now))).not.toContain('Old blog');
	});
});

describe('chosenPill and openingColumn', () => {
	const model = board();
	const pills = swipePills(model, now);
	const lane = (name: string) => {
		const l = model.lanes.find((x) => x.matter.name === name);
		if (!l) throw new Error(name);
		return l;
	};

	it('shows the Matter remembered, else the first with open Actions', () => {
		expect(chosenPill(pills, paths.get('Half marathon') ?? null)?.lane.matter.name).toBe('Half marathon');
		expect(chosenPill(pills, 'gone.md')?.lane.matter.name).toBe('Inbox');
		expect(chosenPill([], null)).toBeNull();
	});

	it('opens on the first column after the backlog with cards', () => {
		expect(openingColumn(lane('Kitchen renovation'), model.columns, nextId)).toBe('next');
		expect(openingColumn(lane('Doctoral thesis'), model.columns, nextId)).toBe('next');
		// The Inbox has only backlog cards.
		expect(openingColumn(lane('Inbox'), model.columns, nextId)).toBe('later');
	});

	it('opens on the ghost when a Matter has no next Action', () => {
		expect(openingColumn(lane('Course redesign'), model.columns, nextId)).toBe('next');
	});
});
