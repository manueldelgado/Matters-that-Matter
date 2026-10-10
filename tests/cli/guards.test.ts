// When the vault isn't ready, bad input, colour, and the exit codes that say which.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nodeFs, type ApplyFs } from '../../cli/src/apply';
import { parseNow } from '../../cli/src/main';
import { CONFIG, hashes, mtm, SETTINGS_FILE, syntheticVault, tempDir, writeFiles } from './helpers';
import { tempContentsAfter } from './tempWriter';

const made: string[] = [];
const keep = (root: string) => (made.push(dirname(root)), root);
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const writer = { contentsAfter: tempContentsAfter };

describe('the vault isn’t ready: exit 2', () => {
	it('without a vault named', async () => {
		expect(await mtm(['today'])).toEqual({ code: 2, stdout: '', stderr: 'Name the vault with --vault <path>, or set MTM_VAULT.\n' });
	});

	it('takes MTM_VAULT when --vault isn’t given', async () => {
		const root = keep(syntheticVault());
		expect((await mtm(['workflow'], { env: { MTM_VAULT: root } })).code).toBe(0);
	});

	it('a folder that isn’t there', async () => {
		const r = await mtm(['today', '--vault', '/no/such/folder']);
		expect(r).toEqual({ code: 2, stdout: '', stderr: 'There’s no folder at /no/such/folder.\n' });
	});

	it('a folder that isn’t a vault', async () => {
		const root = keep(join(tempDir(), 'Plain'));
		mkdirSync(root);
		expect((await mtm(['today', '--vault', root])).stderr).toBe(`${root} isn’t an Obsidian vault: it has no .obsidian folder.\n`);
	});

	it('a vault without Matters’ settings', async () => {
		const root = keep(join(tempDir(), 'Bare'));
		mkdirSync(join(root, CONFIG), { recursive: true });
		const r = await mtm(['today', '--vault', root]);
		expect(r.code).toBe(2);
		expect(r.stderr).toBe(`Matters isn’t installed in ${root}: there’s no .obsidian/plugins/matters-that-matter/data.json. Install Matters and run setup in Obsidian first.\n`);
		const json = await mtm(['today', '--json', '--vault', root]);
		expect(json.code).toBe(2);
		expect(JSON.parse(json.stdout)).toMatchObject({ error: { code: 'not-ready' } });
	});

	it('settings that aren’t JSON', async () => {
		const root = keep(syntheticVault());
		writeFiles(root, { [SETTINGS_FILE]: '{ not json' });
		expect((await mtm(['today', '--vault', root])).code).toBe(2);
	});

	it.each(['../elsewhere', 'a/b', 'a\\b', '..', '.'])('--config-dir %j isn’t one folder', async (dir) => {
		const root = keep(syntheticVault());
		const r = await mtm(['workflow', '--config-dir', dir, '--vault', root]);
		expect(r).toEqual({ code: 2, stdout: '', stderr: `--config-dir names one folder in the vault, such as .obsidian; “${dir}” isn’t one.\n` });
	});

	it('another configuration folder, with --config-dir', async () => {
		const root = keep(syntheticVault());
		writeFiles(root, { '.config/plugins/matters-that-matter/data.json': JSON.stringify({ setupDone: true }) });
		expect((await mtm(['workflow', '--config-dir', '.config', '--vault', root])).code).toBe(0);
		expect((await mtm(['workflow', '--config-dir', '.nothing', '--vault', root])).code).toBe(2);
	});

	it('setup not done: reads work, with a hint; writes are refused', async () => {
		const root = keep(syntheticVault({ settings: { setupDone: false } }));
		const read = await mtm(['today', '--vault', root]);
		expect(read.code).toBe(0);
		expect(read.stderr).toBe('Matters isn’t set up in this vault yet. Run setup in Obsidian first.\n');
		const before = hashes(root);
		const r = await mtm(['add', 'Something', '--vault', root], writer);
		expect(r).toEqual({ code: 2, stdout: '', stderr: 'Matters isn’t set up in this vault yet. Run setup in Obsidian first.\n' });
		expect(hashes(root)).toEqual(before);
	});

	it('settings from a newer version: reads with a warning, writes refused', async () => {
		const root = keep(syntheticVault({ settings: { schemaVersion: 99 } }));
		const read = await mtm(['list', '--vault', root]);
		expect(read.code).toBe(0);
		expect(read.stdout).toContain('Send the invoice');
		expect(read.stderr).toBe('These settings come from a newer version of Matters; what you read may miss something new.\n');
		const before = hashes(root);
		const write = await mtm(['done', 'Send the invoice', '--vault', root], writer);
		expect(write).toEqual({ code: 2, stdout: '', stderr: 'These settings come from a newer version of Matters, so nothing is written. Update Matters first.\n' });
		expect(hashes(root)).toEqual(before);
	});
});

describe('nothing matched, several did, or the input can’t be read: exit 1', () => {
	it('an Action that isn’t there', async () => {
		const root = keep(syntheticVault());
		expect(await mtm(['show', 'Nothing like it', '--vault', root])).toEqual({ code: 1, stdout: '', stderr: 'No Action matches “Nothing like it”.\n' });
		expect(await mtm(['done', 'Nothing like it', '--vault', root], writer)).toEqual({
			code: 1,
			stdout: '',
			stderr: 'No Action matches “Nothing like it”.\nNothing was changed.\n',
		});
	});

	it('an ambiguous name, as JSON with its candidates', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['show', 'Call Marco', '--json', '--vault', root]);
		expect(r.code).toBe(1);
		expect(JSON.parse(r.stdout)).toEqual({
			error: {
				code: 'ambiguous',
				field: 'action',
				value: 'Call Marco',
				message: 'Several Actions match “Call Marco”.',
				candidates: ['MTM/Actions/Call Marco about the quote.md', 'MTM/Actions/Call Marco back.md'],
			},
		});
	});

	it('a value that can’t be read', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['update', 'Send the invoice', '--due', 'the day after never', '--vault', root], writer);
		expect(r).toEqual({
			code: 1,
			stdout: '',
			stderr: '“the day after never” isn’t a date Matters can read. Use 2026-10-16, 2026-10-16T10:00 or words such as “fri 10:00”.\nNothing was changed.\n',
		});
	});

	it('a filter that matches nothing', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['list', '--matter', 'Atlantis', '--vault', root]);
		expect(r).toEqual({ code: 1, stdout: '', stderr: 'No Matter matches “Atlantis”.\n' });
	});

	it('usage: an unknown command or option, a flag the command doesn’t take, a missing name', async () => {
		const root = keep(syntheticVault());
		expect(await mtm(['frobnicate'])).toEqual({ code: 1, stdout: '', stderr: 'There’s no command “frobnicate”. See mtm --help.\n' });
		expect(await mtm(['today', '--colour'])).toEqual({ code: 1, stdout: '', stderr: 'There’s no option --colour. See mtm --help.\n' });
		expect(await mtm(['today', '--due', 'fri'])).toEqual({ code: 1, stdout: '', stderr: 'mtm today doesn’t take --due. See mtm today --help.\n' });
		expect(await mtm(['done', '--vault', root])).toEqual({ code: 1, stdout: '', stderr: 'Name the Action: its path or its title.\n' });
		expect(await mtm(['today', '--vault', root, '--now', 'soon'])).toEqual({ code: 1, stdout: '', stderr: '“soon” isn’t a time. Use 2026-10-09 or 2026-10-09T12:00.\n' });
		expect(JSON.parse((await mtm(['today', '--json', '--vault'])).stdout)).toEqual({ error: { code: 'usage', message: '--vault needs a value.' } });
	});

	it('mtm help is --help', async () => {
		expect((await mtm(['help'])).stdout).toBe((await mtm(['--help'])).stdout);
		expect((await mtm(['help', 'list'])).stdout).toBe((await mtm(['list', '--help'])).stdout);
	});

	it('the MCP server isn’t in this version yet', async () => {
		expect(await mtm(['mcp'])).toEqual({ code: 1, stdout: '', stderr: 'The MCP server isn’t in this version of mtm yet.\n' });
	});
});

describe('colour', () => {
	const ESC = '\u001b[';

	it('on a terminal', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['today', '--vault', root], { tty: true });
		expect(r.stdout).toContain(`${ESC}1mWhat matters today?${ESC}22m`);
		expect(r.stdout).toContain(`${ESC}33mDue today or late${ESC}39m`);
		// The type's colour is on its dot; the type's name is always there too.
		expect(r.stdout).toContain(`${ESC}32m●${ESC}39m Call`);
	});

	it('never with NO_COLOR, nor when output isn’t a terminal; the words are the same', async () => {
		const root = keep(syntheticVault());
		const plain = await mtm(['today', '--vault', root]);
		const noColour = await mtm(['today', '--vault', root], { tty: true, env: { NO_COLOR: '1' } });
		expect(plain.stdout).not.toContain(ESC);
		expect(noColour.stdout).toBe(plain.stdout);
		const coloured = await mtm(['today', '--vault', root], { tty: true });
		const stripped = coloured.stdout
			.split('\u001b')
			.map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
			.join('');
		expect(stripped).toBe(plain.stdout);
	});

	it('errors on a terminal: the first sentence stands out', async () => {
		const root = keep(syntheticVault());
		const r = await mtm(['update', 'Send the invoice', '--status', 'Someday', '--vault', root], { tty: true, ...writer });
		expect(r.stderr.startsWith(`${ESC}31mNo status matches “Someday”.${ESC}39m Statuses here:`)).toBe(true);
	});
});

describe('a write that fails: exit 3, everything put back', () => {
	it('says what failed and that nothing was changed', async () => {
		const root = keep(syntheticVault());
		const before = hashes(root);
		const fs: ApplyFs = {
			...nodeFs,
			rename: (a, b) => {
				if (b.endsWith('Send the invoice.md')) throw new Error('disk full');
				nodeFs.rename(a, b);
			},
		};
		const r = await mtm(['done', 'Send the invoice', '--vault', root], { ...writer, fs });
		expect(r).toEqual({
			code: 3,
			stdout: '',
			stderr: 'Writing MTM/Actions/Send the invoice.md failed (disk full). Everything was put back as it was; nothing was changed.\n',
		});
		expect(hashes(root)).toEqual(before);
	});
});

describe('--now', () => {
	it('reads a day or a local time, and nothing else', () => {
		expect(parseNow('2026-10-09T12:00')).toEqual(new Date(2026, 9, 9, 12, 0));
		expect(parseNow('2026-10-09')).toEqual(new Date(2026, 9, 9));
		expect(parseNow('2026-02-30')).toBeNull();
		expect(parseNow('tomorrow')).toBeNull();
	});
});

describe('the vault’s files', () => {
	it('notes in the configuration folder, the trash and dot-folders aren’t read', async () => {
		const root = keep(syntheticVault());
		writeFileSync(join(root, '.obsidian', 'stray.md'), '---\nmtm-kind: action\n---\n');
		mkdirSync(join(root, '.trash'));
		writeFileSync(join(root, '.trash', 'Old.md'), '---\nmtm-kind: action\n---\n');
		const r = await mtm(['list', '--json', '--vault', root]);
		const paths = (JSON.parse(r.stdout) as { path: string }[]).map((a) => a.path);
		expect(paths.some((p) => p.startsWith('.'))).toBe(false);
	});
});
