import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MattersSettings } from '../../src/settings';
import { nextLaneOrder } from '../../src/model/matters';
import { toActionItem } from '../../src/services/actionItems';
import {
	attachments,
	DEFAULT_MATTER_ICON,
	folderOf,
	laneOf,
	linkedNotes,
	linkedTarget,
	matterInfo,
	matterLink,
	matterList,
	missingInbox,
	newActionFrontmatter,
	newMatterFrontmatter,
	noteId,
	peopleIndex,
	peoplePaths,
	personCandidates,
	personKey,
	withNoteId,
	type LinkTarget,
	type NoteData,
	type ResolveTarget,
} from '../../src/services/notesModel';

const today = '2026-10-09';
const settings: MattersSettings = {
	...DEFAULT_SETTINGS,
	spheres: [{ id: 'home', label: 'Home', icon: 'house' }],
};
const INBOX = settings.inboxPath;

const note = (path: string, frontmatter?: Record<string, unknown>): NoteData => ({
	path,
	basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
	frontmatter,
});

/** A vault of paths: link text resolves by exact path, path without `.md`, or basename. */
function resolverOver(paths: readonly string[]): ResolveTarget<LinkTarget> {
	return (linkpath) => {
		const hit = paths.find((p) => p === linkpath || p === `${linkpath}.md` || p.split('/').pop()?.replace(/\.[^.]+$/, '') === linkpath || p.split('/').pop() === linkpath);
		const name = hit?.split('/').pop() ?? '';
		return hit ? { path: hit, extension: name.includes('.') ? (name.split('.').pop() ?? '') : '' } : null;
	};
}

describe('matterLink', () => {
	it.each([
		['MTM/Matters/Kitchen.md', 'Kitchen', '[[Kitchen]]'],
		['MTM/Matters/Kitchen.md', 'MTM/Matters/Kitchen', '[[MTM/Matters/Kitchen]]'],
		['MTM/Matters/Kitchen.md', null, '[[Kitchen]]'],
		['MTM/Matters/Old.MD', null, '[[Old]]'],
		['Inbox.md', null, '[[Inbox]]'],
	])('%s with link text %s → %s', (path, linktext, expected) => {
		expect(matterLink(path, linktext)).toBe(expected);
	});
});

describe('newActionFrontmatter', () => {
	const base = { statusId: 'next', typeId: 'call', matterLink: '[[Kitchen]]' };

	it('writes kind, type, status and Matter first, in that order', () => {
		const fm = newActionFrontmatter(base, settings.statuses, today);
		expect(Object.entries(fm)).toEqual([
			['mtm-kind', 'action'],
			['mtm-type', 'call'],
			['mtm-status', 'next'],
			['mtm-matter', '[[Kitchen]]'],
		]);
	});

	it('adds start, due, priority, people and completion in that order', () => {
		const fm = newActionFrontmatter(
			{ ...base, statusId: 'done', start: '2026-10-12', due: '2026-10-15T10:00', priority: 1, people: ['[[Marco Rossi]]', '[[Ana]]'] },
			settings.statuses,
			today,
		);
		expect(Object.keys(fm)).toEqual(['mtm-kind', 'mtm-type', 'mtm-status', 'mtm-matter', 'mtm-start', 'mtm-due', 'mtm-priority', 'mtm-people', 'mtm-completed']);
		expect(fm['mtm-start']).toBe('2026-10-12');
		expect(fm['mtm-due']).toBe('2026-10-15T10:00');
		expect(fm['mtm-priority']).toBe(1);
		expect(fm['mtm-people']).toEqual(['[[Marco Rossi]]', '[[Ana]]']);
		expect(fm['mtm-completed']).toBe(today);
	});

	it.each([
		['an open status', { statusId: 'later' }, []],
		['an active status', { statusId: 'doing' }, []],
		['an unknown status', { statusId: 'gone' }, []],
		['a closed status', { statusId: 'done' }, ['mtm-completed']],
		['empty dates and no priority', { start: null, due: '', priority: null }, []],
		['no people', { people: [] }, []],
	])('with %s', (_label, over, extra) => {
		const fm = newActionFrontmatter({ ...base, ...over }, settings.statuses, today);
		expect(Object.keys(fm)).toEqual(['mtm-kind', 'mtm-type', 'mtm-status', 'mtm-matter', ...extra]);
	});

	it('waiting on someone: the person after the priority, the waiting-since date after the people', () => {
		const fm = newActionFrontmatter({ ...base, priority: 2, waitingOn: '[[Ana]]', people: ['[[Ana]]'] }, settings.statuses, today);
		expect(Object.keys(fm)).toEqual(['mtm-kind', 'mtm-type', 'mtm-status', 'mtm-matter', 'mtm-priority', 'mtm-waiting-on', 'mtm-people', 'mtm-waiting-since']);
		expect(fm['mtm-waiting-on']).toBe('[[Ana]]');
		expect(fm['mtm-waiting-since']).toBe(today);
	});

	it('does not share the people array it was given', () => {
		const people = ['[[Ana]]'];
		const fm = newActionFrontmatter({ ...base, people }, settings.statuses, today);
		expect(fm['mtm-people']).toEqual(people);
		expect(fm['mtm-people']).not.toBe(people);
	});
});

describe('newMatterFrontmatter', () => {
	it('writes an active Matter with its icon and lane order', () => {
		expect(Object.entries(newMatterFrontmatter({ icon: 'hammer', reviewEvery: null }, 4))).toEqual([
			['mtm-kind', 'matter'],
			['mtm-icon', 'hammer'],
			['mtm-state', 'active'],
			['mtm-lane-order', 4],
		]);
	});

	it('can start in another state', () => {
		expect(newMatterFrontmatter({ icon: 'hammer', reviewEvery: null, state: 'dormant' }, 4)['mtm-state']).toBe('dormant');
	});

	it('adds rhythm, Sphere and outcome in that order', () => {
		const fm = newMatterFrontmatter({ icon: 'house', reviewEvery: '2w', sphereId: 'home', outcome: '  Kitchen  usable\nagain ' }, 1);
		expect(Object.keys(fm)).toEqual(['mtm-kind', 'mtm-icon', 'mtm-state', 'mtm-lane-order', 'mtm-review-every', 'mtm-sphere', 'mtm-outcome']);
		expect(fm['mtm-review-every']).toBe('2w');
		expect(fm['mtm-sphere']).toBe('home');
		expect(fm['mtm-outcome']).toBe('Kitchen usable again');
	});

	it.each([
		['no rhythm', { reviewEvery: '' }],
		['no Sphere', { sphereId: null }],
		['a blank outcome', { outcome: '   ' }],
	])('leaves out %s', (_label, over) => {
		const fm = newMatterFrontmatter({ icon: 'x', reviewEvery: null, ...over }, 1);
		expect(Object.keys(fm)).toEqual(['mtm-kind', 'mtm-icon', 'mtm-state', 'mtm-lane-order']);
	});
});

describe('lane order for a new Matter', () => {
	const order = (notes: NoteData[]) => nextLaneOrder(notes.map((n) => laneOf(n, INBOX)));

	it.each([
		['no Matters', [], 1],
		['Matters without an order', [note('M/A.md', {})], 1],
		['the highest order + 1', [note('M/A.md', { 'mtm-lane-order': 2 }), note('M/B.md', { 'mtm-lane-order': '5' })], 6],
		['a fractional order', [note('M/A.md', { 'mtm-lane-order': 2.5 })], 3],
		['the Inbox ignored', [note(INBOX, { 'mtm-lane-order': 40 }), note('M/A.md', { 'mtm-lane-order': 3 })], 4],
		['only the Inbox', [note(INBOX, { 'mtm-lane-order': 40 })], 1],
	])('%s', (_label, notes, expected) => {
		expect(order(notes)).toBe(expected);
	});

	it('marks the Inbox lane', () => {
		expect(laneOf(note(INBOX, {}), INBOX)).toEqual({ path: INBOX, name: 'Inbox', laneOrder: null, isInbox: true });
		expect(laneOf(note('M/A.md', { 'mtm-lane-order': 1 }), INBOX)).toEqual({ path: 'M/A.md', name: 'A', laneOrder: 1, isInbox: false });
	});
});

describe('matterInfo', () => {
	it('reads a Matter note', () => {
		const info = matterInfo(
			note('M/Kitchen.md', { 'mtm-kind': 'matter', 'mtm-icon': ' hammer ', 'mtm-state': 'dormant', 'mtm-lane-order': 3, 'mtm-sphere': 'home', 'mtm-outcome': 'Done' }),
			settings,
			today,
		);
		expect(info).toEqual({
			path: 'M/Kitchen.md',
			name: 'Kitchen',
			laneOrder: 3,
			isInbox: false,
			icon: 'hammer',
			state: 'dormant',
			review: null,
			sphere: 'home',
			sphereOrphan: null,
			outcome: 'Done',
		});
	});

	it.each([
		['no icon', {}, DEFAULT_MATTER_ICON],
		['a blank icon', { 'mtm-icon': '  ' }, DEFAULT_MATTER_ICON],
		['an icon that is not text', { 'mtm-icon': 3 }, DEFAULT_MATTER_ICON],
	])('a Matter with %s gets the default icon', (_label, fm, icon) => {
		expect(matterInfo(note('M/A.md', fm), settings, today).icon).toBe(icon);
	});

	it.each([
		['an unknown state', { 'mtm-state': 'paused' }, 'active'],
		['no state', {}, 'active'],
		['closed', { 'mtm-state': 'closed' }, 'closed'],
	])('a Matter with %s is %s', (_label, fm, state) => {
		expect(matterInfo(note('M/A.md', fm), settings, today).state).toBe(state);
	});

	it('reads the review rhythm', () => {
		const info = matterInfo(note('M/A.md', { 'mtm-review-every': '1w', 'mtm-last-reviewed': '2026-10-01' }), settings, today);
		expect(info.review).toMatchObject({ cadence: { n: 1, unit: 'w' }, lastReviewed: '2026-10-01', daysSince: 8, nextDue: '2026-10-08', due: true });
		expect(matterInfo(note('M/A.md', { 'mtm-review-every': 'often' }), settings, today).review).toBeNull();
	});

	it('flags a Sphere that settings lack', () => {
		const info = matterInfo(note('M/A.md', { 'mtm-sphere': 'gone' }), settings, today);
		expect(info.sphere).toBeNull();
		expect(info.sphereOrphan).toBe('gone');
	});

	it('keeps the Inbox active, without review, Sphere or outcome', () => {
		const info = matterInfo(
			note(INBOX, { 'mtm-kind': 'matter', 'mtm-state': 'closed', 'mtm-review-every': '1w', 'mtm-sphere': 'home', 'mtm-outcome': 'x' }),
			settings,
			today,
		);
		expect(info).toMatchObject({ isInbox: true, icon: 'inbox', state: 'active', review: null, sphere: null, sphereOrphan: null, outcome: null });
	});

	it('gives the Inbox its own icon only when it has none', () => {
		expect(matterInfo(note(INBOX, {}), settings, today).icon).toBe('inbox');
		expect(matterInfo(note(INBOX, undefined), settings, today).icon).toBe('inbox');
		expect(matterInfo(note(INBOX, { 'mtm-icon': 'mail' }), settings, today).icon).toBe('mail');
		expect(matterInfo(note(INBOX, { 'mtm-icon': '  ' }), settings, today).icon).toBe(DEFAULT_MATTER_ICON);
	});
});

describe('matterList', () => {
	const kitchen = note('M/Kitchen.md', { 'mtm-kind': 'matter' });
	const inboxNote = note(INBOX, { 'mtm-kind': 'matter', 'mtm-icon': 'inbox' });

	it.each([
		['the Inbox among the Matter notes', [kitchen, inboxNote], inboxNote, ['M/Kitchen.md', INBOX]],
		['the Inbox without mtm-kind', [kitchen], note(INBOX, {}), ['M/Kitchen.md', INBOX]],
		['the Inbox note missing', [kitchen], null, ['M/Kitchen.md', INBOX]],
		['no Matters and no Inbox', [], null, [INBOX]],
	])('with %s', (_label, matters, inbox, paths) => {
		const list = matterList(matters, inbox, settings, today);
		expect(list.map((m) => m.path)).toEqual(paths);
		expect(list.filter((m) => m.isInbox)).toHaveLength(1);
	});

	it('stands in for a missing Inbox, named after its path', () => {
		const list = matterList([], null, { ...settings, inboxPath: 'Work/To sort.md' }, today);
		expect(list).toEqual([missingInbox({ inboxPath: 'Work/To sort.md' })]);
		expect(list[0]).toEqual({
			path: 'Work/To sort.md',
			name: 'To sort',
			laneOrder: null,
			isInbox: true,
			icon: 'inbox',
			state: 'active',
			review: null,
			sphere: null,
			sphereOrphan: null,
			outcome: null,
		});
	});
});

describe('people', () => {
	const vault = ['MTM/People/Marco Rossi.md', 'Ana.md', 'MTM/Actions/Call.md'];
	const resolve = resolverOver(vault);

	it.each([
		['[[Marco Rossi]]', 'MTM/People/Marco Rossi.md'],
		['[[Marco Rossi|Marco]]', 'MTM/People/Marco Rossi.md'],
		['[[Ana#Phone]]', 'Ana.md'],
		['Ana', 'Ana.md'],
		['[[Nobody]]', 'Nobody'],
		['[[]]', null],
		['', null],
		[3, null],
		[['[[Ana]]'], null],
		[undefined, null],
	])('personKey(%j) → %j', (raw, key) => {
		expect(personKey(raw, resolve)).toBe(key);
	});

	it('linkedTarget resolves link values only', () => {
		expect(linkedTarget('[[Ana]]', resolve)?.path).toBe('Ana.md');
		expect(linkedTarget('[[Nobody]]', resolve)).toBeNull();
		expect(linkedTarget(null, resolve)).toBeNull();
	});

	it.each([
		['a list and waiting on', { 'mtm-people': ['[[Ana]]', '[[Nobody]]'], 'mtm-waiting-on': '[[Marco Rossi]]' }, ['Ana.md', 'MTM/People/Marco Rossi.md']],
		['a single value', { 'mtm-people': '[[Ana]]' }, ['Ana.md']],
		['the same person twice', { 'mtm-people': ['[[Ana]]'], 'mtm-waiting-on': '[[Ana|A]]' }, ['Ana.md']],
		['nobody', {}, []],
	])('peoplePaths with %s', (_label, fm, paths) => {
		expect([...peoplePaths(fm, resolve)]).toEqual(paths);
	});

	it('indexes the Actions that name each person', () => {
		const actions = [
			note('MTM/Actions/Call.md', { 'mtm-kind': 'action', 'mtm-people': ['[[Ana]]'], 'mtm-waiting-on': '[[Marco Rossi]]' }),
			note('MTM/Actions/Write.md', { 'mtm-kind': 'action', 'mtm-people': ['[[Ana]]'] }),
			note('MTM/Actions/Alone.md', { 'mtm-kind': 'action' }),
		];
		const asked: string[] = [];
		const index = peopleIndex(
			actions,
			() => resolve,
			(n) => {
				asked.push(n.path);
				return toActionItem(n.path, n.basename, n.frontmatter, settings, () => null);
			},
		);
		expect(asked).toEqual(['MTM/Actions/Call.md', 'MTM/Actions/Write.md']);
		expect([...index.keys()]).toEqual(['Ana.md', 'MTM/People/Marco Rossi.md']);
		expect(index.get('Ana.md')?.map((e) => [e.item.path, e.waiting])).toEqual([
			['MTM/Actions/Call.md', false],
			['MTM/Actions/Write.md', false],
		]);
		expect(index.get('MTM/People/Marco Rossi.md')?.map((e) => [e.item.path, e.waiting])).toEqual([['MTM/Actions/Call.md', true]]);
	});

	it('resolves each Action\'s links from that Action', () => {
		const sources: string[] = [];
		peopleIndex(
			[note('A/One.md', { 'mtm-people': ['[[Ana]]'] }), note('B/Two.md', { 'mtm-people': ['[[Ana]]'] })],
			(source) => {
				sources.push(source);
				return resolve;
			},
			(n) => toActionItem(n.path, n.basename, n.frontmatter, settings, () => null),
		);
		expect(sources).toEqual(['A/One.md', 'B/Two.md']);
	});

	it.each([
		['Ana.md', ''],
		['MTM/People/Marco Rossi.md', 'MTM/People'],
		['a/b/c.md', 'a/b'],
	])('folderOf(%s) → %j', (path, folder) => {
		expect(folderOf(path)).toBe(folder);
	});

	it('offers notes without mtm-kind as people, the people folder first', () => {
		const notes = [
			note('MTM/People/Marco Rossi.md', {}),
			note('Ana.md', undefined),
			note('MTM/People2/Bea.md', { tags: ['x'] }),
			note('MTM/Actions/Call.md', { 'mtm-kind': 'action' }),
			note('MTM/Matters/Kitchen.md', { 'mtm-kind': 'matter' }),
		];
		expect(personCandidates(notes, 'MTM/People')).toEqual([
			{ path: 'MTM/People/Marco Rossi.md', name: 'Marco Rossi', names: ['Marco Rossi'], rank: 0, inPeople: true, folder: 'MTM/People' },
			{ path: 'Ana.md', name: 'Ana', names: ['Ana'], rank: 1, inPeople: false, folder: '' },
			{ path: 'MTM/People2/Bea.md', name: 'Bea', names: ['Bea'], rank: 1, inPeople: false, folder: 'MTM/People2' },
		]);
	});
});

describe('links in an Action\'s body', () => {
	const vault = ['MTM/Actions/Call.md', 'Notes/Plan.md', 'Notes/Quote.pdf', 'img/photo.png', 'MTM/Matters/Kitchen.md', 'Ana.md', 'Notes/Data'];
	const resolve = resolverOver(vault);
	const source = 'MTM/Actions/Call.md';

	it.each([
		['notes once, in order', ['Plan', 'Plan#Budget', 'Ana'], new Set<string>(), ['Notes/Plan.md', 'Ana.md']],
		['without files that are not notes', ['Quote.pdf', 'photo.png', 'Data', 'Plan'], new Set<string>(), ['Notes/Plan.md']],
		['without the note itself', ['Call', 'Plan'], new Set<string>(), ['Notes/Plan.md']],
		['without the Matter and people', ['Kitchen', 'Ana', 'Plan'], new Set(['MTM/Matters/Kitchen.md', 'Ana.md']), ['Notes/Plan.md']],
		['without unresolved links', ['Nowhere', '#Heading'], new Set<string>(), []],
	])('linkedNotes: %s', (_label, links, exclude, paths) => {
		expect(linkedNotes(links, source, resolve, exclude).map((t) => t.path)).toEqual(paths);
	});

	it.each([
		['files once, in order', ['Quote.pdf', 'photo.png', 'Quote.pdf#page=2'], ['Notes/Quote.pdf', 'img/photo.png']],
		['files without an extension', ['Data'], ['Notes/Data']],
		['not notes or unresolved embeds', ['Plan', 'Missing.png'], []],
	])('attachments: %s', (_label, embeds, paths) => {
		expect(attachments(embeds, resolve).map((t) => t.path)).toEqual(paths);
	});

	it('returns the resolver\'s own targets', () => {
		const target = { path: 'Notes/Plan.md', extension: 'md', extra: true };
		expect(linkedNotes(['Plan'], source, () => target, new Set())[0]).toBe(target);
	});
});

describe('stable IDs', () => {
	const id = () => 'fixed-id';
	it('adds one right after mtm-kind, to Actions and Matters only', () => {
		expect(Object.entries(withNoteId({ 'mtm-kind': 'action', 'mtm-type': 'call' }, id))).toEqual([
			['mtm-kind', 'action'],
			['mtm-id', 'fixed-id'],
			['mtm-type', 'call'],
		]);
		expect(withNoteId({ 'mtm-kind': 'matter' }, id)['mtm-id']).toBe('fixed-id');
		expect(withNoteId({ tags: ['x'] }, id)).toEqual({ tags: ['x'] });
	});

	it('keeps one already there, and replaces a blank one', () => {
		expect(withNoteId({ 'mtm-kind': 'action', 'mtm-id': 'kept' }, id)['mtm-id']).toBe('kept');
		expect(Object.entries(withNoteId({ 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-id': ' ' }, id))).toEqual([
			['mtm-kind', 'action'],
			['mtm-id', 'fixed-id'],
			['mtm-type', 'call'],
		]);
		expect(noteId({ 'mtm-id': ' ' })).toBeNull();
		expect(noteId({ 'mtm-id': 7 })).toBeNull();
	});
});
