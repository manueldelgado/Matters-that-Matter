// The command line at the edges: words that start with a dash, words where none are taken, empty values, opening a
// Matter whose name starts an Action's title, full paths, refusals a dry run gives too, locked notes, races between
// new notes, creation dates kept, names in another Unicode form and tables cut to the terminal.

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { applyOutcome, nodeFs, type ApplyFs } from '../../cli/src/apply';
import { parseArgs } from '../../cli/src/args';
import { contentsAfter, WriteError, type ContentsAfter } from '../../cli/src/filesLayer';
import { takeLock } from '../../cli/src/locks';
import { CLI } from '../../cli/src/strings';
import { openVault } from '../../cli/src/vault';
import { planAndWrite } from '../../cli/src/writeFlow';
import { addAction, updateAction } from '../../src/ops';
import { hashes, mtm, read, syntheticVault, tempDir } from './helpers';

const made: string[] = [];
const cleanups: (() => void)[] = [];
const keep = (root: string) => (made.push(dirname(root)), root);
afterEach(() => {
	for (const undo of cleanups.splice(0)) undo();
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const darwin = process.platform === 'darwin';

describe('arguments', () => {
	it.each([
		[['add', '-5 degrees outside'], ['-5 degrees outside']],
		[['add', '- ask Marco'], ['- ask Marco']],
		[['add', 'x', '-1'], ['x', '-1']],
	])('a dash before a figure or a space is a word: %j', (argv, words) => {
		expect(parseArgs(argv)).toMatchObject({ ok: true, args: { command: 'add', words } });
	});

	it('a value may start with “-- ” or a dash and a figure', () => {
		expect(parseArgs(['add', 'x', '--details', '-- see the notes', '--title', '-2 degrees'])).toMatchObject({
			ok: true,
			args: { flags: { details: '-- see the notes', title: '-2 degrees' } },
		});
	});

	it('a value that looks like an option asks for --flag=value; a known option only says the value is missing', () => {
		expect(parseArgs(['add', 'x', '--details', '--verbose stuff'])).toEqual({ ok: false, message: CLI.needsValue('details', '--verbose stuff') });
		expect(CLI.needsValue('details', '--verbose stuff')).toBe('--details needs a value. For a value that starts with a dash, write --details="--verbose stuff".');
		expect(parseArgs(['add', 'x', '--details', '--dry-run'])).toEqual({ ok: false, message: '--details needs a value.' });
		expect(parseArgs(['add', 'x', '--details', '--no-due'])).toEqual({ ok: false, message: '--details needs a value.' });
		expect(parseArgs(['add', 'x', '--details=--verbose stuff'])).toMatchObject({ ok: true, args: { flags: { details: '--verbose stuff' } } });
	});

	it('add --help says how to start a title with a dash, and its --title isn’t update’s', async () => {
		const help = (await mtm(['add', '--help'])).stdout;
		expect(help).toContain('Text that starts with a dash and a letter goes after --');
		expect(help).toContain('--title <text>        the title, instead of the text’s');
		expect(help).not.toContain('renames');
		expect((await mtm(['update', '--help'])).stdout).toContain('a new title; the note is renamed');
	});

	it('the help lists --config-dir and --version, and so does mcp’s', async () => {
		expect((await mtm(['--help'])).stdout).toMatch(/--config-dir <dir>[\s\S]*--version, -V/);
		expect((await mtm(['mcp', '--help'])).stdout).toContain('--config-dir <dir>');
	});
});

describe('words where none are taken', () => {
	it('list suggests --matter', async () => {
		const root = keep(syntheticVault());
		expect(await mtm(['list', 'Kitchen', '--vault', root])).toEqual({ code: 1, stdout: '', stderr: '“list” takes no words. For the Actions of a Matter, use --matter "Kitchen".\n' });
	});

	it.each(['today', 'workflow', 'matters'])('%s refuses them', async (command) => {
		const root = keep(syntheticVault());
		const r = await mtm([command, 'extra', 'words', '--vault', root, '--json']);
		expect(r.code).toBe(1);
		expect(JSON.parse(r.stdout)).toEqual({ error: { code: 'usage', message: CLI.noWords(command, 'extra words') } });
	});

	it('so does mcp, before serving', async () => {
		const root = keep(syntheticVault());
		expect(await mtm(['mcp', 'extra', '--vault', root])).toEqual({ code: 1, stdout: '', stderr: `${CLI.noWords('mcp', 'extra')}\n` });
	});
});

describe('empty values on update', () => {
	it.each(['priority', 'start', 'due', 'waiting-on'])('--%s "" is refused and nothing is written', async (flag) => {
		const root = keep(syntheticVault());
		const before = hashes(root);
		const r = await mtm(['update', 'Revised quote from Marco', `--${flag}`, ' ', '--vault', root]);
		expect(r).toEqual({ code: 1, stdout: '', stderr: `--${flag} can’t be empty: give a value, or remove it with --no-${flag}.\n` });
		expect(hashes(root)).toEqual(before);
	});

	it('--details "" is refused too; --no-details removes them', async () => {
		const root = keep(syntheticVault());
		const note = 'MTM/Actions/Confirm the worktop measurements.md';
		expect(await mtm(['update', 'Confirm the worktop measurements', '--status', 'doing', '--details', '', '--vault', root])).toEqual({
			code: 1,
			stdout: '',
			stderr: '--details can’t be empty: give a value, or remove it with --no-details.\n',
		});
		expect(read(root, note)).toContain('Confirm the worktop measurements before ordering.');
		const r = await mtm(['update', 'Confirm the worktop measurements', '--no-details', '--vault', root]);
		expect(r.stdout).toContain('details  “Confirm the worktop measurements before orderin…” → (none)');
		expect(read(root, note)).not.toContain('before ordering');
		expect(read(root, note)).toContain('- [ ] Ask for the revised quote');
	});

	it('an empty list filter says to leave it out', async () => {
		const root = keep(syntheticVault());
		expect(await mtm(['list', '--due-from', '', '--vault', root])).toMatchObject({ code: 1, stderr: '“due-from” is empty: give a value, or leave the filter out.\n' });
	});

	it('on add they are left out', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['add', 'Ring the bank', '--due', '', '--matter', '', '--link', '', '--vault', root]);
		expect(r).toMatchObject({ code: 0, stderr: '' });
		expect(r.stdout).toBe('Added “Ring the bank”\n  Inbox · Later · Write\n  MTM/Actions/Ring the bank.md\n');
	});
});

describe('open', () => {
	const vaultWith = (title: string) =>
		keep(syntheticVault({ extra: { [`MTM/Actions/${title}.md`]: { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'call', 'mtm-status': 'later', 'mtm-matter': '[[Kitchen renovation]]' } } } }));

	it('a Matter named exactly, even when an Action’s title starts with its name', async () => {
		const root = vaultWith('Kitchen renovation budget');
		for (const ref of ['Kitchen renovation', '[[Kitchen renovation]]', 'MTM/Matters/Kitchen renovation.md']) {
			const r = await mtm(['open', ref, '--dry-run', '--json', '--vault', root]);
			expect(JSON.parse(r.stdout), ref).toMatchObject({ matter: 'MTM/Matters/Kitchen renovation.md', opened: false });
		}
	});

	it('loose matches of both kinds are listed', async () => {
		const root = vaultWith('Kitchen sink');
		const r = await mtm(['open', 'Kitchen', '--dry-run', '--vault', root]);
		expect(r.code).toBe(1);
		expect(r.stderr).toBe('Several Actions and Matters match “Kitchen”:\n  MTM/Actions/Kitchen sink.md\n  MTM/Matters/Kitchen renovation.md\nUse the path, or more of the title.\n');
	});

	it('several Matters only: the JSON names the field matter', async () => {
		const root = keep(syntheticVault({ extra: { 'MTM/Matters/Kitchen garden.md': { frontmatter: { 'mtm-kind': 'matter', 'mtm-state': 'active' } } } }));
		const r = await mtm(['open', 'Kitchen', '--dry-run', '--json', '--vault', root]);
		expect(JSON.parse(r.stdout)).toMatchObject({ error: { code: 'ambiguous', field: 'matter', candidates: ['MTM/Matters/Kitchen garden.md', 'MTM/Matters/Kitchen renovation.md'] } });
	});

	it('with nothing named, asks for an Action or a Matter', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['open', '--dry-run', '--vault', root])).stderr).toBe('Name the Action or Matter: its title, name or path.\n');
	});
});

describe('full paths', () => {
	it('name an Action, and a Matter in --matter', async () => {
		const root = keep(syntheticVault());
		const full = join(root, 'MTM', 'Actions', 'Send the invoice.md');
		expect((await mtm(['show', full, '--vault', root])).stdout).toMatch(/^Send the invoice\n/);
		const r = await mtm(['list', '--matter', join(root, 'MTM', 'Matters', 'Advisory work.md'), '--json', '--vault', root]);
		expect((JSON.parse(r.stdout) as { title: string }[]).map((a) => a.title)).toEqual(['Send the invoice']);
	});

	it('a full path outside the vault is only a name', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['show', '/elsewhere/Send the invoice.md', '--vault', root])).stderr).toBe('No Action matches “/elsewhere/Send the invoice.md”.\n');
	});
});

describe('show', () => {
	it('names the attachments', async () => {
		const root = keep(
			syntheticVault({ extra: { 'MTM/Actions/Plans.md': { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'later', 'mtm-matter': '[[Inbox]]' }, body: '![[Floor plan.svg]]\n' } } }),
		);
		mkdirSync(join(root, 'Files'));
		execFileSync('cp', [join(root, 'MTM', 'Actions', 'Plans.md'), join(root, 'Files', 'Floor plan.svg')]);
		const r = await mtm(['show', 'Plans', '--vault', root]);
		expect(r.stdout).toContain('\n\n  Attachments: Floor plan.svg\n');
		expect((JSON.parse((await mtm(['show', 'Plans', '--json', '--vault', root])).stdout) as { attachments: unknown }).attachments).toEqual([{ path: 'Files/Floor plan.svg', name: 'Floor plan.svg' }]);
	});
});

describe('what a dry run says', () => {
	it('done, reopen and update name the Action with their verb', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['reopen', 'Order the tiles', '--dry-run', '--vault', root])).stdout.split('\n')[0]).toBe('Would reopen “Order the tiles”');
		expect((await mtm(['update', 'Send the invoice', '--priority', '2', '--dry-run', '--vault', root])).stdout.split('\n')[0]).toBe('Would change “Send the invoice”');
		expect((await mtm(['done', 'Send the invoice', '--dry-run', '--vault', root])).stdout.split('\n')[0]).toBe('Would mark “Send the invoice” as done');
	});

	it('a folder linked to somewhere outside the vault is refused, as the write would be', async () => {
		const root = keep(syntheticVault());
		const outside = tempDir('mtm-outside-');
		made.push(outside);
		rmSync(join(root, 'MTM', 'Actions'), { recursive: true });
		symlinkSync(outside, join(root, 'MTM', 'Actions'));
		const dry = await mtm(['add', 'Through the link', '--dry-run', '--vault', root]);
		expect(dry).toEqual({ code: 3, stdout: '', stderr: 'MTM/Actions/Through the link.md is outside the vault, so nothing was written.\n' });
		expect(readdirSync(outside)).toEqual([]);
	});
});

describe('folders the system won’t let be written', () => {
	it('are refused before anything is written, in a dry run too', async () => {
		const root = keep(syntheticVault());
		const before = hashes(root);
		const fs: ApplyFs = { ...nodeFs, canWrite: (p) => !p.endsWith(join('MTM', 'Actions')) };
		const message = 'MTM/Actions is read-only, so nothing was written.\n';
		expect(await mtm(['add', 'Ring the bank', '--dry-run', '--vault', root], { fs })).toEqual({ code: 3, stdout: '', stderr: message });
		expect(await mtm(['add', 'Ring the bank', '--vault', root], { fs })).toEqual({ code: 3, stdout: '', stderr: message });
		expect(hashes(root)).toEqual(before);
	});

	it.runIf(darwin && process.getuid?.() !== 0)('a folder made read-only', async () => {
		const root = keep(syntheticVault());
		const folder = join(root, 'MTM', 'Actions');
		chmodSync(folder, 0o555);
		cleanups.push(() => chmodSync(folder, 0o755));
		expect((await mtm(['add', 'Ring the bank', '--dry-run', '--vault', root])).stderr).toBe('MTM/Actions is read-only, so nothing was written.\n');
	});
});

describe('notes the system won’t let be written', () => {
	it('count as read-only, in a dry run too', async () => {
		const root = keep(syntheticVault());
		const fs: ApplyFs = { ...nodeFs, canWrite: (p) => !p.endsWith('Send the invoice.md') };
		const message = 'MTM/Actions/Send the invoice.md is read-only, so nothing was written.\n';
		expect(await mtm(['done', 'Send the invoice', '--dry-run', '--vault', root], { fs })).toEqual({ code: 3, stdout: '', stderr: message });
		expect(await mtm(['done', 'Send the invoice', '--vault', root], { fs })).toEqual({ code: 3, stdout: '', stderr: message });
	});

	it('a refusal while replacing the note is said the same way, with everything put back', async () => {
		const root = keep(syntheticVault());
		const before = hashes(root);
		const fs: ApplyFs = {
			...nodeFs,
			rename: (a, b) => {
				if (b.endsWith('Send the invoice.md')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
				nodeFs.rename(a, b);
			},
		};
		expect(await mtm(['done', 'Send the invoice', '--vault', root], { fs })).toEqual({ code: 3, stdout: '', stderr: 'MTM/Actions/Send the invoice.md is read-only, so nothing was written.\n' });
		expect(hashes(root)).toEqual(before);
	});

	it.runIf(darwin)('a note locked in the Finder', async () => {
		const root = keep(syntheticVault());
		const note = join(root, 'MTM', 'Actions', 'Send the invoice.md');
		execFileSync('chflags', ['uchg', note]);
		cleanups.push(() => execFileSync('chflags', ['nouchg', note]));
		expect((await mtm(['done', 'Send the invoice', '--vault', root])).stderr).toBe('MTM/Actions/Send the invoice.md is read-only, so nothing was written.\n');
	});
});

describe('new notes that lose a race for their name', () => {
	const vaultOf = (root: string) => {
		const opened = openVault(root, undefined, root, root);
		if (!opened.ok) throw new Error(opened.message);
		return opened.vault;
	};
	/** The files layer's writer, finding the path taken the first `n` times. */
	const takenTimes = (n: number): ContentsAfter => {
		let calls = 0;
		return (plan, reader, options) => {
			if (calls++ < n) throw new WriteError('exists', plan.creates[0]?.path ?? plan.renames[0]?.to ?? '', 'taken');
			return contentsAfter(plan, reader, options);
		};
	};
	const now = new Date(2026, 9, 9, 12);

	it('are planned again a few times', () => {
		const root = keep(syntheticVault());
		const w = planAndWrite({ vault: vaultOf(root), now, dryRun: false, contentsAfter: takenTimes(7) }, (s) => addAction({ title: 'Race' }, s));
		expect(w).toMatchObject({ ok: true, written: true });
	});

	it('then say a note of that name appeared', () => {
		const root = keep(syntheticVault());
		const w = planAndWrite({ vault: vaultOf(root), now, dryRun: false, contentsAfter: takenTimes(8) }, (s) => addAction({ title: 'Race' }, s));
		expect(w).toMatchObject({ ok: false, kind: 'write', changed: true, error: { message: CLI.appeared('MTM/Actions/Race.md') } });
	});

	it('a name another run holds stops the write before anything is committed, and says so', () => {
		const root = keep(syntheticVault());
		writeFileSync(join(root, 'A.md'), 'a\n');
		const held = takeLock(nodeFs, join(root, 'New.md'));
		if (!held) throw new Error('expected the lock');
		const r = applyOutcome(root, {
			files: [
				{ path: 'A.md', from: 'A.md', before: 'a\n', after: 'changed\n' },
				{ path: 'New.md', from: null, before: null, after: 'x\n' },
			],
		});
		expect(r).toEqual({ ok: false, reason: 'changed', path: 'New.md', held: true });
		expect(readFileSync(join(root, 'A.md'), 'utf8')).toBe('a\n');
		expect(existsSync(join(root, 'New.md'))).toBe(false);
		// The other run's lock is left alone; nothing else is left.
		expect(readdirSync(root).filter((n) => n.startsWith('.mtm'))).toEqual([basename(held.path)]);
		const w = planAndWrite({ vault: vaultOf(root), now, dryRun: false }, (s) => addAction({ title: 'Held' }, s));
		expect(w).toMatchObject({ ok: true });
		const lock = takeLock(nodeFs, join(root, 'MTM', 'Actions', 'Held 2.md'));
		expect(lock).not.toBeNull();
		const blocked = planAndWrite({ vault: vaultOf(root), now, dryRun: false }, (s) => addAction({ title: 'Held' }, s));
		expect(blocked).toMatchObject({ ok: false, kind: 'write', changed: true, error: { code: 'changed', message: CLI.held('MTM/Actions/Held 2.md') } });
	});

	it('a rename onto a name another run holds commits none of its link updates', () => {
		const root = keep(syntheticVault({ extra: { 'Notes/Links.md': { body: '[[Send the invoice]]\n' } } }));
		const before = hashes(root);
		const lock = takeLock(nodeFs, join(root, 'MTM', 'Actions', 'Renamed.md'));
		expect(lock).not.toBeNull();
		const renames: string[] = [];
		const fs: ApplyFs = { ...nodeFs, rename: (a, b) => (renames.push(b), nodeFs.rename(a, b)) };
		const w = planAndWrite({ vault: vaultOf(root), now, dryRun: false, fs }, (s) => updateAction({ action: 'Send the invoice', title: 'Renamed' }, s));
		expect(w).toMatchObject({ ok: false, error: { message: CLI.held('MTM/Actions/Renamed.md') } });
		expect(renames.filter((p) => !p.endsWith('.tmp'))).toEqual([]);
		const { [`MTM/Actions/${basename(lock?.path ?? '')}`]: _lock, ...after } = hashes(root);
		expect(after).toEqual(before);
	});

	it('a path taken on every attempt though the vault has it free says the file system counts it as the same name', () => {
		const root = keep(syntheticVault());
		const fs: ApplyFs = { ...nodeFs, stat: (p) => (p.endsWith('Phantom.md') ? { dev: 1n, ino: 1n, mode: 0o644 } : nodeFs.stat(p)) };
		const w = planAndWrite({ vault: vaultOf(root), now, dryRun: false, fs }, (s) => addAction({ title: 'Phantom' }, s));
		expect(w).toMatchObject({ ok: false, kind: 'write', changed: true, error: { code: 'exists', message: CLI.sameName('MTM/Actions/Phantom.md') } });
	});

	it('changes to notes that exist are planned again once only', () => {
		const root = keep(syntheticVault());
		const w = planAndWrite({ vault: vaultOf(root), now, dryRun: false, contentsAfter: takenTimes(2) }, (s) => updateAction({ action: 'Send the invoice', title: 'Race' }, s));
		expect(w).toMatchObject({ ok: false, kind: 'write', changed: true });
	});
});

describe('names the file system counts as one', () => {
	it.each([
		['Straße', 'STRASSE'],
		['ﬁle', 'file'],
	])('%s, then %s, takes the next free name', async (first, second) => {
		const root = keep(syntheticVault());
		expect((await mtm(['add', '--title', first, '--vault', root])).code).toBe(0);
		const r = await mtm(['add', '--title', second, '--vault', root]);
		expect(r).toMatchObject({ code: 0, stderr: '' });
		expect(r.stdout).toContain(`MTM/Actions/${second} 2.md`);
	});
});

describe('names in another Unicode form', () => {
	it('an accented title that exists in the other form takes the next free name', async () => {
		const root = keep(syntheticVault());
		const nfd = 'Résumé review'.normalize('NFD');
		const nfc = 'Résumé review'.normalize('NFC');
		expect((await mtm(['add', '--title', nfd, '--vault', root])).code).toBe(0);
		const r = await mtm(['add', '--title', nfc, '--vault', root]);
		expect(r).toMatchObject({ code: 0, stderr: '' });
		expect(r.stdout).toContain(`MTM/Actions/${nfc} 2.md`);
	});
});

describe.runIf(darwin)('the creation date', () => {
	it('is kept when a note is written', async () => {
		const root = keep(syntheticVault());
		const note = join(root, 'MTM', 'Actions', 'Send the invoice.md');
		// An earlier modification time moves the creation time back with it.
		const old = new Date(2026, 0, 2, 3, 4, 5);
		utimesSync(note, old, old);
		utimesSync(note, new Date(), new Date());
		const born = statSync(note).birthtimeMs;
		expect(born).toBe(old.getTime());
		expect((await mtm(['update', 'Send the invoice', '--priority', '1', '--vault', root])).code).toBe(0);
		expect(read(root, 'MTM/Actions/Send the invoice.md')).toContain('mtm-priority: 1');
		const after = statSync(note);
		expect(after.birthtimeMs).toBe(born);
		expect(after.mtimeMs).toBeGreaterThan(born);
	});
});

describe('tables in a terminal', () => {
	const long = 'Write the long letter to the council about the hedge, the wall, the gate and the bins, in full';

	it('cut the title to the terminal’s width', async () => {
		const root = keep(
			syntheticVault({ extra: { [`MTM/Actions/${long}.md`]: { frontmatter: { 'mtm-kind': 'action', 'mtm-type': 'write', 'mtm-status': 'next', 'mtm-matter': '[[Advisory work]]' } } } }),
		);
		const cut = await mtm(['list', '--vault', root], { tty: true, columns: 80, env: { NO_COLOR: '1' } });
		const rows = cut.stdout.split('\n');
		const row = rows.find((l) => l.includes('Write the long letter'));
		expect(row).toMatch(/…\s+Next$/);
		expect([...(row ?? '')].length).toBeLessThanOrEqual(80);
		// Only rows with notes after the priority (waiting on someone, values not recognised) may wrap.
		expect(rows.filter((l) => [...l].length > 80).every((l) => /Not recognised|waiting on/.test(l))).toBe(true);
		expect(cut.stdout).toContain('Confirm the worktop measurements');
		// Not in a terminal: whole titles, for other programs.
		expect((await mtm(['list', '--vault', root], { columns: 80 })).stdout).toContain(long);
	});
});
