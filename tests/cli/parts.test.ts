// The command line's parts: arguments, safe writes, the vault's file list, the open link, the package.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../../cli/src/args';
import { applyOutcome, keepStyle } from '../../cli/src/apply';
import { fsVaultReader } from '../../cli/src/fsVault';
import { openUrl } from '../../cli/src/open';
import { vaultPath } from '../../cli/src/vault';
import { PACKAGE_NAME, VERSION } from '../../cli/src/version';
import { tempDir, writeFiles } from './helpers';

const made: string[] = [];
const dir = () => {
	const d = tempDir();
	made.push(d);
	return d;
};
afterEach(() => {
	for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('arguments', () => {
	const ok = (argv: string[]) => {
		const r = parseArgs(argv);
		if (!r.ok) throw new Error(r.message);
		return r.args;
	};

	it('the command, its words and its flags, in any order', () => {
		expect(ok(['--vault', '~/Notes', 'add', 'Call', 'Marco', '--due=fri', '--json'])).toEqual({
			command: 'add',
			words: ['Call', 'Marco'],
			flags: { vault: '~/Notes', due: 'fri', json: true },
		});
	});

	it('list flags repeat; --no-<field> removes a value; -- ends the flags', () => {
		expect(ok(['update', 'X', '--people', 'Marco', '--people', 'Lucía', '--no-due', '--no-people', '--', '--literal']).flags).toEqual({ due: null, people: null });
		expect(ok(['add', '--checklist', 'a', '--checklist', 'b', '--', '-1 day']).words).toEqual(['-1 day']);
		expect(ok(['add', '--checklist', 'a', '--checklist', 'b']).flags).toEqual({ checklist: ['a', 'b'] });
	});

	it('-h and -V', () => {
		expect(ok(['-h']).flags).toEqual({ help: true });
		expect(ok(['-V']).flags).toEqual({ version: true });
	});

	it.each([
		[['nope'], 'There’s no command “nope”. See mtm --help.'],
		[['today', '--nope'], 'There’s no option --nope. See mtm --help.'],
		[['today', '-x'], 'There’s no option -x. See mtm --help.'],
		[['add', '--due'], '--due needs a value.'],
		[['add', '--due', '--json'], '--due needs a value.'],
		[['today', '--json=yes'], '--json takes no value.'],
		[['done', 'X', '--due', 'fri'], 'mtm done doesn’t take --due. See mtm done --help.'],
		[['add', '--no-title'], 'There’s no option --no-title. See mtm --help.'],
	])('%j is refused', (argv, message) => {
		expect(parseArgs(argv)).toEqual({ ok: false, message });
	});
});

describe('safe writes', () => {
	it('keeps CRLF line endings and the presence of a final newline', () => {
		expect(keepStyle('a\r\nb\r\n', 'a\nb\nc\n')).toBe('a\r\nb\r\nc\r\n');
		expect(keepStyle('a\nb', 'a\nb\nc\n')).toBe('a\nb\nc');
		expect(keepStyle('a\n', 'a\nb')).toBe('a\nb\n');
		expect(keepStyle(null, 'new\n')).toBe('new\n');
	});

	it('writes, renames and creates, leaving no temporary files', () => {
		const root = dir();
		writeFiles(root, { 'A/One.md': 'one\r\n', 'A/Two.md': 'two\n' });
		const r = applyOutcome(root, {
			files: [
				{ path: 'A/One.md', from: 'A/One.md', before: 'one\r\n', after: 'one changed\n' },
				{ path: 'B/Deux.md', from: 'A/Two.md', before: 'two\n', after: 'deux\n' },
				{ path: 'C/Three.md', from: null, before: null, after: 'three\n' },
			],
			links: [],
			danglingLinks: 0,
		});
		expect(r).toEqual({ ok: true, written: ['A/One.md', 'B/Deux.md', 'C/Three.md'] });
		expect(readFileSync(join(root, 'A/One.md'), 'utf8')).toBe('one changed\r\n');
		expect(existsSync(join(root, 'A/Two.md'))).toBe(false);
		expect(readFileSync(join(root, 'B/Deux.md'), 'utf8')).toBe('deux\n');
		expect(readFileSync(join(root, 'C/Three.md'), 'utf8')).toBe('three\n');
		for (const folder of ['A', 'B', 'C']) expect(readdirSync(join(root, folder)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
	});

	it('a rename that only changes case', () => {
		const root = dir();
		writeFiles(root, { 'call marco.md': 'x\n' });
		const r = applyOutcome(root, { files: [{ path: 'Call Marco.md', from: 'call marco.md', before: 'x\n', after: 'y\n' }], links: [], danglingLinks: 0 });
		expect(r.ok).toBe(true);
		expect(readdirSync(root)).toEqual(['Call Marco.md']);
		expect(readFileSync(join(root, 'Call Marco.md'), 'utf8')).toBe('y\n');
	});

	it('refuses, writing nothing, when a file changed since the plan was made or a new file’s path was taken', () => {
		const root = dir();
		writeFiles(root, { 'One.md': 'edited elsewhere\n', 'Taken.md': 'here\n' });
		const changed = applyOutcome(root, {
			files: [
				{ path: 'Two.md', from: null, before: null, after: 'two\n' },
				{ path: 'One.md', from: 'One.md', before: 'one\n', after: 'one changed\n' },
			],
			links: [],
			danglingLinks: 0,
		});
		expect(changed).toEqual({ ok: false, conflict: 'One.md', written: [] });
		expect(existsSync(join(root, 'Two.md'))).toBe(false);
		const taken = applyOutcome(root, { files: [{ path: 'Taken.md', from: null, before: null, after: 'mine\n' }], links: [], danglingLinks: 0 });
		expect(taken).toEqual({ ok: false, conflict: 'Taken.md', written: [] });
		expect(readFileSync(join(root, 'Taken.md'), 'utf8')).toBe('here\n');
	});
});

describe('the vault’s files', () => {
	it('lists every file but the configuration folder, the trash and dot-folders; reads any', () => {
		const root = dir();
		writeFiles(root, {
			'Note.md': 'n',
			'A/B/Deep.md': 'd',
			'A/picture.png': 'p',
			'.obsidian/app.json': '{}',
			'.trash/Old.md': 'o',
			'.git/HEAD': 'h',
			'A/.hidden/Secret.md': 's',
			'conf/app.json': '{}',
		});
		mkdirSync(join(root, 'Empty'));
		expect([...fsVaultReader(root, '.obsidian').list()].sort()).toEqual(['A/B/Deep.md', 'A/picture.png', 'Note.md', 'conf/app.json']);
		expect([...fsVaultReader(root, 'conf').list()].sort()).toEqual(['A/B/Deep.md', 'A/picture.png', 'Note.md']);
		const reader = fsVaultReader(root, '.obsidian');
		expect(reader.read('.obsidian/app.json')).toBe('{}');
		expect(reader.read('A/B/Deep.md')).toBe('d');
		expect(reader.read('Missing.md')).toBeNull();
	});

	it('vault paths: ~ for the home folder, relative to where it runs', () => {
		expect(vaultPath('~/Notes', '/work', '/home/me')).toBe('/home/me/Notes');
		expect(vaultPath('~', '/work', '/home/me')).toBe('/home/me');
		expect(vaultPath('Notes', '/work', '/home/me')).toBe('/work/Notes');
		expect(vaultPath('/abs/Notes/', '/work', '/home/me')).toBe('/abs/Notes');
	});
});

describe('the open link', () => {
	it('names an Action with file, as Obsidian’s own links do, a Matter with matter, a board with board', () => {
		expect(openUrl('My vault', { file: 'MTM/Actions/Call & ask.md' })).toBe('obsidian://mtm-open?vault=My%20vault&file=MTM%2FActions%2FCall%20%26%20ask.md');
		expect(openUrl('Notes', { matter: 'Kitchen renovation' })).toBe('obsidian://mtm-open?vault=Notes&matter=Kitchen%20renovation');
		expect(openUrl('Notes', { board: 'Matters' })).toBe('obsidian://mtm-open?vault=Notes&board=Matters');
	});
});

describe('the test run', () => {
	it('sorts in British English whatever the machine’s locale', () => {
		expect(new Intl.Collator().resolvedOptions().locale).toBe('en-GB');
	});
});

describe('the package', () => {
	const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'cli', 'package.json'), 'utf8')) as Record<string, unknown>;

	it('has the name and version the command line prints', () => {
		expect(pkg.name).toBe(PACKAGE_NAME);
		expect(pkg.version).toBe(VERSION);
	});

	it('ships one file, with no runtime dependencies', () => {
		expect(pkg).toMatchObject({ bin: { mtm: 'dist/mtm.mjs' }, type: 'module', files: ['dist'], engines: { node: '>=20' }, license: 'MIT' });
		expect(pkg.dependencies).toBeUndefined();
	});
});
