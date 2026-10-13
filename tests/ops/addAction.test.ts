import { describe, expect, it } from 'vitest';
import { addAction } from '../../src/ops/addAction';
import type { AddActionInput, OpResult } from '../../src/ops/types';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { VAULT, vault } from './snapshot';

const s = vault();

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

const created = (input: AddActionInput, snap = s) => {
	const r = ok(addAction(input, snap));
	const create = r.plan.creates[0];
	if (!create) throw new Error('nothing created');
	return { r, create, fm: Object.fromEntries(create.frontmatter) };
};

describe('addAction: fields', () => {
	it('creates the note in the Actions folder with status, type and Matter explicit, keys in order', () => {
		const { r, create } = created({ title: 'Call Marco about the tiles', matter: 'Kitchen renovation', type: 'call', status: 'Next', due: '2026-10-16T10:00', priority: 'high' });
		expect(create.path).toBe('MTM/Actions/Call Marco about the tiles.md');
		expect(create.frontmatter).toEqual([
			['mtm-kind', 'action'],
			['mtm-type', 'call'],
			['mtm-status', 'next'],
			['mtm-matter', '[[Kitchen renovation]]'],
			['mtm-due', '2026-10-16T10:00'],
			['mtm-priority', 1],
		]);
		expect(create.body).toBe('');
		expect(r.plan.edits).toEqual([]);
		expect(r.warnings).toEqual([]);
		expect(r.value.changed).toBe(true);
		expect(r.value.action).toMatchObject({
			path: 'MTM/Actions/Call Marco about the tiles.md',
			title: 'Call Marco about the tiles',
			matter: { path: 'MTM/Matters/Kitchen renovation.md', name: 'Kitchen renovation', isInbox: false },
			status: { id: 'next', label: 'Next', category: 'open' },
			type: { id: 'call', label: 'Call' },
			due: '2026-10-16T10:00',
			priority: 1,
			orphans: [],
		});
	});

	it('without a status, type or Matter: the backlog, the default type and the Inbox, with no warning', () => {
		const { fm, r } = created({ title: 'Something' });
		expect(fm).toMatchObject({ 'mtm-status': 'later', 'mtm-type': 'write', 'mtm-matter': '[[Inbox]]' });
		expect(r.warnings).toEqual([]);
	});

	it('describes every property it writes', () => {
		const { r } = created({ title: 'Something', type: 'buy' });
		expect(r.changes).toEqual([
			{ kind: 'create', path: 'MTM/Actions/Something.md' },
			{ kind: 'property', path: 'MTM/Actions/Something.md', key: 'mtm-kind', from: null, to: 'action' },
			{ kind: 'property', path: 'MTM/Actions/Something.md', key: 'mtm-type', from: null, to: 'buy' },
			{ kind: 'property', path: 'MTM/Actions/Something.md', key: 'mtm-status', from: null, to: 'later' },
			{ kind: 'property', path: 'MTM/Actions/Something.md', key: 'mtm-matter', from: null, to: '[[Inbox]]' },
		]);
	});

	it.each([
		['1', 1],
		[2, 2],
		['low', 3],
		['Medium', 2],
		[null, undefined],
	] as const)('priority %j', (priority, expected) => {
		expect(created({ title: 'P', priority }).fm['mtm-priority']).toBe(expected);
	});

	it.each([
		['2026-10-16', '2026-10-16'],
		['2026-10-16T09:30', '2026-10-16T09:30'],
		['2026-10-16 09:30:00', '2026-10-16T09:30'],
		['tomorrow', '2026-10-10'],
		['fri 10:00', '2026-10-16T10:00'],
		['by the 21st', '2026-10-21'],
		['el viernes', '2026-10-16'],
	])('due %j', (due, expected) => {
		expect(created({ title: 'D', due }).fm['mtm-due']).toBe(expected);
	});

	it.each([
		['a UTC time', '2026-10-16T23:30:00Z'],
		['a time ahead of UTC', '2026-10-16T10:00+05:00'],
		['a time behind UTC', '2026-10-16T10:00-08:00'],
		['a time zone without a colon', '2026-10-16T10:00+0200'],
		['a time zone in words', 'fri 10am EST'],
		['an offset in words', 'fri 10:00 GMT+2'],
	])('a date with a time zone is refused, and says so: %s', (_, due) => {
		for (const field of ['due', 'start'] as const) {
			const r = addAction({ title: 'D', [field]: due }, s);
			expect(r).toMatchObject({ ok: false, error: { code: 'invalid', field, value: due } });
			expect(r.ok ? '' : r.error.message).toBe(`“${due}” has a time zone. Dates are in local time, with no time zone: write it as YYYY-MM-DD or YYYY-MM-DDTHH:mm, such as 2026-10-16T10:00, or in words such as “fri 10:00”.`);
		}
	});

	it.each([
		['month 13', '2026-13-12'],
		['month 14', '2026-14-02'],
		['day 32', '2026-10-32'],
		['one-figure month and day', '2026-1-5'],
		['slashes', '2026/10/16'],
	])('a date in figures but not in a stored form is refused, never read as words: %s', (_, due) => {
		for (const field of ['due', 'start'] as const) {
			const r = addAction({ title: 'D', [field]: due }, s);
			expect(r).toMatchObject({ ok: false, error: { code: 'invalid', field, value: due } });
			expect(r.ok ? '' : r.error.message).toBe(`“${due}” isn’t a date Matters that Matter can read. Write it as YYYY-MM-DD or YYYY-MM-DDTHH:mm, in local time with no time zone, such as 2026-10-16 or 2026-10-16T10:00.`);
		}
	});

	it('stored forms with seconds, fractions or a space still read', () => {
		expect(created({ title: 'D', due: '2026-10-16T09:30:15.250' }).fm['mtm-due']).toBe('2026-10-16T09:30');
		expect(created({ title: 'D', due: ' 2026-10-16 09:30 ' }).fm['mtm-due']).toBe('2026-10-16T09:30');
		expect(created({ title: 'D', start: '2026-10-12' }).fm['mtm-start']).toBe('2026-10-12');
	});

	it('only the date languages in settings read words', () => {
		const english = vault({}, { settings: { dateLanguages: ['en'] } });
		expect(addAction({ title: 'D', due: 'el viernes' }, english)).toMatchObject({ ok: false, error: { code: 'invalid', field: 'due' } });
	});

	it('a closed status sets the completion date to today', () => {
		const { fm } = created({ title: 'Already done', status: 'done' });
		expect(fm['mtm-completed']).toBe('2026-10-09');
	});

	it('waiting on someone adds them to the people and sets the waiting-since date', () => {
		const { fm } = created({ title: 'Wait', waitingOn: 'Lucía', people: ['Marco Rossi'] });
		expect(fm).toMatchObject({
			'mtm-waiting-on': '[[Lucía Pérez]]',
			'mtm-people': ['[[Marco Rossi]]', '[[Lucía Pérez]]'],
			'mtm-waiting-since': '2026-10-09',
		});
		const keys = Object.keys(fm);
		expect(keys.indexOf('mtm-waiting-on')).toBeLessThan(keys.indexOf('mtm-people'));
		expect(keys.indexOf('mtm-people')).toBeLessThan(keys.indexOf('mtm-waiting-since'));
	});

	it('writes details, then the checklist, then the link, in the body', () => {
		const { create, r } = created({ title: 'Read', details: 'Why it matters.', checklist: ['First', '  ', 'Second'], link: 'Some note' });
		expect(create.body).toBe('Why it matters.\n\n- [ ] First\n- [ ] Second\n\n[[Some note]]\n');
		expect(r.changes.filter((c) => c.kind !== 'property' && c.kind !== 'create')).toEqual([
			{ kind: 'details', path: 'MTM/Actions/Read.md', from: '', to: 'Why it matters.' },
			{ kind: 'checklist', path: 'MTM/Actions/Read.md', added: ['First', 'Second'] },
			{ kind: 'link', path: 'MTM/Actions/Read.md', line: '[[Some note]]' },
		]);
	});

	it.each([
		['a note by name', 'Some note', '[[Some note]]'],
		['a note by path', 'Notes/Read later.md', '[[Read later]]'],
		['a wikilink', '[[Read later]]', '[[Read later]]'],
		['a web address, as an autolink', 'https://example.com/a?b=1', '<https://example.com/a?b=1>'],
		['a web address with markup, made inert', 'https://a.com/[x](obsidian://open?vault=v)', '<https://a.com/%5Bx%5D%28obsidian://open?vault=v%29>'],
		['a web address with a backtick', 'https://a.com/`x`', '<https://a.com/%60x%60>'],
		['a web address with an inline query', 'https://a.com/$=dv.x', '<https://a.com/%24=dv.x>'],
		['a web address with an embed', 'https://a.com/![[x]]', '<https://a.com/%21%5B%5Bx%5D%5D>'],
		['a web address with a pipe and angle brackets', 'https://a.com/a|b?<c>', '<https://a.com/a%7Cb?%3Cc%3E>'],
		['a web address with comment markers', 'https://x.com/%%a?b=%%#c%%', '<https://x.com/%25%25a?b=%25%25#c%25%25>'],
		['a web address with a stray % beside an escape', 'https://x.com/a%%41%2', '<https://x.com/a%25%41%252>'],
		['a web address keeping its percent escapes', 'https://x.com/a%20b?q=%C3%A9', '<https://x.com/a%20b?q=%C3%A9>'],
	])('link: %s', (_, link, line) => {
		expect(created({ title: 'L', link }).create.body).toBe(`${line}\n`);
	});

	it('links use the shortest link text that is unambiguous', () => {
		const clash = vault({ 'Archive/Some note.md': {}, 'Archive/Kitchen renovation.md': {} });
		const { create, fm } = created({ title: 'L', link: 'Notes/Some note', matter: 'MTM/Matters/Kitchen renovation.md' }, clash);
		expect(create.body).toBe('[[Notes/Some note]]\n');
		expect(fm['mtm-matter']).toBe('[[MTM/Matters/Kitchen renovation]]');
	});

	it.each(['javascript:alert(1)', 'obsidian://open?vault=x', 'file:///etc/passwd', 'data:text/html,x', 'No such note', 'https://exa mple.com', 'https://a.com/x y', 'MTM/People'])(
		'link %j is refused',
		(link) => {
			const r = addAction({ title: 'L', link }, s);
			expect(r).toMatchObject({ ok: false, error: { code: 'invalid', field: 'link' } });
		},
	);

	it.each([
		['priority', { priority: 'urgent' }],
		['priority', { priority: 4 }],
		['due', { due: 'whenever' }],
		['due', { due: 'fri to mon' }],
		['start', { start: '2026-02-30' }],
	] as const)('an unreadable %s is invalid', (field, extra) => {
		expect(addAction({ title: 'X', ...extra }, s)).toMatchObject({ ok: false, error: { code: 'invalid', field } });
	});

	it('warns when the start is after the due date, and keeps both', () => {
		const { fm, r } = created({ title: 'Odd', start: '2026-10-20', due: '2026-10-12' });
		expect(fm).toMatchObject({ 'mtm-start': '2026-10-20', 'mtm-due': '2026-10-12' });
		expect(r.warnings.map((w) => w.code)).toEqual(['start-after-due']);
	});
});

describe('addAction: quick add text', () => {
	it('reads tokens and dates from the text', () => {
		const { create, fm, r } = created({ text: 'Call Marco about the quote /call #Kitchen fri 10:00 !1 @Marco' });
		expect(create.path).toBe('MTM/Actions/Call Marco about the quote 2.md');
		expect(fm).toEqual({
			'mtm-kind': 'action',
			'mtm-type': 'call',
			'mtm-status': 'later',
			'mtm-matter': '[[Kitchen renovation]]',
			'mtm-due': '2026-10-16T10:00',
			'mtm-priority': 1,
			'mtm-people': ['[[Marco Rossi]]'],
		});
		expect(r.warnings).toEqual([]);
	});

	it('fields win over the text', () => {
		const { fm, create } = created({ text: 'Ask about the gym /msg #Kitchen tomorrow !3', title: 'Ask about the pool', type: 'buy', matter: 'Advisory work', priority: 1 });
		expect(create.path).toBe('MTM/Actions/Ask about the pool.md');
		expect(fm).toMatchObject({ 'mtm-type': 'buy', 'mtm-matter': '[[Advisory work]]', 'mtm-priority': 1, 'mtm-due': '2026-10-10' });
	});

	it('an empty title field leaves the title to the text', () => {
		expect(created({ text: 'Ring the plumber /call', title: '' }).create.path).toBe('MTM/Actions/Ring the plumber.md');
	});

	it('an Action needs a title', () => {
		expect(addAction({ text: '/call #Kitchen' }, s)).toMatchObject({ ok: false, error: { code: 'invalid', field: 'title' } });
		expect(addAction({}, s)).toMatchObject({ ok: false, error: { code: 'invalid', field: 'title' } });
	});
});

describe('addAction: values that match nothing fall back, with a warning each', () => {
	it.each([
		['type', { type: 'fax' }, { 'mtm-type': 'write' }, 'No type matches “fax”, so it uses the default type, Write.'],
		['matter', { matter: 'Gym' }, { 'mtm-matter': '[[Inbox]]' }, 'No Matter matches “Gym”, so it went to the Inbox.'],
		['status', { status: 'Someday' }, { 'mtm-status': 'later' }, 'No status matches “Someday”, so it starts in Later.'],
		['person', { people: ['Nobody'] }, {}, 'No note matches “Nobody”, so it was left out.'],
		['person', { waitingOn: 'Nobody' }, {}, 'No note matches “Nobody”, so it was left out.'],
	] as const)('an unmatched %s', (_, extra, expected, message) => {
		const { fm, r } = created({ title: 'Fallback', ...extra });
		expect(fm).toMatchObject(expected);
		expect(fm['mtm-people']).toBeUndefined();
		expect(fm['mtm-waiting-on']).toBeUndefined();
		expect(r.warnings.map((w) => w.message)).toEqual([message]);
	});

	it('tokens in the text that match nothing', () => {
		const { fm, r } = created({ text: 'Ask about the gym /fax #Gym @Nobody' });
		expect(fm).toMatchObject({ 'mtm-type': 'write', 'mtm-matter': '[[Inbox]]' });
		expect(r.warnings.map((w) => [w.code, w.message])).toEqual([
			['unmatched-type', 'No type matches “fax”, so it uses the default type, Write.'],
			['unmatched-matter', 'No Matter matches “Gym”, so it went to the Inbox.'],
			['unmatched-person', 'No note matches “Nobody”, so it was left out.'],
		]);
	});

	it('a date in the text that isn’t read: no date, kept in the title, a warning', () => {
		const { fm, r, create } = created({ text: 'Order the tiles 2026-13-12 #Kitchen' });
		expect(create.path).toBe('MTM/Actions/Order the tiles 2026-13-12.md');
		expect(fm['mtm-due']).toBeUndefined();
		expect(r.warnings.map((w) => [w.code, w.field, w.value, w.message])).toEqual([
			['unreadable-date', 'text', '2026-13-12', '“2026-13-12” isn’t a real date, so no date was set and it stays in the title.'],
		]);
		const zoned = created({ text: 'Call the bank fri 10am EST' });
		expect(zoned.fm['mtm-due']).toBeUndefined();
		expect(zoned.r.warnings.map((w) => w.message)).toEqual([
			'“fri 10am EST” has a time zone, so no date was set and it stays in the title. Dates are in local time: leave the zone out.',
		]);
	});

	it('a field that matches nothing falls back to what the text says', () => {
		const { fm, r } = created({ text: 'Ring the plumber /call #Advisory', type: 'fax', matter: 'Gym' });
		expect(fm).toMatchObject({ 'mtm-type': 'call', 'mtm-matter': '[[Advisory work]]' });
		expect(r.warnings.map((w) => w.message)).toEqual([
			'No type matches “fax”, so it uses Call, as the text says.',
			'No Matter matches “Gym”, so it went to Advisory work, as the text says.',
		]);
	});

	it('warnings name fields as other tools do', () => {
		expect(created({ title: 'W', waitingOn: 'Nobody' }).r.warnings[0]?.field).toBe('waiting-on');
	});

	it('the Inbox is called the Inbox, whatever its note is named', () => {
		const renamed = vault({ 'MTM/Matters/Capture.md': VAULT['MTM/Matters/Inbox.md'] ?? {} }, { settings: { inboxPath: 'MTM/Matters/Capture.md' } });
		expect(created({ title: 'X', matter: 'Gym' }, renamed).r.warnings[0]?.message).toBe('No Matter matches “Gym”, so it went to the Inbox.');
	});

	it('a token overridden by a field gives no warning', () => {
		const { r } = created({ text: 'Ask about the gym #Gym', matter: 'Garden' });
		expect(r.warnings).toEqual([]);
	});

	it('several equally good matches are an error, not a guess', () => {
		const s2 = vault({ 'MTM/Matters/Kitchen garden.md': { frontmatter: { 'mtm-kind': 'matter' } } });
		const r = addAction({ title: 'X', matter: 'Kitchen' }, s2);
		expect(r).toEqual({
			ok: false,
			error: {
				code: 'ambiguous',
				field: 'matter',
				value: 'Kitchen',
				message: 'Several Matters match “Kitchen”.',
				candidates: ['MTM/Matters/Kitchen renovation.md', 'MTM/Matters/Kitchen garden.md'],
			},
		});
	});
});

describe('addAction: people with the same name', () => {
	const twins = vault({ 'Notes/Marco Rossi.md': {} });

	it('the note in the people folder wins, for a field as for a token', () => {
		expect(created({ title: 'W', waitingOn: 'Marco Rossi' }, twins).fm['mtm-waiting-on']).toBe('[[MTM/People/Marco Rossi]]');
		expect(created({ text: 'Ask @"Marco Rossi"' }, twins).fm['mtm-people']).toEqual(['[[MTM/People/Marco Rossi]]']);
		expect(created({ title: 'W', people: ['Marco'] }, twins).fm['mtm-people']).toEqual(['[[MTM/People/Marco Rossi]]']);
	});

	it('two notes with the same name outside the people folder are ambiguous', () => {
		const s2 = vault({ 'Notes/Ana.md': {}, 'Work/Ana.md': {} });
		expect(addAction({ title: 'W', waitingOn: 'Ana' }, s2)).toMatchObject({ ok: false, error: { code: 'ambiguous', field: 'waiting-on', candidates: ['Notes/Ana.md', 'Work/Ana.md'] } });
	});
});

describe('addAction: lists from other tools', () => {
	it.each([
		['people', { people: 'Marco' }],
		['checklist', { checklist: 'One' }],
		['checklist', { checklist: ['One', 2] }],
	])('%s must be a list of text', (field, extra) => {
		expect(addAction({ title: 'X', ...(extra as object) }, s)).toMatchObject({ ok: false, error: { code: 'invalid', field } });
	});
});

describe('addAction: file names', () => {
	it('sanitises the title and appends " 2" when the name is taken, ignoring case', () => {
		expect(created({ title: 'pay the COUNCIL tax' }).create.path).toBe('MTM/Actions/pay the COUNCIL tax 2.md');
		expect(created({ title: 'Plan: phase #1 [draft]' }).create.path).toBe('MTM/Actions/Plan phase 1 draft.md');
	});

	it('a name any note has elsewhere is taken too, so its links keep reaching it', () => {
		// The Matter is in another folder: an Action called the same would share [[Kitchen renovation]].
		expect(created({ title: 'Kitchen renovation' }).create.path).toBe('MTM/Actions/Kitchen renovation 2.md');
		expect(created({ title: 'some NOTE' }).create.path).toBe('MTM/Actions/some NOTE 2.md');
		expect(created({ text: 'Marco Rossi' }).create.path).toBe('MTM/Actions/Marco Rossi 2.md');
	});

	it('a title made only of forbidden characters becomes "Untitled Action"', () => {
		expect(created({ title: '###' }).create.path).toBe('MTM/Actions/Untitled Action.md');
	});

	it('the Actions folder comes from settings', () => {
		const other = vault({}, { settings: { folders: { ...DEFAULT_SETTINGS.folders, actions: '/Work/Actions/' } } });
		expect(created({ title: 'Here' }, other).create.path).toBe('Work/Actions/Here.md');
	});
});

describe('addAction: the vault must be ready', () => {
	it.each([
		['before setup', { setupDone: false }],
		['with newer settings', { schemaVersion: DEFAULT_SETTINGS.schemaVersion + 1 }],
		['without types', { types: [] }],
	])('%s nothing is planned', (_, settings) => {
		expect(addAction({ title: 'X' }, vault({}, { settings }))).toMatchObject({ ok: false, error: { code: 'not-ready' } });
	});
});
