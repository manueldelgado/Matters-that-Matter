// The command line's parts: arguments, safe writes, the vault's file list, the open link, the package.

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../../cli/src/args';
import { applyOutcome, nodeFs, type ApplyFs, type FileWrite } from '../../cli/src/apply';
import { cachingReader, fsVaultReader } from '../../cli/src/fsVault';
import { obsidianSettingsDir, openUrl, systemOpener, vaultRef, type Spawner } from '../../cli/src/open';
import { isClosedPipe, quietOnClosedPipe } from '../../cli/src/pipes';
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
		[['nope'], 'There’s no command “nope”. See matters-that-matter --help.'],
		[['today', '--nope'], 'There’s no option --nope. See matters-that-matter --help.'],
		[['today', '-x'], 'There’s no option -x. See matters-that-matter --help.'],
		[['add', '--due'], '--due needs a value.'],
		[['add', '--due', '--json'], '--due needs a value.'],
		[['today', '--json=yes'], '--json takes no value.'],
		[['done', 'X', '--due', 'fri'], '“done” doesn’t take --due. See matters-that-matter done --help.'],
		[['add', '--no-title'], 'There’s no option --no-title. See matters-that-matter --help.'],
	])('%j is refused', (argv, message) => {
		expect(parseArgs(argv)).toEqual({ ok: false, message });
	});
});

describe('safe writes', () => {
	const outcome = (files: FileWrite[]) => ({ files });
	const temps = (root: string) => {
		const out: string[] = [];
		const walk = (d: string) => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				if (e.isDirectory()) walk(join(d, e.name));
				else if (e.name.endsWith('.tmp')) out.push(e.name);
			}
		};
		walk(root);
		return out;
	};
	/**
	 * Node's file operations, with the `nth` rename into place (not into a temporary file) failing. Committing three
	 * files (edit A, rename B to Moved/B2, create C) renames into place four times: A, B to B2, B2's content, C.
	 */
	const failingAt = (nth: number, extra: Partial<ApplyFs> = {}): ApplyFs => {
		let n = 0;
		const maybeFail = (to: string) => {
			if (!to.endsWith('.tmp') && ++n === nth) throw new Error('disk full');
		};
		return {
			...nodeFs,
			rename: (a, b) => (maybeFail(b), nodeFs.rename(a, b)),
			...extra,
		};
	};

	it('writes the bytes it is given, line endings and all', () => {
		const root = dir();
		writeFiles(root, { 'Mixed.md': 'a\r\nb\r\n' });
		const after = '---\nmtm-status: done\n---\r\na\r\nb';
		expect(applyOutcome(root, outcome([{ path: 'Mixed.md', from: 'Mixed.md', before: 'a\r\nb\r\n', after }])).ok).toBe(true);
		expect(readFileSync(join(root, 'Mixed.md'), 'utf8')).toBe(after);
	});

	it('writes, renames and creates, keeping each file’s mode and leaving no temporary files', () => {
		const root = dir();
		writeFiles(root, { 'A/One.md': 'one\r\n', 'A/Two.md': 'two\n' });
		chmodSync(join(root, 'A/One.md'), 0o640);
		const r = applyOutcome(
			root,
			outcome([
				{ path: 'A/One.md', from: 'A/One.md', before: 'one\r\n', after: 'one changed\n' },
				{ path: 'B/Deux.md', from: 'A/Two.md', before: 'two\n', after: 'deux\n' },
				{ path: 'C/Three.md', from: null, before: null, after: 'three\n' },
			]),
		);
		expect(r).toEqual({ ok: true, written: ['A/One.md', 'B/Deux.md', 'C/Three.md'] });
		expect(readFileSync(join(root, 'A/One.md'), 'utf8')).toBe('one changed\n');
		expect(statSync(join(root, 'A/One.md')).mode & 0o777).toBe(0o640);
		expect(existsSync(join(root, 'A/Two.md'))).toBe(false);
		expect(readFileSync(join(root, 'B/Deux.md'), 'utf8')).toBe('deux\n');
		expect(readFileSync(join(root, 'C/Three.md'), 'utf8')).toBe('three\n');
		expect(temps(root)).toEqual([]);
	});

	it('moves a renamed note with a rename, as Obsidian’s file watcher expects, never a link and an unlink', () => {
		const root = dir();
		writeFiles(root, { 'Old.md': 'x\n' });
		const calls: string[] = [];
		const rel = (p: string) => p.slice(root.length + 1).replace(/\.mtm-[^/]*\.tmp$/, '<temp>');
		const fs: ApplyFs = {
			...nodeFs,
			rename: (a, b) => (calls.push(`rename ${rel(a)} → ${rel(b)}`), nodeFs.rename(a, b)),
			unlink: (p) => (calls.push(`unlink ${rel(p)}`), nodeFs.unlink(p)),
		};
		const r = applyOutcome(root, outcome([{ path: 'New/Name.md', from: 'Old.md', before: 'x\n', after: 'y\n' }, { path: 'Made.md', from: null, before: null, after: 'z\n' }]), fs);
		expect(r.ok).toBe(true);
		// The hidden lock files that hold new names aside.
		expect(calls.filter((c) => !c.endsWith('.lock'))).toEqual(['rename Old.md → New/Name.md', 'rename New/<temp> → New/Name.md', 'rename <temp> → Made.md']);
		expect(calls.filter((c) => c.endsWith('.lock'))).toHaveLength(2);
		expect(readdirSync(root).sort()).toEqual(['Made.md', 'New']);
	});

	it('names temporary files briefly, without the note’s name, so a note with a long name can still be written', () => {
		const root = dir();
		// 250 bytes: the limit of many file systems is 255, which a temporary name repeating the note's would pass.
		const long = `${'a'.repeat(247)}.md`;
		writeFiles(root, { [long]: 'x\n' });
		const created: string[] = [];
		const fs: ApplyFs = { ...nodeFs, writeFile: (p, text) => (created.push(p.slice(root.length + 1)), nodeFs.writeFile(p, text)) };
		expect(applyOutcome(root, outcome([{ path: long, from: long, before: 'x\n', after: 'y\n' }]), fs).ok).toBe(true);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatch(/^\.mtm-\d+-[0-9a-z]+-[0-9a-f]{6}\.tmp$/);
		expect(Buffer.byteLength(created[0] ?? '')).toBeLessThan(40);
		// It starts with a dot, so reading the vault skips it, as Obsidian does.
		writeFiles(root, { [created[0] ?? '']: 'left behind' });
		expect(fsVaultReader(root, '.obsidian').list()).toEqual([long]);
	});

	it('refuses, writing nothing, when a note to be changed or renamed is read-only', () => {
		const root = dir();
		writeFiles(root, { 'Locked.md': 'l\n', 'Open.md': 'o\n' });
		chmodSync(join(root, 'Locked.md'), 0o444);
		const edit = applyOutcome(
			root,
			outcome([
				{ path: 'Open.md', from: 'Open.md', before: 'o\n', after: 'o changed\n' },
				{ path: 'Locked.md', from: 'Locked.md', before: 'l\n', after: 'l changed\n' },
				{ path: 'New.md', from: null, before: null, after: 'new\n' },
			]),
		);
		expect(edit).toEqual({ ok: false, reason: 'read-only', path: 'Locked.md' });
		const rename = applyOutcome(root, outcome([{ path: 'Moved/Locked.md', from: 'Locked.md', before: 'l\n', after: 'l\n' }]));
		expect(rename).toEqual({ ok: false, reason: 'read-only', path: 'Locked.md' });
		expect(readFileSync(join(root, 'Locked.md'), 'utf8')).toBe('l\n');
		expect(readFileSync(join(root, 'Open.md'), 'utf8')).toBe('o\n');
		expect(statSync(join(root, 'Locked.md')).mode & 0o777).toBe(0o444);
		expect(readdirSync(root).sort()).toEqual(['Locked.md', 'Open.md']);
		chmodSync(join(root, 'Locked.md'), 0o644);
	});

	it('a rename that only changes case', () => {
		const root = dir();
		writeFiles(root, { 'call marco.md': 'x\n' });
		const r = applyOutcome(root, outcome([{ path: 'Call Marco.md', from: 'call marco.md', before: 'x\n', after: 'y\n' }]));
		expect(r.ok).toBe(true);
		expect(readdirSync(root)).toEqual(['Call Marco.md']);
		expect(readFileSync(join(root, 'Call Marco.md'), 'utf8')).toBe('y\n');
	});

	it('a rename that only changes case never replaces another file (a case-sensitive file system)', () => {
		const root = dir();
		writeFiles(root, { 'call marco.md': 'x\n' });
		// As a case-sensitive file system would answer: another file is at the new name.
		const fs: ApplyFs = { ...nodeFs, stat: (p) => (p.endsWith('Call Marco.md') ? { dev: 1n, ino: 999_999n, mode: 0o644 } : nodeFs.stat(p)) };
		const r = applyOutcome(root, outcome([{ path: 'Call Marco.md', from: 'call marco.md', before: 'x\n', after: 'y\n' }]), fs);
		expect(r).toEqual({ ok: false, reason: 'changed', path: 'Call Marco.md' });
		expect(readFileSync(join(root, 'call marco.md'), 'utf8')).toBe('x\n');
	});

	it('refuses, writing nothing, when a file changed since the plan was made or a new file’s path was taken', () => {
		const root = dir();
		writeFiles(root, { 'One.md': 'edited elsewhere\n', 'Taken.md': 'here\n', 'Two.md': 'two\n' });
		const changed = applyOutcome(
			root,
			outcome([
				{ path: 'New.md', from: null, before: null, after: 'new\n' },
				{ path: 'One.md', from: 'One.md', before: 'one\n', after: 'one changed\n' },
			]),
		);
		expect(changed).toEqual({ ok: false, reason: 'changed', path: 'One.md' });
		expect(existsSync(join(root, 'New.md'))).toBe(false);
		expect(applyOutcome(root, outcome([{ path: 'Taken.md', from: null, before: null, after: 'mine\n' }]))).toEqual({ ok: false, reason: 'changed', path: 'Taken.md', appeared: true });
		expect(applyOutcome(root, outcome([{ path: 'Taken.md', from: 'Two.md', before: 'two\n', after: 'mine\n' }]))).toEqual({ ok: false, reason: 'changed', path: 'Taken.md' });
		expect(readFileSync(join(root, 'Taken.md'), 'utf8')).toBe('here\n');
		expect(temps(root)).toEqual([]);
	});

	describe('a failure while writing puts everything back', () => {
		const three = (root: string) => {
			writeFiles(root, { 'A.md': 'a\n', 'B.md': 'b\n' });
			return outcome([
				{ path: 'A.md', from: 'A.md', before: 'a\n', after: 'a changed\n' },
				{ path: 'Moved/B2.md', from: 'B.md', before: 'b\n', after: 'b changed\n' },
				{ path: 'C.md', from: null, before: null, after: 'c\n' },
			]);
		};
		const asBefore = (root: string) => {
			expect(readFileSync(join(root, 'A.md'), 'utf8')).toBe('a\n');
			expect(readFileSync(join(root, 'B.md'), 'utf8')).toBe('b\n');
			expect(existsSync(join(root, 'Moved'))).toBe(false);
			expect(existsSync(join(root, 'C.md'))).toBe(false);
			expect(temps(root)).toEqual([]);
		};

		it('failing on the 2nd of 3 files, moving it', () => {
			const root = dir();
			const r = applyOutcome(root, three(root), failingAt(2));
			expect(r).toEqual({ ok: false, reason: 'failed', path: 'Moved/B2.md', error: 'disk full', left: [] });
			asBefore(root);
		});

		it('failing on the 2nd of 3 files, after moving it', () => {
			const root = dir();
			const r = applyOutcome(root, three(root), failingAt(3));
			expect(r).toEqual({ ok: false, reason: 'failed', path: 'Moved/B2.md', error: 'disk full', left: [] });
			asBefore(root);
		});

		it('failing on the 3rd, after a rename', () => {
			const root = dir();
			const r = applyOutcome(root, three(root), failingAt(4));
			expect(r).toEqual({ ok: false, reason: 'failed', path: 'C.md', error: 'disk full', left: [] });
			asBefore(root);
		});

		it('a new file whose path is taken while the others are committed is never replaced, and everything is put back', () => {
			const root = dir();
			// Another program creates C.md while A is being written.
			const fs: ApplyFs = {
				...nodeFs,
				rename: (a, b) => {
					nodeFs.rename(a, b);
					if (b.endsWith('A.md') && !existsSync(join(root, 'C.md'))) writeFileSync(join(root, 'C.md'), 'someone else’s\n');
				},
			};
			const r = applyOutcome(root, three(root), fs);
			// Put back as it was: the vault changed, so the write can be planned again.
			expect(r).toEqual({ ok: false, reason: 'changed', path: 'C.md', appeared: true });
			expect(readFileSync(join(root, 'C.md'), 'utf8')).toBe('someone else’s\n');
			expect(temps(root)).toEqual([]);
			expect(readFileSync(join(root, 'A.md'), 'utf8')).toBe('a\n');
			expect(readFileSync(join(root, 'B.md'), 'utf8')).toBe('b\n');
		});

		it('says which files couldn’t be put back', () => {
			const root = dir();
			// C can't be written, and then A can't be put back.
			let failed = false;
			const fs: ApplyFs = {
				...nodeFs,
				rename: (a, b) => {
					if (b.endsWith('C.md')) {
						failed = true;
						throw new Error('disk full');
					}
					if (failed && b.endsWith('A.md')) throw new Error('locked');
					nodeFs.rename(a, b);
				},
			};
			const r = applyOutcome(root, three(root), fs);
			expect(r).toMatchObject({ ok: false, reason: 'failed', path: 'C.md', error: 'disk full' });
			if (r.ok || r.reason !== 'failed') throw new Error('expected a failure');
			expect(r.left).toEqual(['A.md']);
			// B was put back.
			expect(readFileSync(join(root, 'B.md'), 'utf8')).toBe('b\n');
			expect(temps(root)).toEqual([]);
		});
	});

	describe('writes stay inside the vault', () => {
		it.each(['../Outside.md', '/abs/Note.md', 'A/../../Up.md', 'A/./B.md', 'A//B.md', 'C:/x.md', 'A\\B.md', ''])('refuses %j', (path) => {
			const root = dir();
			const r = applyOutcome(root, outcome([{ path, from: null, before: null, after: 'x\n' }]));
			expect(r).toEqual({ ok: false, reason: 'unsafe', path });
		});

		it('refuses a folder that is a link to somewhere else', () => {
			const outside = dir();
			const root = dir();
			symlinkSync(outside, join(root, 'Elsewhere'));
			const r = applyOutcome(root, outcome([{ path: 'Elsewhere/Note.md', from: null, before: null, after: 'x\n' }]));
			expect(r).toEqual({ ok: false, reason: 'unsafe', path: 'Elsewhere/Note.md' });
			expect(readdirSync(outside)).toEqual([]);
		});

		it('accepts a vault that is itself reached through a link', () => {
			const real = dir();
			const root = join(dir(), 'Linked');
			symlinkSync(real, root);
			expect(applyOutcome(root, outcome([{ path: 'Note.md', from: null, before: null, after: 'x\n' }])).ok).toBe(true);
			expect(readFileSync(join(real, 'Note.md'), 'utf8')).toBe('x\n');
		});
	});
});

describe('the vault’s files', () => {
	it('lists every file but the configuration folder, the trash, dot-folders and links; reads any', () => {
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
		// Linked folders and files are skipped.
		const outside = dir();
		writeFiles(outside, { 'Other.md': 'o' });
		symlinkSync(outside, join(root, 'Linked'));
		symlinkSync(join(outside, 'Other.md'), join(root, 'Linked note.md'));
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

describe('reading a vault once per attempt', () => {
	it('every read of a path gives what the first read gave', () => {
		const root = dir();
		writeFiles(root, { 'Note.md': 'first\n' });
		const reader = cachingReader(fsVaultReader(root, '.obsidian'));
		expect(reader.read('Note.md')).toBe('first\n');
		writeFileSync(join(root, 'Note.md'), 'second\n');
		expect(reader.read('Note.md')).toBe('first\n');
		expect(reader.read('Missing.md')).toBeNull();
	});
});

describe('naming the vault in links', () => {
	it('by its ID when Obsidian’s list of vaults knows the folder, through links too', () => {
		const settings = dir();
		const real = join(dir(), 'Notes');
		mkdirSync(real);
		const viaLink = join(dir(), 'Shortcut');
		symlinkSync(real, viaLink);
		const other = join(dir(), 'Notes');
		mkdirSync(other);
		writeFiles(settings, { 'obsidian.json': JSON.stringify({ vaults: { a1b2c3: { path: other, ts: 1 }, d4e5f6: { path: real, ts: 2, open: true } } }) });
		expect(vaultRef(viaLink, settings)).toBe('d4e5f6');
		expect(vaultRef(other, settings)).toBe('a1b2c3');
	});

	it('by the real folder’s name otherwise', () => {
		const real = join(dir(), 'Notes');
		mkdirSync(real);
		const viaLink = join(dir(), 'Shortcut');
		symlinkSync(real, viaLink);
		expect(vaultRef(viaLink, null)).toBe('Notes');
		expect(vaultRef(viaLink, dir())).toBe('Notes');
	});

	it('Obsidian’s settings folder on each system', () => {
		expect(obsidianSettingsDir('darwin', {}, '/Users/me')).toBe('/Users/me/Library/Application Support/obsidian');
		expect(obsidianSettingsDir('linux', {}, '/home/me')).toBe('/home/me/.config/obsidian');
		expect(obsidianSettingsDir('linux', { XDG_CONFIG_HOME: '/cfg' }, '/home/me')).toBe('/cfg/obsidian');
		expect(obsidianSettingsDir('win32', {}, 'C:/Users/me')).toBeNull();
	});
});

describe('the open link', () => {
	it('names an Action with file, as Obsidian’s own links do, a Matter with matter, a board with board', () => {
		expect(openUrl('My vault', { file: 'MTM/Actions/Call & ask.md' })).toBe('obsidian://mtm-open?vault=My%20vault&file=MTM%2FActions%2FCall%20%26%20ask.md');
		expect(openUrl('Notes', { matter: 'Kitchen renovation' })).toBe('obsidian://mtm-open?vault=Notes&matter=Kitchen%20renovation');
		expect(openUrl('Notes', { board: 'Matters' })).toBe('obsidian://mtm-open?vault=Notes&board=Matters');
	});
});

describe('asking the system to open a link', () => {
	/** A started process that does what the test says, when it says. */
	const fakeChild = () => {
		const child = Object.assign(new EventEmitter(), { unrefs: 0, unref: () => void child.unrefs++ });
		return child;
	};
	const spawning = (child: ReturnType<typeof fakeChild>) => {
		const calls: { command: string; args: readonly string[] }[] = [];
		const spawner: Spawner = (command, args) => (calls.push({ command, args }), child);
		return { calls, spawner };
	};
	const url = 'obsidian://mtm-open?vault=Notes&file=A.md';

	it('opens when the system’s opener ends well', async () => {
		const child = fakeChild();
		const { calls, spawner } = spawning(child);
		const opened = systemOpener('darwin', spawner, 1000)(url);
		child.emit('spawn');
		child.emit('exit', 0, null);
		await expect(opened).resolves.toBeUndefined();
		expect(calls).toEqual([{ command: 'open', args: [url] }]);
		expect(child.unrefs).toBe(1);
	});

	it('fails when nothing handles the link (the opener ends with an error code), or the opener can’t start', async () => {
		const child = fakeChild();
		const opened = systemOpener('linux', spawning(child).spawner, 1000)(url);
		child.emit('spawn');
		child.emit('exit', 4, null);
		await expect(opened).rejects.toThrow('The opener ended with 4');
		const missing = fakeChild();
		const notStarted = systemOpener('linux', spawning(missing).spawner, 1000)(url);
		missing.emit('error', new Error('spawn xdg-open ENOENT'));
		await expect(notStarted).rejects.toThrow('ENOENT');
	});

	it('takes an opener still running after the wait as opening the link', async () => {
		const child = fakeChild();
		const opened = systemOpener('darwin', spawning(child).spawner, 5)(url);
		child.emit('spawn');
		await expect(opened).resolves.toBeUndefined();
		// Its end, later, changes nothing.
		child.emit('exit', 1, null);
		expect(child.unrefs).toBe(1);
	});
});

describe('output to a pipe that closes early', () => {
	it('is dropped quietly; other errors are not', () => {
		const stream = new EventEmitter();
		quietOnClosedPipe(stream);
		expect(() => stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow();
		expect(() => stream.emit('error', Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }))).not.toThrow();
		expect(() => stream.emit('error', Object.assign(new Error('no space'), { code: 'ENOSPC' }))).toThrow('no space');
		expect(isClosedPipe({ code: 'EPIPE' })).toBe(true);
		expect(isClosedPipe({})).toBe(false);
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
		expect(pkg).toMatchObject({ bin: { 'matters-that-matter': 'dist/mtm.mjs' }, type: 'module', files: ['dist'], engines: { node: '>=20' }, license: 'MIT' });
		expect(pkg.dependencies).toBeUndefined();
	});
});
