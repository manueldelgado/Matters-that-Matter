import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { matterNames, planSetup, SAMPLE_FOLDER, type SetupChoices, type VaultSnapshot } from '../../src/services/setupPlan';
import { SAMPLE_ACTIONS, SAMPLE_MATTERS } from '../../src/services/samplePackage';
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
	const byTitle = (title: string) => actions.find((a) => a.path.endsWith(`/${title}.md`));

	it('writes the whole package into the sample folder, marked as sample', () => {
		expect(samples.filter((n) => n.kind === 'matter')).toHaveLength(SAMPLE_MATTERS.length);
		expect(actions).toHaveLength(SAMPLE_ACTIONS.length);
		expect(samples.every((n) => n.path.startsWith(`${SAMPLE_FOLDER}/`))).toBe(true);
		expect(samples.filter((n) => n.kind !== 'file').every((n) => n.frontmatter['mtm-sample'] === true)).toBe(true);
		expect(plan.folders).toEqual(expect.arrayContaining([SAMPLE_FOLDER, `${SAMPLE_FOLDER}/Matters`, `${SAMPLE_FOLDER}/Actions`, `${SAMPLE_FOLDER}/People`, `${SAMPLE_FOLDER}/Notes`]));
	});

	it('files Inbox Actions in the real Inbox and links the rest to their Matters and people', () => {
		expect(byTitle('Renew the passport')?.frontmatter['mtm-matter']).toEqual({ linkTo: DEFAULT_SETTINGS.inboxPath });
		expect(byTitle('Feedback on chapter 2')?.frontmatter).toMatchObject({
			'mtm-matter': { linkTo: `${SAMPLE_FOLDER}/Matters/Doctoral thesis.md` },
			'mtm-waiting-on': { linkTo: `${SAMPLE_FOLDER}/People/Alice Archer.md` },
			'mtm-people': [{ linkTo: `${SAMPLE_FOLDER}/People/Alice Archer.md` }],
			'mtm-waiting-since': '2026-09-19',
		});
	});

	it('dates everything from today', () => {
		expect(byTitle('Confirm the worktop measurements')?.frontmatter['mtm-due']).toBe('2026-10-09T10:00');
		expect(byTitle('Interview the operations team')?.frontmatter).toMatchObject({ 'mtm-start': '2026-10-08', 'mtm-due': '2026-10-10' });
		expect(byTitle('Teach session 4')?.frontmatter['mtm-completed']).toBe('2026-10-08');
	});

	it('sets mtm-completed only on closed Actions', () => {
		for (const a of actions) expect('mtm-completed' in a.frontmatter).toBe(a.frontmatter['mtm-status'] === 'done');
	});

	it('maps to a smaller workflow and other types', () => {
		const simple = DEFAULT_SETTINGS.statuses.filter((s) => ['later', 'doing', 'done'].includes(s.id));
		const types = DEFAULT_SETTINGS.types.filter((t) => ['write', 'call'].includes(t.id));
		const p = planSetup(choices({ sample: true, statuses: simple, types }), vault());
		const acts = p.create.filter((n) => n.kind === 'action');
		expect(new Set(acts.map((n) => n.frontmatter['mtm-status']))).toEqual(new Set(['later', 'doing', 'done']));
		expect(new Set(acts.map((n) => n.frontmatter['mtm-type']))).toEqual(new Set(['write', 'call']));
		expect(acts).toHaveLength(SAMPLE_ACTIONS.length);
	});

	it('avoids existing sample file names', () => {
		const p = planSetup(choices({ sample: true }), vault([`${SAMPLE_FOLDER}/Matters/Kitchen renovation.md`]));
		const kitchen = `${SAMPLE_FOLDER}/Matters/Kitchen renovation 2.md`;
		expect(p.create.some((n) => n.path === kitchen)).toBe(true);
		expect(p.create.find((n) => n.path.endsWith('/Order the worktop.md'))?.frontmatter['mtm-matter']).toEqual({ linkTo: kitchen });
	});

	it('continues the lane order after existing Matters', () => {
		const p = planSetup(choices({ sample: true }), vault([], [], 7));
		expect(p.create.find((n) => n.path.endsWith('/Kitchen renovation.md'))?.frontmatter['mtm-lane-order']).toBe(8);
	});
});

describe('boardBaseContent', () => {
	it('filters Actions with the bracket syntax and lists the four views, then Next actions', () => {
		const text = boardBaseContent({ board: 'Board', list: 'List', calendar: 'Calendar', timeline: 'Timeline', nextActions: 'Next actions' });
		expect(text).toBe(
			'filters:\n  and:\n    - "note[\\"mtm-kind\\"] == \\"action\\""\nviews:\n' +
				'  - type: mtm-board\n    name: "Board"\n  - type: mtm-list\n    name: "List"\n' +
				'  - type: mtm-calendar\n    name: "Calendar"\n  - type: mtm-timeline\n    name: "Timeline"\n' +
				'  - type: mtm-list\n    name: "Next actions"\n    mtmGroupBy: type\n    mtmShowBacklog: false\n    mtmInboxPosition: hidden\n    mtmShowDone: hide\n',
		);
	});
});

describe('planSetup and existing Actions', () => {
	it('never adopts an Action as a Matter; the new Matter gets another name', () => {
		const snapshot: VaultSnapshot = {
			exists: (p) => p === 'MTM/Matters/Call Bob.md',
			isMatter: () => false,
			isOtherKind: (p) => p === 'MTM/Matters/Call Bob.md',
			maxLaneOrder: null,
		};
		const plan = planSetup(choices({ newMatters: 'Call Bob', adopt: ['MTM/Matters/Call Bob.md'] }), snapshot);
		expect(plan.modify).toEqual([]);
		expect(plan.create.some((n) => n.path === 'MTM/Matters/Call Bob 2.md')).toBe(true);
	});
});
