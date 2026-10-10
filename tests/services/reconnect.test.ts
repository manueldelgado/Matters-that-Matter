import { describe, expect, it } from 'vitest';
import { presetStatuses, presetTypes } from '../../src/services/presets';
import { labelFromId, needsReconnect, putBack, recognise, typeIcon, type ScannedAction, type ScannedMatter, type VaultScan } from '../../src/services/reconnect';
import { SAMPLE_SPHERES, samplePlan } from '../../src/services/samplePackage';

const INBOX = 'MTM/Matters/Inbox.md';

/** The sample package as written under a preset, with the Inbox setup creates. */
function sampleScan(preset: 'default' | 'next'): VaultScan {
	const notes = samplePlan({ now: new Date(2026, 9, 9, 12), statuses: presetStatuses(preset), types: presetTypes(preset), inboxPath: INBOX, laneOrder: 1, exists: () => false });
	const actions: ScannedAction[] = [];
	const matters: ScannedMatter[] = [{ path: INBOX, sphere: undefined, icon: 'inbox', sample: false }];
	for (const n of notes) {
		const fm = n.frontmatter as Record<string, unknown>;
		if (fm['mtm-kind'] === 'action') actions.push({ path: n.path, status: fm['mtm-status'], type: fm['mtm-type'], completed: fm['mtm-completed'], sample: true, people: [] });
		if (fm['mtm-kind'] === 'matter') matters.push({ path: n.path, sphere: fm['mtm-sphere'], icon: fm['mtm-icon'], sample: true });
	}
	return { actions, matters, boards: ['MTM/Boards/Matters.base'] };
}

const act = (path: string, status: string, type: string, extra: Partial<ScannedAction> = {}): ScannedAction => ({ path, status, type, completed: undefined, sample: false, people: [], ...extra });
const repeat = (n: number, make: (i: number) => ScannedAction) => Array.from({ length: n }, (_, i) => make(i));

/** Someone's own workflow, folders and a renamed Inbox (the mock-up's second case). */
function ownScan(): VaultScan {
	const a = (status: string, type: string, n: number, extra: Partial<ScannedAction> = {}) =>
		repeat(n, (i) => act(`Work/Actions/${status} ${type} ${i}.md`, status, type, extra));
	const done = { completed: '2026-10-01' };
	const actions = [
		...a('backlog', 'email', 21),
		...a('this-week', 'write', 9),
		...a('in-progress', 'deep-work', 6, { people: ['People/Marco Rossi.md'] }),
		...a('waiting', 'phone-call', 4, { people: ['People/Ana.md'] }),
		...a('finished', 'email', 10, done),
		...a('finished', 'write', 15, done),
		...a('finished', 'deep-work', 13, done),
		...a('finished', 'phone-call', 8, done),
		...a('finished', 'errand', 6, done),
		...a('dropped', 'errand', 3, done),
	];
	const matter = (name: string, sphere?: string): ScannedMatter => ({ path: `Work/Matters/${name}.md`, sphere, icon: 'circle-dot', sample: false });
	const matters = [
		{ path: 'Work/Matters/Capture.md', sphere: undefined, icon: 'inbox', sample: false },
		...['A', 'B', 'C', 'D', 'E', 'F'].map((n) => matter(n, 'work')),
		...['G', 'H', 'I'].map((n) => matter(n, 'family')),
		...['J', 'K'].map((n) => matter(n, 'side-projects')),
	];
	return { actions, matters, boards: ['Work/Boards/Work.base'] };
}

describe('needsReconnect', () => {
	it('is needed with Actions, or Matters other than an Inbox at the default path', () => {
		expect(needsReconnect({ actions: [], matters: [], boards: [] }, INBOX)).toBe(false);
		expect(needsReconnect({ actions: [], matters: [{ path: INBOX, sphere: undefined, icon: 'inbox', sample: false }], boards: [] }, INBOX)).toBe(false);
		expect(needsReconnect({ actions: [], matters: [{ path: 'Kitchen.md', sphere: undefined, icon: 'hammer', sample: false }], boards: [] }, INBOX)).toBe(true);
		expect(needsReconnect({ actions: [act('a.md', 'next', 'call')], matters: [], boards: [] }, INBOX)).toBe(true);
	});
});

describe('labelFromId and typeIcon', () => {
	it('turns IDs back into labels', () => {
		expect(labelFromId('in-progress')).toBe('In progress');
		expect(labelFromId('algun-dia')).toBe('Algun dia');
		expect(labelFromId('later')).toBe('Later');
	});

	it('guesses icons from words in the ID', () => {
		expect(typeIcon('email')).toBe('mail');
		expect(typeIcon('phone-call')).toBe('phone');
		expect(typeIcon('deep-work')).toBe('circle-dot');
	});
});

describe('recognise: a preset', () => {
	it('brings Get stuff done back whole, contexts and sample Spheres included', () => {
		const r = recognise(sampleScan('next'));
		expect(r.preset).toBe('next');
		expect(r.statuses).toEqual(presetStatuses('next'));
		expect(r.types).toEqual(presetTypes('next'));
		expect(r.spheres).toEqual([...SAMPLE_SPHERES]);
		expect(r.generated).toEqual({ statuses: [], types: [], spheres: [] });
		expect(r.added).toEqual([]);
		expect(r.counts.statuses).toEqual({ someday: 16, next: 16, doing: 6, waiting: 7, done: 13 });
		expect(r.counts.spheres).toEqual({ home: 3, advisory: 2, research: 2, teaching: 2 });
		expect(r.sample).toBe(true);
		expect(r.actionCount).toBe(58);
		expect(r.matterCount).toBe(11);
	});

	it('brings the default workflow back, with its types', () => {
		const r = recognise(sampleScan('default'));
		expect(r.preset).toBe('default');
		expect(r.statuses).toEqual(presetStatuses('default'));
		expect(r.types).toEqual(presetTypes('default'));
	});

	it("doesn't let sample notes steer the folders, and finds the Inbox and board", () => {
		const r = recognise(sampleScan('next'));
		expect(r.folders).toEqual({ matters: 'MTM/Matters', actions: 'MTM/Actions', boards: 'MTM/Boards', people: 'MTM/People' });
		expect(r.inboxPath).toBe(INBOX);
		expect(r.boardPath).toBe('MTM/Boards/Matters.base');
	});

	it('keeps a preset’s statuses when its types are the other set', () => {
		const r = recognise({ actions: [act('a.md', 'someday', 'call'), act('b.md', 'next', 'write')], matters: [], boards: [] });
		expect(r.statuses).toEqual(presetStatuses('next'));
		expect(r.types).toEqual(presetTypes('default'));
		expect(r.preset).toBeNull();
		expect(r.generated.statuses).toEqual([]);
	});

	it('takes the default workflow when no Action exists yet', () => {
		const r = recognise({ actions: [], matters: [{ path: 'Kitchen.md', sphere: undefined, icon: 'hammer', sample: false }], boards: [] });
		expect(r.preset).toBe('default');
		expect(r.statuses).toEqual(presetStatuses('default'));
	});
});

describe('recognise: someone’s own workflow', () => {
	const r = recognise(ownScan());

	it('makes labels from IDs, keeps known IDs’ look, and orders by category then count', () => {
		expect(r.preset).toBeNull();
		expect(r.statuses).toEqual([
			{ id: 'backlog', label: 'Backlog', tone: 'ink', category: 'open', backlog: true },
			{ id: 'this-week', label: 'This week', tone: 'sky', category: 'open' },
			{ id: 'in-progress', label: 'In progress', tone: 'butter', category: 'open' },
			{ id: 'waiting', label: 'Waiting', tone: 'lavender', category: 'active' },
			{ id: 'finished', label: 'Finished', tone: 'mint', category: 'closed', done: true },
			{ id: 'dropped', label: 'Dropped', tone: 'peach', category: 'closed' },
		]);
		expect(r.generated.statuses).toEqual(['backlog', 'this-week', 'in-progress', 'finished', 'dropped']);
		expect(r.added).toEqual([]);
	});

	it('puts known types first, the rest by use, guesses icons, and makes the most used the default', () => {
		expect(r.types).toEqual([
			{ id: 'write', label: 'Write', icon: 'pencil-line', tone: 'butter' },
			{ id: 'email', label: 'Email', icon: 'mail', tone: 'mint', default: true },
			{ id: 'deep-work', label: 'Deep work', icon: 'circle-dot', tone: 'sky' },
			{ id: 'phone-call', label: 'Phone call', icon: 'phone', tone: 'lavender' },
			{ id: 'errand', label: 'Errand', icon: 'shopping-bag', tone: 'peach' },
		]);
		expect(r.generated.types).toEqual(['email', 'deep-work', 'phone-call', 'errand']);
	});

	it('reads Spheres, the renamed Inbox, the board and the folders', () => {
		expect(r.spheres).toEqual([
			{ id: 'work', label: 'Work', icon: 'circle-dot' },
			{ id: 'family', label: 'Family', icon: 'circle-dot' },
			{ id: 'side-projects', label: 'Side projects', icon: 'circle-dot' },
		]);
		expect(r.inboxPath).toBe('Work/Matters/Capture.md');
		expect(r.boardPath).toBe('Work/Boards/Work.base');
		expect(r.folders).toEqual({ matters: 'Work/Matters', actions: 'Work/Actions', boards: 'Work/Boards', people: 'People' });
		expect(r.inFolders).toEqual({ matters: 11, actions: 95, people: 2 });
		expect(r.matterCount).toBe(11);
		expect(r.sample).toBe(false);
	});

	it('adds a done status when nothing is closed, and a backlog when nothing is open', () => {
		const noClosed = recognise({ actions: [act('a.md', 'todo', 'call'), act('b.md', 'doing', 'call')], matters: [], boards: [] });
		expect(noClosed.statuses.map((s) => [s.id, s.category, !!s.backlog, !!s.done])).toEqual([
			['todo', 'open', true, false],
			['doing', 'active', false, false],
			['done', 'closed', false, true],
		]);
		expect(noClosed.added).toEqual(['done']);
		const noOpen = recognise({ actions: [act('a.md', 'finished', 'call', { completed: '2026-10-01' })], matters: [], boards: [] });
		expect(noOpen.statuses.map((s) => s.id)).toEqual(['later', 'finished']);
		expect(noOpen.added).toEqual(['later']);
	});

	it('ignores values that are not text', () => {
		const odd = recognise({ actions: [act('a.md', 'next', 'call'), { ...act('b.md', 'x', 'y'), status: ['a'], type: 3 }], matters: [], boards: [] });
		expect(odd.counts.statuses).toEqual({ next: 1 });
		expect(odd.counts.types).toEqual({ call: 1 });
	});
});

describe('putBack', () => {
	it('puts lost items back in their found place, without markers', () => {
		const found = recognise(ownScan()).statuses;
		const current = found.filter((s) => s.id !== 'dropped' && s.id !== 'this-week');
		const back = putBack(current, found, ['dropped', 'this-week']);
		expect(back.map((s) => s.id)).toEqual(['backlog', 'this-week', 'in-progress', 'waiting', 'finished', 'dropped']);
		expect(back.find((s) => s.id === 'this-week')).toEqual({ id: 'this-week', label: 'This week', tone: 'sky', category: 'open' });
	});
});
