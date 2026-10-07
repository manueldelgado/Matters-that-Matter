import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { matterNames, planSetup, SAMPLE_FOLDER, type SetupChoices, type VaultSnapshot } from '../../src/services/setupPlan';
import { boardBaseContent } from '../../src/services/baseFile';

const choices = (over: Partial<SetupChoices> = {}): SetupChoices => ({
	folders: { ...DEFAULT_SETTINGS.folders },
	statuses: DEFAULT_SETTINGS.statuses,
	types: DEFAULT_SETTINGS.types,
	newMatters: '',
	adopt: [],
	sample: false,
	inboxPath: DEFAULT_SETTINGS.inboxPath,
	boardPath: DEFAULT_SETTINGS.boardPath,
	baseContent: 'BASE',
	now: new Date(2026, 9, 9, 12, 0),
	...over,
});

const vault = (files: string[] = [], matters: string[] = [], maxLaneOrder: number | null = null): VaultSnapshot => ({
	exists: (p) => files.includes(p) || files.some((f) => f.startsWith(`${p}/`)),
	isMatter: (p) => matters.includes(p),
	maxLaneOrder,
});

describe('matterNames', () => {
	it('sanitises names and drops blanks and duplicates', () => {
		expect(matterNames('Kitchen renovation\n\n  kitchen RENOVATION \nTax: 2026\n')).toEqual(['Kitchen renovation', 'Tax 2026']);
	});
});

describe('planSetup on an empty vault', () => {
	const plan = planSetup(choices({ newMatters: 'Kitchen\nGarden' }), vault());

	it('creates every folder level, parents first', () => {
		expect(plan.folders).toEqual(['MTM', 'MTM/Matters', 'MTM/Actions', 'MTM/Boards', 'MTM/People']);
	});

	it('creates the Inbox, the board and the new Matters', () => {
		expect(plan.create.map((n) => [n.kind, n.path])).toEqual([
			['inbox', 'MTM/Matters/Inbox.md'],
			['board', 'MTM/Boards/Matters.base'],
			['matter', 'MTM/Matters/Kitchen.md'],
			['matter', 'MTM/Matters/Garden.md'],
		]);
		expect(plan.create[0]?.frontmatter).toEqual({ 'mtm-kind': 'matter', 'mtm-icon': 'inbox', 'mtm-state': 'active' });
		expect(plan.create[1]?.body).toBe('BASE');
	});

	it('gives new Matters increasing lane orders', () => {
		expect(plan.create.slice(2).map((n) => n.frontmatter['mtm-lane-order'])).toEqual([1, 2]);
	});

	it('records the Inbox and board paths', () => {
		expect(plan).toMatchObject({ inboxPath: 'MTM/Matters/Inbox.md', boardPath: 'MTM/Boards/Matters.base', modify: [], reuse: [] });
	});
});

describe('planSetup with existing notes', () => {
	it('never overwrites: reuses the Inbox, the board and existing Matters', () => {
		const files = ['MTM/Matters/Inbox.md', 'MTM/Boards/Matters.base', 'MTM/Matters/Kitchen.md', 'MTM/Actions/x.md', 'MTM/People/p.md'];
		const plan = planSetup(choices({ newMatters: 'Kitchen\nGarden' }), vault(files, ['MTM/Matters/Kitchen.md'], 4));
		expect(plan.reuse).toEqual(['MTM/Matters/Inbox.md', 'MTM/Boards/Matters.base', 'MTM/Matters/Kitchen.md']);
		expect(plan.create.map((n) => n.path)).toEqual(['MTM/Matters/Garden.md']);
		expect(plan.create[0]?.frontmatter['mtm-lane-order']).toBe(5);
		expect(plan.folders).toEqual([]);
	});

	it('adopts an existing note typed as a new Matter', () => {
		const plan = planSetup(choices({ newMatters: 'Garden' }), vault(['MTM/Matters/Garden.md']));
		expect(plan.modify).toEqual([{ path: 'MTM/Matters/Garden.md', add: { 'mtm-kind': 'matter', 'mtm-state': 'active' } }]);
	});

	it('adopts picked notes, skipping ones that are already Matters', () => {
		const plan = planSetup(choices({ adopt: ['Travel/Porto.md', 'Work/Old.md'] }), vault([], ['Work/Old.md']));
		expect(plan.modify.map((m) => m.path)).toEqual(['Travel/Porto.md']);
	});

	it('places the Inbox and board in the chosen folders when the old files are gone', () => {
		const plan = planSetup(choices({ folders: { matters: 'Work/Matters', actions: 'Work/Actions', boards: 'Work', people: 'People' } }), vault());
		expect(plan.inboxPath).toBe('Work/Matters/Inbox.md');
		expect(plan.boardPath).toBe('Work/Matters.base');
		expect(plan.folders).toEqual(['Work', 'Work/Matters', 'Work/Actions', 'People']);
	});
});

describe('sample content', () => {
	const plan = planSetup(choices({ sample: true }), vault());
	const samples = plan.create.filter((n) => n.sample);
	const actions = samples.filter((n) => n.kind === 'action');

	it('creates two Matters and eight Actions in the sample folder', () => {
		expect(samples.filter((n) => n.kind === 'matter')).toHaveLength(2);
		expect(actions).toHaveLength(8);
		expect(samples.every((n) => n.path.startsWith(`${SAMPLE_FOLDER}/`) && n.frontmatter['mtm-sample'] === true)).toBe(true);
		expect(plan.folders).toContain(SAMPLE_FOLDER);
	});

	it('covers every status and type', () => {
		const statuses = new Set(actions.map((a) => a.frontmatter['mtm-status']));
		const types = new Set(actions.map((a) => a.frontmatter['mtm-type']));
		expect([...statuses].sort()).toEqual(DEFAULT_SETTINGS.statuses.map((s) => s.id).sort());
		expect([...types].sort()).toEqual(DEFAULT_SETTINGS.types.map((t) => t.id).sort());
	});

	it('links Actions to the sample Matters and dates them from today', () => {
		expect(actions[0]?.frontmatter['mtm-matter']).toEqual({ linkTo: `${SAMPLE_FOLDER}/Kitchen renovation.md` });
		expect(actions[0]?.frontmatter['mtm-due']).toBe('2026-10-09T10:00');
		expect(actions[7]?.frontmatter).toMatchObject({ 'mtm-start': '2026-10-19', 'mtm-due': '2026-10-20' });
	});

	it('sets mtm-completed only on closed Actions', () => {
		for (const a of actions) {
			const closed = a.frontmatter['mtm-status'] === 'done';
			expect('mtm-completed' in a.frontmatter).toBe(closed);
		}
	});

	it('works with a smaller workflow', () => {
		const simple = DEFAULT_SETTINGS.statuses.filter((s) => ['later', 'doing', 'done'].includes(s.id));
		const p = planSetup(choices({ sample: true, statuses: simple }), vault());
		const used = new Set(p.create.filter((n) => n.kind === 'action').map((n) => n.frontmatter['mtm-status']));
		expect(used).toEqual(new Set(['later', 'doing', 'done']));
	});

	it('avoids existing sample file names', () => {
		const p = planSetup(choices({ sample: true }), vault([`${SAMPLE_FOLDER}/Kitchen renovation.md`]));
		expect(p.create.some((n) => n.path === `${SAMPLE_FOLDER}/Kitchen renovation 2.md`)).toBe(true);
	});
});

describe('boardBaseContent', () => {
	it('filters Actions with the bracket syntax and lists the four views', () => {
		const text = boardBaseContent({ board: 'Board', list: 'List', calendar: 'Calendar', timeline: 'Timeline' });
		expect(text).toBe(
			'filters:\n  and:\n    - "note[\\"mtm-kind\\"] == \\"action\\""\nviews:\n' +
				'  - type: mtm-board\n    name: "Board"\n  - type: mtm-list\n    name: "List"\n' +
				'  - type: mtm-calendar\n    name: "Calendar"\n  - type: mtm-timeline\n    name: "Timeline"\n',
		);
	});
});
