// Every command's human and JSON output on the fixture vault and the synthetic one, writes through the safe writer,
// dry runs, the plan for other tools, and opening in Obsidian.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ContentsAfter } from '../../cli/src/filesLayer';
import { fixtureCopy, hashes, mtm, normalise, read, syntheticVault, tempDir, writeFiles } from './helpers';
import { contentsAfter } from '../../cli/src/filesLayer';
import { dryRunWording } from '../../cli/src/strings';
import { STRINGS } from '../../src/strings';

const made: string[] = [];
const keep = (root: string) => (made.push(dirname(root)), root);
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** The files layer's writer (the default; named here so each write says which it uses). */
const writer = { contentsAfter };

describe('reading', () => {
	it('workflow', async () => {
		const root = keep(fixtureCopy());
		const r = await mtm(['workflow', '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Statuses
			  Later    later    Open    backlog
			  Next     next     Open
			  Doing    doing    Active
			  Waiting  waiting  Active
			  Done     done     Closed  done

			Action types
			  ● Call     call
			  ● Message  message
			  ● Write    write    default
			  ● Meet     meet
			  ● Buy      buy
			  ● Visit    visit

			Spheres
			  Home      home
			  Advisory  advisory
			  Research  research
			  Teaching  teaching
			"
		`);
		const json = JSON.parse((await mtm(['workflow', '--json', '--vault', root])).stdout) as { statuses: { id: string; backlog: boolean }[] };
		expect(json.statuses.map((s) => s.id)).toEqual(['later', 'next', 'doing', 'waiting', 'done']);
		expect(json.statuses[0]?.backlog).toBe(true);
	});

	it('matters, in board order', async () => {
		const root = keep(fixtureCopy());
		const r = await mtm(['matters', '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Inbox                      7 open
			Kitchen renovation         Home · 22 open · 2 today or late · 2 waiting · reviewed 3 days ago
			Household admin            Home · 4 open · 1 today or late · 1 waiting · review due
			Learn to sail              Home · dormant · 1 open
			Lakeside strategy review   Advisory · 5 open · 1 today or late · 1 waiting · reviewed yesterday
			Advisory practice          Advisory · 3 open · 1 today or late · review due
			Doctoral thesis            Research · 8 open · 3 waiting · reviewed 5 days ago
			Conference paper           Research · 4 open · reviewed 10 days ago
			Research methods course    Teaching · 5 open · 1 today or late · 1 waiting · reviewed 2 days ago
			Course redesign            Teaching · 2 open · reviewed 12 days ago · no next Action
			Half marathon              2 open · review due
			Old blog                   Closed · 0 open
			Edge - twin                1 open
			Edge - unknown Sphere      0 open · no next Action

			14 Matters
			"
		`);
		const json = JSON.parse((await mtm(['matters', '--json', '--vault', root])).stdout) as { name: string; isInbox: boolean }[];
		expect(json[0]).toMatchObject({ name: 'Inbox', isInbox: true });
	});

	it('list, filtered, grouped by Matter, with orphans named', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['list', '--vault', root])).stdout).toMatchInlineSnapshot(`
			"Inbox
			  ● Call     Call Marco back                    Later
			  ● Write    Mystery                            Later                             Not recognised: status “someday” (shown as Later), type “fax” (shown as Write), Matter “[[Nowhere]]” (shown in the Inbox)
			  ● Buy      Pay the council tax                Next     Yesterday, late

			Kitchen renovation
			  ● Call     Confirm the worktop measurements   Next     Today 10:00, late  high
			  ● Call     Call Marco about the quote         Next
			  ● Message  Revised quote from Marco           Waiting                           waiting on Marco Rossi, 2 weeks

			Advisory work
			  ● Write    Send the invoice                   Doing    Tue 20 Oct

			7 Actions
			"
		`);
		expect((await mtm(['list', '--waiting', '--vault', root])).stdout).toMatchInlineSnapshot(`
			"Kitchen renovation
			  ● Message  Revised quote from Marco   Waiting  waiting on Marco Rossi, 2 weeks

			1 Action
			"
		`);
		expect((await mtm(['list', '--status', 'Done', '--vault', root])).stdout).toMatchInlineSnapshot(`
			"Kitchen renovation
			  ● Buy  Order the tiles   Done

			1 Action
			"
		`);
	});

	it('list with nothing to show', async () => {
		const root = keep(syntheticVault());
		expect(await mtm(['list', '--type', 'Visit', '--vault', root])).toEqual({ code: 0, stdout: 'No Actions match.\n', stderr: '' });
		expect(JSON.parse((await mtm(['list', '--type', 'Visit', '--json', '--vault', root])).stdout)).toEqual([]);
	});

	it('show', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['show', 'Confirm the worktop measurements', '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Confirm the worktop measurements
			  Kitchen renovation · Next · Call · due today 10:00 · high priority
			  MTM/Actions/Confirm the worktop measurements.md

			  Confirm the worktop measurements before ordering.

			  Checklist (1 of 2)
			    [ ] Ask for the revised quote
			    [x] Measure the wall

			  Linked notes: Some note, Marco Rossi
			"
		`);
		expect((await mtm(['show', 'Revised quote from Marco', '--vault', root])).stdout).toMatchInlineSnapshot(`
			"Revised quote from Marco
			  Kitchen renovation · Waiting · Message
			  Waiting on Marco Rossi since 23 Sep (2 weeks)
			  People: Marco Rossi
			  MTM/Actions/Revised quote from Marco.md
			"
		`);
		expect((await mtm(['show', 'MTM/Actions/Mystery.md', '--vault', root])).stdout).toMatchInlineSnapshot(`
			"Mystery
			  Inbox · Later · Write
			  Not recognised: status “someday” (shown as Later), type “fax” (shown as Write), Matter “[[Nowhere]]” (shown in the Inbox)
			  MTM/Actions/Mystery.md
			"
		`);
		const json = JSON.parse((await mtm(['show', 'Confirm the worktop measurements', '--json', '--vault', root])).stdout) as Record<string, unknown>;
		expect(json).toMatchObject({
			details: 'Confirm the worktop measurements before ordering.',
			checklist: [
				{ text: 'Ask for the revised quote', checked: false },
				{ text: 'Measure the wall', checked: true },
			],
			// Marco isn't among its people, so his note is a linked note like any other.
			linkedNotes: [
				{ path: 'Notes/Some note.md', name: 'Some note' },
				{ path: 'MTM/People/Marco Rossi.md', name: 'Marco Rossi' },
			],
		});
	});

	it('parse writes nothing and names what matched nothing', async () => {
		const root = keep(syntheticVault());
		const before = hashes(root);
		const r = await mtm(['parse', 'Call Marco about the tiles /call #Kitchen @Marco @Zed fri 10:00 !1', '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"“Call Marco about the tiles”
			  Kitchen renovation · Later · Call · due Fri 16 Oct 10:00 · high priority
			  People: Marco Rossi
			  Read: /call, #Kitchen, @Marco, @Zed (matched nothing), fri 10:00, !1
			  No note matches “Zed”, so it is left out.
			"
		`);
		const json = JSON.parse((await mtm(['parse', 'Ring the bank tomorrow', '--json', '--vault', root])).stdout) as Record<string, unknown>;
		expect(json).toMatchObject({ title: 'Ring the bank', due: '2026-10-10', matter: { name: 'Inbox', isDefault: true } });
		expect(hashes(root)).toEqual(before);
	});

	it('today with nothing due shows what is next', async () => {
		const root = keep(syntheticVault({ without: ['MTM/Actions/Confirm the worktop measurements.md', 'MTM/Actions/Pay the council tax.md'] }));
		expect(normalise((await mtm(['today', '--vault', root])).stdout, root)).toMatchInlineSnapshot(`
			"What matters today?  Friday 9 October · <vault>

			Nothing due today. Next up:
			  ● Call  Call Marco about the quote   Kitchen renovation

			2 to sort in the Inbox · 1 review due · 1 long wait
			"
		`);
		const json = JSON.parse((await mtm(['today', '--json', '--vault', root])).stdout) as { date: string; due: unknown[]; nextStatus: { id: string } };
		expect(json).toMatchObject({ date: '2026-10-09', due: [], nextStatus: { id: 'next' } });
	});
});

describe('writing', () => {
	it('add writes the note, and show reads it back', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['add', 'Order the sink', '--matter', 'Kitchen', '--type', 'buy', '--due', '2026-10-20', '--waiting-on', 'Marco', '--checklist', 'Pick a size', '--vault', root], writer);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Added “Order the sink”
			  Kitchen renovation · Later · Buy · due Tue 20 Oct · waiting on Marco Rossi
			  MTM/Actions/Order the sink.md
			"
		`);
		expect(read(root, 'MTM/Actions/Order the sink.md')).toContain('mtm-matter: "[[Kitchen renovation]]"');
		const shown = await mtm(['show', 'Order the sink', '--json', '--vault', root]);
		expect(JSON.parse(shown.stdout)).toMatchObject({ type: { id: 'buy' }, due: '2026-10-20', waitingOn: { name: 'Marco Rossi' }, checklist: [{ text: 'Pick a size', checked: false }] });
	});

	it('add --json reports the Action and every property', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['add', 'Ring the bank', '--json', '--vault', root], writer);
		const json = JSON.parse(r.stdout) as Record<string, unknown>;
		expect(json).toMatchObject({ changed: true, dryRun: false, written: true, warnings: [], links: [], danglingLinks: 0, action: { path: 'MTM/Actions/Ring the bank.md' } });
		expect(json.changes).toContainEqual({ kind: 'create', path: 'MTM/Actions/Ring the bank.md' });
	});

	it('done writes the status and the completion date; again, it says nothing changed', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['done', 'Send the invoice', '--vault', root], writer);
		expect(r).toMatchInlineSnapshot(`
			{
			  "code": 0,
			  "stderr": "",
			  "stdout": "“Send the invoice” marked as done
			  mtm-status     doing → done
			  mtm-completed  (none) → 2026-10-09
			  MTM/Actions/Send the invoice.md
			",
			}
		`);
		const note = read(root, 'MTM/Actions/Send the invoice.md');
		expect(note).toContain('mtm-status: done');
		expect(note).toContain('mtm-completed: 2026-10-09');
		const again = await mtm(['done', 'Send the invoice', '--vault', root], writer);
		expect(again).toEqual({ code: 0, stderr: '', stdout: '“Send the invoice” is already as asked. Nothing was changed.\n' });
	});

	it('reopen', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['reopen', 'Order the tiles', '--vault', root], writer)).stdout).toMatchInlineSnapshot(`
			"Reopened “Order the tiles”
			  mtm-status     done → later
			  mtm-completed  2026-10-01 → (none)
			  MTM/Actions/Order the tiles.md
			"
		`);
	});

	it('update changes fields, adds checklist items and removes values', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['update', 'Confirm the worktop measurements', '--status', 'doing', '--no-priority', '--checklist', 'Check the corners', '--vault', root], writer);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Changed “Confirm the worktop measurements”
			  mtm-status    next → doing
			  mtm-priority  1 → (none)
			  checklist     + Check the corners
			  MTM/Actions/Confirm the worktop measurements.md
			"
		`);
		expect(read(root, 'MTM/Actions/Confirm the worktop measurements.md')).toContain('- [ ] Check the corners');
	});

	it('add-matter', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['add-matter', 'Garden shed', '--sphere', 'Home', '--review-every', '2w', '--outcome', 'A dry place for the tools', '--vault', root], writer);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Added Matter “Garden shed”
			  Home · active · review every 2 weeks
			  A dry place for the tools
			  MTM/Matters/Garden shed.md
			"
		`);
		expect(existsSync(join(root, 'MTM/Matters/Garden shed.md'))).toBe(true);
		const json = JSON.parse((await mtm(['add-matter', 'Boat', '--sphere', 'Sea', '--json', '--dry-run', '--vault', root], writer)).stdout) as Record<string, unknown>;
		expect(json).toMatchObject({ matter: { name: 'Boat', sphere: null }, dryRun: true, written: false, warnings: [{ code: 'unmatched-sphere' }] });
	});

	it('--dry-run leaves every file as it was', async () => {
		const root = keep(syntheticVault());
		const before = hashes(root);
		for (const argv of [
			['add', 'Ring the bank tomorrow #Kitchen'],
			['update', 'Send the invoice', '--title', 'Send the October invoice', '--due', 'fri'],
			['done', 'Send the invoice'],
			['reopen', 'Order the tiles'],
			['add-matter', 'Boat'],
		]) {
			const r = await mtm([...argv, '--dry-run', '--vault', root], writer);
			expect(r.code, argv.join(' ')).toBe(0);
			expect(r.stdout, argv.join(' ')).toContain('Nothing written (dry run).');
		}
		expect(hashes(root)).toEqual(before);
	});

	it('a dry run of an add', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['add', 'Ring the bank tomorrow !2', '--dry-run', '--vault', root], writer)).stdout).toMatchInlineSnapshot(`
			"Would add “Ring the bank”
			  Inbox · Later · Write · due tomorrow · medium priority
			  MTM/Actions/Ring the bank.md
			Nothing written (dry run).
			"
		`);
	});

	it('--plan-out writes the plan for other tools, dry run or not', async () => {
		const root = keep(syntheticVault());
		const out = join(tempDir(), 'plan.json');
		made.push(dirname(out));
		const r = await mtm(['done', 'Send the invoice', '--dry-run', '--plan-out', out, '--vault', root], writer);
		expect(r.code).toBe(0);
		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
			creates: [],
			edits: [{ path: 'MTM/Actions/Send the invoice.md', set: { 'mtm-status': 'done', 'mtm-type': 'write', 'mtm-matter': '[[Advisory work]]', 'mtm-completed': '2026-10-09' }, remove: [] }],
			bodies: [],
			renames: [],
		});
	});
});

describe('a file that changes while writing', () => {
	/** A writer that edits the note on disk after reading it, as another program would, the first `times` times. */
	const racing = (root: string, times: number): ContentsAfter => {
		let n = 0;
		return (plan, reader, options) => {
			const outcome = contentsAfter(plan, reader, options);
			if (n++ < times) writeFiles(root, { 'MTM/Actions/Send the invoice.md': `${read(root, 'MTM/Actions/Send the invoice.md')}Edited elsewhere.\n` });
			return outcome;
		};
	};

	it('is planned again once', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['done', 'Send the invoice', '--vault', root], { contentsAfter: racing(root, 1) });
		expect(r.code).toBe(0);
		const note = read(root, 'MTM/Actions/Send the invoice.md');
		expect(note).toContain('mtm-status: done');
		expect(note).toContain('Edited elsewhere.');
	});

	it('changing twice gives exit code 3, nothing written, the other program’s edit kept', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['done', 'Send the invoice', '--vault', root], { contentsAfter: racing(root, 2) });
		expect(r).toEqual({
			code: 3,
			stdout: '',
			stderr: 'MTM/Actions/Send the invoice.md changed just as it was about to be written, twice. Nothing was written; try again.\n',
		});
		const note = read(root, 'MTM/Actions/Send the invoice.md');
		expect(note).toContain('mtm-status: doing');
		expect(note).toContain('Edited elsewhere.\nEdited elsewhere.\n');
		const json = await mtm(['done', 'Send the invoice', '--json', '--vault', root], { contentsAfter: racing(root, 2) });
		expect(json.code).toBe(3);
		expect(JSON.parse(json.stdout)).toMatchObject({ error: { code: 'changed', path: 'MTM/Actions/Send the invoice.md' } });
	});
});

describe('open', () => {
	const opener = () => {
		const urls: string[] = [];
		return { urls, opener: (url: string) => (urls.push(url), Promise.resolve()) };
	};

	it('opens an Action by its file, a Matter by its path', async () => {
		const root = keep(syntheticVault());
		const o = opener();
		const r = await mtm(['open', 'Send the invoice', '--vault', root], { opener: o.opener });
		expect(r).toEqual({
			code: 0,
			stderr: '',
			stdout: 'Opening “Send the invoice” in Obsidian.\n  obsidian://mtm-open?vault=Notes&file=MTM%2FActions%2FSend%20the%20invoice.md\n',
		});
		await mtm(['open', 'Kitchen renovation', '--vault', root], { opener: o.opener });
		expect(o.urls).toEqual([
			'obsidian://mtm-open?vault=Notes&file=MTM%2FActions%2FSend%20the%20invoice.md',
			'obsidian://mtm-open?vault=Notes&matter=MTM%2FMatters%2FKitchen%20renovation.md',
		]);
		const json = JSON.parse((await mtm(['open', 'Garden', '--json', '--vault', root], { opener: o.opener })).stdout) as Record<string, unknown>;
		expect(json).toEqual({ url: 'obsidian://mtm-open?vault=Notes&matter=MTM%2FMatters%2FGarden.md', opened: true, matter: 'MTM/Matters/Garden.md' });
	});

	it('names nothing it can’t find, lists what is ambiguous, and says when the system can’t open the link', async () => {
		const root = keep(syntheticVault());
		const o = opener();
		expect(await mtm(['open', 'Nothing like it', '--vault', root], { opener: o.opener })).toEqual({ code: 1, stdout: '', stderr: 'No Action or Matter matches “Nothing like it”.\n' });
		expect((await mtm(['open', 'Call Marco', '--vault', root], { opener: o.opener })).code).toBe(1);
		expect(o.urls).toEqual([]);
		const failing = await mtm(['open', 'Garden', '--vault', root], { opener: () => Promise.reject(new Error('no opener')) });
		expect(failing).toEqual({
			code: 1,
			stdout: '',
			stderr: 'The system couldn’t open the link. Open it yourself: obsidian://mtm-open?vault=Notes&matter=MTM%2FMatters%2FGarden.md\n',
		});
	});
});

describe('warnings', () => {
	it('a dry run says what would happen, not what happened', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['add', 'Ask about the gym #Gym @Zed', '--dry-run', '--vault', root]);
		expect(r).toEqual({
			code: 0,
			stderr: '',
			stdout: `Would add “Ask about the gym”
  Inbox · Later · Write
  No Matter matches “Gym”, so it would go to the Inbox.
  No note matches “Zed”, so it would be left out.
  MTM/Actions/Ask about the gym.md
Nothing written (dry run).
`,
		});
		const json = JSON.parse((await mtm(['add', 'Water the plants', '--matter', 'Garden shed', '--dry-run', '--json', '--vault', root])).stdout) as { warnings: { message: string }[] };
		expect(json.warnings.map((w) => w.message)).toEqual(['No Matter matches “Garden shed”, so it would go to the Inbox.']);
		// Adding for real keeps the wording of something done.
		expect((await mtm(['add', 'Ask about the gym #Gym', '--vault', root])).stdout).toContain('so it went to the Inbox.');
	});

	it('rewords every fallback the operations word as done', () => {
		const T = STRINGS.ops;
		for (const done of [T.noMatter('X'), T.noMatter('X', true, 'Kitchen renovation'), T.noPerson('X'), T.leftOut('X')]) {
			const would = dryRunWording(done);
			expect(would, done).not.toBe(done);
			expect(would, done).not.toMatch(/\b(went|was)\b/);
			expect(would, done).toMatch(/\bwould\b/);
		}
		// Fallbacks worded in the present stay as they are.
		expect(dryRunWording(T.noType('fax', 'Write'))).toBe(T.noType('fax', 'Write'));
	});

	it('the same unknown person as waiting on and among the people warns once', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['add', 'Dinner', '--waiting-on', 'Zed', '--people', 'Zed', '--people', 'Lucía', '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout.match(/No note matches “Zed”/g)).toHaveLength(1);
		const json = JSON.parse((await mtm(['add', 'Supper', '--waiting-on', 'Zed', '--people', 'Zed', '--json', '--vault', root])).stdout) as { warnings: { code: string; field: string }[] };
		expect(json.warnings).toEqual([{ code: 'unmatched-person', field: 'people', value: 'Zed', message: 'No note matches “Zed”, so it was left out.' }]);
	});
});

describe('open --dry-run', () => {
	it('prints the link it would open and never opens it', async () => {
		const root = keep(syntheticVault());
		const urls: string[] = [];
		const opener = (url: string) => (urls.push(url), Promise.resolve());
		const r = await mtm(['open', 'Send the invoice', '--dry-run', '--vault', root], { opener });
		expect(r).toEqual({
			code: 0,
			stderr: '',
			stdout: 'Would open “Send the invoice” in Obsidian (dry run).\n  obsidian://mtm-open?vault=Notes&file=MTM%2FActions%2FSend%20the%20invoice.md\n',
		});
		const json = JSON.parse((await mtm(['open', 'Garden', '--dry-run', '--json', '--vault', root], { opener })).stdout) as Record<string, unknown>;
		expect(json).toEqual({ url: 'obsidian://mtm-open?vault=Notes&matter=MTM%2FMatters%2FGarden.md', opened: false, matter: 'MTM/Matters/Garden.md' });
		expect(urls).toEqual([]);
	});
});
