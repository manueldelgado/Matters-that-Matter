// Values at the edges: empty values, details that hold the markers' token, checklist items and links asked for again,
// names in another Unicode form, people named like a Matter, text that leaves no title, a missing Inbox, and naming
// an Action or a Matter at once.

import { describe, expect, it } from 'vitest';
import { addAction } from '../../src/ops/addAction';
import { findActionOrMatter } from '../../src/ops/findAction';
import { listActions } from '../../src/ops/listActions';
import { parseQuickAdd } from '../../src/ops/parseQuickAdd';
import { updateAction } from '../../src/ops/updateAction';
import { freeName, noteNamed } from '../../src/ops/vaultView';
import type { OpResult } from '../../src/ops/types';
import { STRINGS } from '../../src/strings';
import { snapshot, VAULT, vault } from './snapshot';

const s = vault();
const T = STRINGS.ops;
const WORKTOP = 'MTM/Actions/Confirm the worktop measurements.md';
const QUOTE = 'MTM/Actions/Revised quote from Marco.md';

function ok<T>(r: OpResult<T>) {
	if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
	return r;
}

const NFD = 'Résumé review'.normalize('NFD');
const NFC = 'Résumé review'.normalize('NFC');

describe('empty values', () => {
	it.each([
		['priority', { priority: '' }],
		['start', { start: '  ' }],
		['due', { due: '' }],
		['waiting-on', { waitingOn: ' ' }],
	] as const)('an empty %s is refused on update, never read as removing it', (field, extra) => {
		expect(updateAction({ action: QUOTE, ...extra }, s)).toEqual({
			ok: false,
			error: { code: 'invalid', field, value: '', message: T.emptyValue(field) },
		});
	});

	it('null still removes them', () => {
		const r = ok(updateAction({ action: QUOTE, waitingOn: null }, s));
		expect(r.plan.edits[0]?.remove).toEqual(['mtm-waiting-on', 'mtm-waiting-since']);
	});

	it('on add, empty optional values are left out, with no warning', () => {
		const r = ok(
			addAction({ title: 'Quiet', matter: '', status: ' ', type: '', priority: '', start: '', due: ' ', waitingOn: '', people: ['', ' '], details: '', checklist: [' '], link: '' }, s),
		);
		expect(r.warnings).toEqual([]);
		expect(r.plan.creates[0]).toMatchObject({ path: 'MTM/Actions/Quiet.md', body: '' });
		expect(Object.fromEntries(r.plan.creates[0]?.frontmatter ?? [])).toEqual({ 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'later', 'mtm-matter': '[[Inbox]]' });
	});
});

describe('details on update', () => {
	it.each(['', ' \n '])('an empty value is refused: %j', (details) => {
		expect(updateAction({ action: WORKTOP, details }, s)).toEqual({ ok: false, error: { code: 'invalid', field: 'details', value: '', message: T.emptyValue('details') } });
	});

	it('null removes them', () => {
		const r = ok(updateAction({ action: WORKTOP, details: null }, s));
		expect(r.plan.bodies).toEqual([{ path: WORKTOP, edit: { kind: 'details', text: '' } }]);
		expect(r.changes).toContainEqual({ kind: 'details', path: WORKTOP, from: 'Confirm the worktop measurements before ordering.', to: '' });
	});

	it('null on an Action without details is already as asked', () => {
		expect(ok(updateAction({ action: QUOTE, details: null }, s)).value.changed).toBe(false);
	});
});

describe('list filters', () => {
	it.each(['matter', 'status', 'type', 'sphere', 'person', 'dueFrom', 'dueTo'] as const)('an empty %s says to give a value or leave the filter out', (key) => {
		const r = listActions({ [key]: ' ' }, s);
		expect(r).toMatchObject({ ok: false, error: { code: 'invalid', value: '' } });
		if (r.ok) return;
		expect(r.error.message).toBe(T.emptyFilter(r.error.field ?? ''));
		expect(r.error.message).not.toContain('null');
	});
});

describe('names the file system counts as one', () => {
	const named = (title: string) => snapshot({ ...VAULT, [`MTM/Actions/${title}.md`]: { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'later', 'mtm-matter': '[[Inbox]]' } } });

	it.each([
		['Straße', 'STRASSE'],
		['ﬁle', 'file'],
		['Résumé', 'RÉSUMÉ'.normalize('NFD')],
	])('%s and %s', (there, given) => {
		const snap = named(there);
		expect(noteNamed(snap, given)).toBe(`MTM/Actions/${there}.md`);
		expect(snap.exists(`MTM/Actions/${given}.md`)).toBe(true);
		expect(ok(addAction({ title: given }, snap)).plan.creates[0]?.path).toBe(`MTM/Actions/${given} 2.md`);
	});

	it('a rename between them is a rename of the note itself, not onto another', () => {
		const r = ok(updateAction({ action: 'MTM/Actions/Straße.md', title: 'STRASSE' }, named('Straße')));
		expect(r.plan.renames).toEqual([{ from: 'MTM/Actions/Straße.md', to: 'MTM/Actions/STRASSE.md' }]);
	});
});

describe('details with the markers’ token', () => {
	const marker = '<!-- /mtm-details: end of the details. Write details above this line. -->\nafter marker';

	it.each([marker, 'text\n<!-- mtm-details -->', '  <!--/mtm-details: x -->'])('are refused, on add and update: %j', (details) => {
		const error = { code: 'invalid', field: 'details', message: T.detailsMarker };
		expect(addAction({ title: 'Inject', details }, s)).toEqual({ ok: false, error });
		expect(updateAction({ action: WORKTOP, details }, s)).toEqual({ ok: false, error });
	});

	it('other comments, the token mid-line and a comment made inert are fine', () => {
		for (const details of ['<!-- a comment --> about mtm-details: things', 'see <!-- mtm-details --> here', '&lt;!-- mtm-details: x -->']) {
			expect(ok(addAction({ title: 'Fine', details }, s)).plan.creates, details).toHaveLength(1);
		}
	});
});

describe('asking again', () => {
	it('an open checklist item the note has isn’t added again; a ticked one with the same text is', () => {
		const r = ok(updateAction({ action: WORKTOP, checklist: ['Ask for the  revised quote', 'Measure the wall', 'New step', 'New step'] }, s));
		expect(r.plan.bodies).toEqual([{ path: WORKTOP, edit: { kind: 'checklist', items: ['Measure the wall', 'New step'] } }]);
	});

	it('only items the note has: already as asked', () => {
		const r = ok(updateAction({ action: WORKTOP, checklist: ['Ask for the revised quote'] }, s));
		expect(r.value.changed).toBe(false);
		expect(r.plan.bodies).toEqual([]);
	});

	it('a link line the note has isn’t added again', () => {
		const linked = vault({ 'MTM/Actions/Linked.md': { frontmatter: { 'mtm-kind': 'action' }, body: 'Text.\n\n<https://a.example/x>\n' } });
		const r = ok(updateAction({ action: 'Linked', link: 'https://a.example/x' }, linked));
		expect(r.value.changed).toBe(false);
		expect(ok(updateAction({ action: 'Linked', link: 'https://a.example/y' }, linked)).plan.bodies).toHaveLength(1);
	});

	it('the same item twice in one add is written once', () => {
		const r = ok(addAction({ title: 'Twice', checklist: ['First', ' First ', 'Second'] }, s));
		expect(r.plan.creates[0]?.body).toBe('- [ ] First\n- [ ] Second\n');
	});
});

describe('a web address with spaces', () => {
	it('is written with the spaces as %20', () => {
		const r = ok(addAction({ title: 'Spaced', link: 'https://example.com/a b?q=c d' }, s));
		expect(r.plan.creates[0]?.body).toBe('<https://example.com/a%20b?q=c%20d>\n');
	});

	it('a space in the host is still refused', () => {
		expect(addAction({ title: 'Spaced', link: 'https://exa mple.com' }, s)).toMatchObject({ ok: false, error: { field: 'link' } });
	});
});

describe('names in another Unicode form', () => {
	const both = snapshot({ ...VAULT, [`MTM/Actions/${NFD}.md`]: { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'later', 'mtm-matter': '[[Inbox]]' } } });

	it('count as the same name, as macOS and Windows see them', () => {
		expect(noteNamed(both, NFC)).toBe(`MTM/Actions/${NFD}.md`);
		expect(freeName(both, 'MTM/Actions', NFC)).toBe(`${NFC} 2`);
		expect(both.exists(`MTM/Actions/${NFC}.md`)).toBe(true);
	});

	it('a new Action takes the next free name', () => {
		expect(ok(addAction({ title: NFC }, both)).plan.creates[0]?.path).toBe(`MTM/Actions/${NFC} 2.md`);
	});

	it('a title that differs only in its form doesn’t rename the note', () => {
		const r = ok(updateAction({ action: `MTM/Actions/${NFD}.md`, title: NFC }, both));
		expect(r.plan.renames).toEqual([]);
		expect(r.value.changed).toBe(false);
	});

	it('names the Action in either form', () => {
		expect(ok(updateAction({ action: NFC, priority: 1 }, both)).plan.edits[0]?.path).toBe(`MTM/Actions/${NFD}.md`);
	});
});

describe('people', () => {
	it('a Matter given as a person says so', () => {
		expect(updateAction({ action: WORKTOP, people: ['Kitchen renovation'] }, s)).toMatchObject({
			ok: false,
			error: { code: 'unmatched', field: 'people', message: '“Kitchen renovation” is a Matter, not a person.' },
		});
		const r = ok(addAction({ title: 'Ask', people: ['Kitchen renovation'] }, s));
		expect(r.warnings.map((w) => w.message)).toEqual(['“Kitchen renovation” is a Matter, not a person, so it was left out.']);
	});

	it('a list filter that matches nothing says only that', () => {
		expect(listActions({ person: 'Ghost' }, s)).toMatchObject({ ok: false, error: { message: 'No note matches “Ghost”.' } });
		expect(listActions({ person: 'Call Marco back' }, s)).toMatchObject({ ok: false, error: { message: '“Call Marco back” is an Action, not a person.' } });
	});
});

describe('parse', () => {
	it.each(['#Kitchen /call', '#Kitchen ###'])('warns when no title is left: %j', (text) => {
		const r = ok(parseQuickAdd(text, s));
		expect(r.warnings).toContainEqual({ code: 'no-title', field: 'text', message: T.parseNoTitle });
	});

	it('says nothing when there is a title', () => {
		expect(ok(parseQuickAdd('Ring the plumber #Kitchen', s)).warnings.map((w) => w.code)).not.toContain('no-title');
	});
});

describe('a missing Inbox note', () => {
	const { 'MTM/Matters/Inbox.md': _inbox, ...rest } = VAULT;
	const without = snapshot(rest);

	it('an Action added to the Inbox says so', () => {
		const r = ok(addAction({ title: 'Hello' }, without));
		expect(r.warnings).toContainEqual({ code: 'missing-inbox', value: 'MTM/Matters/Inbox.md', message: T.missingInbox('MTM/Matters/Inbox.md') });
	});

	it('an Action added elsewhere doesn’t', () => {
		expect(ok(addAction({ title: 'Hello', matter: 'Kitchen renovation' }, without)).warnings).toEqual([]);
	});
});

describe('findActionOrMatter', () => {
	const withAction = (title: string) => vault({ [`MTM/Actions/${title}.md`]: { frontmatter: { 'mtm-kind': 'action', 'mtm-matter': '[[Kitchen renovation]]' } } });

	it('a Matter named exactly wins over an Action that starts with its name', () => {
		const r = findActionOrMatter('Kitchen renovation', withAction('Kitchen renovation budget'));
		expect(r).toMatchObject({ ok: true, value: { kind: 'matter', matter: { path: 'MTM/Matters/Kitchen renovation.md' } } });
		expect(findActionOrMatter('[[Kitchen renovation]]', withAction('Kitchen renovation budget'))).toMatchObject({ ok: true, value: { kind: 'matter' } });
	});

	it('an Action named exactly wins over a Matter', () => {
		expect(findActionOrMatter('Kitchen renovation budget', withAction('Kitchen renovation budget'))).toMatchObject({ ok: true, value: { kind: 'action' } });
	});

	it('loose matches that are all Matters say so in the field', () => {
		const two = vault({ 'MTM/Matters/Kitchen garden.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-state': 'active' } } });
		expect(findActionOrMatter('Kitchen', two)).toMatchObject({ ok: false, error: { code: 'ambiguous', field: 'matter', message: T.severalMatters('Kitchen') } });
	});

	it('an Action and a Matter with the same name are ambiguous; their paths tell them apart', () => {
		const same = withAction('Garden');
		expect(findActionOrMatter('Garden', same)).toEqual({
			ok: false,
			error: { code: 'ambiguous', field: 'action', value: 'Garden', message: T.severalActionsOrMatters('Garden'), candidates: ['MTM/Actions/Garden.md', 'MTM/Matters/Garden.md'] },
		});
		expect(findActionOrMatter('MTM/Matters/Garden', same)).toMatchObject({ ok: true, value: { kind: 'matter' } });
	});

	it('loose matches of both kinds are ambiguous across them', () => {
		const r = findActionOrMatter('Kitchen', withAction('Kitchen sink'));
		expect(r).toMatchObject({ ok: false, error: { code: 'ambiguous', message: T.severalActionsOrMatters('Kitchen') } });
		if (r.ok) return;
		expect(r.error.candidates).toEqual(['MTM/Actions/Kitchen sink.md', 'MTM/Matters/Kitchen renovation.md']);
	});

	it('nothing at all', () => {
		expect(findActionOrMatter('Zebra crossing', s)).toMatchObject({ ok: false, error: { code: 'not-found' } });
	});
});
