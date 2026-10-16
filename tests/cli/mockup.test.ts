// The command line's output against the documented examples: help, today, adding, strict updates, ambiguity, dry
// runs, renames and JSON. Plain text (no terminal, so no colour); the vault's folder shows as `<vault>`.

import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixtureCopy, mtm, normalise, syntheticVault } from './helpers';

const made: string[] = [];
const vault = (root: string) => (made.push(dirname(root)), root);
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HELP = `Matters that Matter, from the command line.            matters-that-matter 0.4.0

  matters-that-matter <command> [options]

  today                    What matters today?
  add <text> [fields]      Add an Action (quick add’s words work)
  update <action> [fields] Change an Action
  done <action>            Mark as done
  reopen <action>          Reopen a done Action
  show <action>            Everything about one Action
  list [filters]           Actions, done hidden
  add-matter <name>        New Matter
  matters                  Matters in board order
  workflow                 Statuses, types and Spheres
  parse <text>             What quick add would make of it
  open <action|matter>     Open it in Obsidian
  mcp                      Run as an MCP server (stdio)

  --vault <path>        the vault (or MTM_VAULT)
  --config-dir <dir>    its configuration folder, when not found by itself
  --json                for scripts
  --dry-run             show what would change
  --help, -h            this, or one command’s: matters-that-matter <command> --help
  --version, -V         the version
`;

describe('help', () => {
	it('prints the help, word for word', async () => {
		const r = await mtm(['--help']);
		expect(r).toEqual({ code: 0, stdout: HELP, stderr: '' });
	});

	it('prints it with no command too, and needs no vault', async () => {
		expect((await mtm([])).stdout).toBe(HELP);
	});

	it('prints the version', async () => {
		expect(await mtm(['--version'])).toEqual({ code: 0, stdout: 'matters-that-matter 0.4.0\n', stderr: '' });
	});

	it('has help for each command', async () => {
		const r = await mtm(['add', '--help']);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain('matters-that-matter add <text> [fields]');
		expect(r.stdout).toContain('--waiting-on <name>');
	});
});

describe('today', () => {
	it('lists what is due today or late, in the plugin’s words, then the Inbox, reviews and long waits', async () => {
		const root = vault(fixtureCopy());
		const r = await mtm(['today', '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe('');
		expect(normalise(r.stdout, root)).toBe(`What matters today?  Friday 9 October · <vault>

Due today or late
  ● Buy      Pay the council tax                     Household admin            Yesterday    high
  ● Call     Confirm the worktop measurements        Kitchen renovation         Today 10:00  high
  ● Message  Answer Eve's question about the essay   Research methods course    Yesterday    medium
  ● Message  Reply to the new enquiry                Advisory practice          Today        medium
  ● Message  Data export from Bob                    Lakeside strategy review   Tue 6 Oct
  ● Visit    Visit the tile showroom                 Kitchen renovation         Wed 7 Oct

7 to sort in the Inbox · 3 reviews due · 2 long waits
`);
	});

	it('shows the vault under the home folder as ~', async () => {
		const root = vault(fixtureCopy());
		const r = await mtm(['today', '--vault', root], { home: dirname(dirname(root)) });
		expect(r.stdout.split('\n')[0]).toMatch(/^What matters today\? {2}Friday 9 October · ~\/[^/]+\/mtm-fixture$/);
	});
});

describe('adding', () => {
	it('adds from quick add’s words', async () => {
		const root = vault(fixtureCopy());
		const r = await mtm(['add', 'Call Marco about the quote on fri 10:00 /call #Kitchen !1', '--vault', root]);
		expect(r).toEqual({
			code: 0,
			stderr: '',
			stdout: `Added “Call Marco about the quote on fri 10.00”
  Kitchen renovation · Later · Call · due Fri 16 Oct 10:00 · high priority
  MTM/Actions/Call Marco about the quote on fri 10.00.md
`,
		});
	});

	it('falls back as quick add does, and says why in a line', async () => {
		const root = vault(fixtureCopy());
		const r = await mtm(['add', 'Ask about the gym /message #Gym', '--vault', root]);
		expect(r.stdout).toBe(`Added “Ask about the gym”
  Inbox · Later · Message
  No Matter matches “Gym”, so it went to the Inbox.
  MTM/Actions/Ask about the gym.md
`);
	});
});

describe('strict updates and ambiguity', () => {
	it('refuses a status that matches nothing, and writes nothing', async () => {
		const root = vault(syntheticVault());
		const r = await mtm(['update', 'Call Marco about the quote', '--status', 'Someday', '--vault', root]);
		expect(r).toEqual({
			code: 1,
			stdout: '',
			stderr: `No status matches “Someday”. Statuses here: Later, Next, Doing, Waiting, Done.
Nothing was changed.
`,
		});
	});

	it('lists the Actions a name matches when it matches several', async () => {
		const root = vault(syntheticVault());
		const r = await mtm(['done', 'Call Marco', '--vault', root]);
		expect(r).toEqual({
			code: 1,
			stdout: '',
			stderr: `Several Actions match “Call Marco”:
  MTM/Actions/Call Marco about the quote.md
  MTM/Actions/Call Marco back.md
Use the path, or more of the title.
`,
		});
	});
});

describe('dry runs and renames', () => {
	it('shows what would change, property by property', async () => {
		// Without a position on a board ordered by hand (a move to another column would remove it, and say so).
		const quote = { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-status': 'next', 'mtm-matter': '[[Kitchen renovation]]' } };
		const root = vault(syntheticVault({ extra: { 'MTM/Actions/Call Marco about the quote.md': quote } }));
		const r = await mtm(['done', 'Call Marco about the quote', '--dry-run', '--vault', root]);
		expect(r).toEqual({
			code: 0,
			stderr: '',
			stdout: `Would mark “Call Marco about the quote” as done
  mtm-status     next → done
  mtm-completed  (none) → 2026-10-09
  MTM/Actions/Call Marco about the quote.md
Nothing written (dry run).
`,
		});
	});

	it('renames on a new title and lists the links it updated', async () => {
		// Two notes link to the Action: one link on line 7 of the first, two on lines 3 and 12 of the second.
		const lines = (at: Record<number, string>) => Array.from({ length: 12 }, (_, n) => at[n + 1] ?? `Line ${n + 1}.`).join('\n') + '\n';
		const root = vault(
			syntheticVault({
				extra: {
					'Notes/Kitchen plan.md': { body: lines({ 7: 'Ask: [[Call Marco about the quote]]' }) },
					'Daily/2026-10-08.md': { body: lines({ 3: '- [[Call Marco about the quote|Marco]]', 12: 'Then [[Call Marco about the quote#Notes]].' }) },
				},
			}),
		);
		const r = await mtm(['update', 'Call Marco about the quote', '--title', 'Call Marco about the revised quote', '--vault', root]);
		expect(r).toEqual({
			code: 0,
			stderr: '',
			stdout: `Renamed to “Call Marco about the revised quote”
  MTM/Actions/Call Marco about the revised quote.md
  Updated 3 links in 2 notes:
    Daily/2026-10-08.md        lines 3, 12
    Notes/Kitchen plan.md      line 7
`,
		});
	});
});

describe('JSON for scripts', () => {
	it('gives raw and effective values', async () => {
		const root = vault(syntheticVault());
		const r = await mtm(['list', '--matter', 'Kitchen', '--json', '--vault', root, '--now', '2026-10-09T09:00']);
		expect(r.code).toBe(0);
		const first = (JSON.parse(r.stdout) as Record<string, unknown>[])[0];
		expect(first).toMatchObject({
			path: 'MTM/Actions/Confirm the worktop measurements.md',
			title: 'Confirm the worktop measurements',
			matter: { path: 'MTM/Matters/Kitchen renovation.md', name: 'Kitchen renovation' },
			status: { id: 'next', label: 'Next', category: 'open' },
			type: { id: 'call', label: 'Call' },
			due: '2026-10-09T10:00',
			priority: 1,
			overdue: false,
			today: true,
			orphans: [],
			raw: { 'mtm-status': 'next' },
		});
	});
});
