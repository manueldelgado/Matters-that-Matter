// Running the command line in-process against vaults in temporary folders: the synthetic vault of the operations'
// tests written out as files, or a copy of the fixture vault.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { run, type CliIo } from '../../cli/src/main';
import { SETTINGS, VAULT, type TestVault } from '../ops/snapshot';
import type { MattersSettings } from '../../src/settings';

export const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'mtm-fixture');
export const CONFIG = '.obsidian';
export const SETTINGS_FILE = `${CONFIG}/plugins/matters-that-matter/data.json`;

export function tempDir(prefix = 'mtm-cli-'): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

/** A note as Obsidian would write it, frontmatter in YAML. */
export function noteText(note: TestVault[string]): string {
	const fm = note.frontmatter;
	const head = fm ? `---\n${stringify(fm, { lineWidth: 0 })}---\n` : '';
	return head + (note.body ?? '');
}

export function writeFiles(root: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, ...path.split('/'));
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text, 'utf8');
	}
}

/** The synthetic vault (an Inbox, three Matters, people, Actions) in a folder named `Notes`, with Matters' settings. */
export function syntheticVault(options: { settings?: Partial<MattersSettings> | Record<string, unknown>; extra?: TestVault; without?: string[] } = {}): string {
	const root = join(tempDir(), 'Notes');
	const vault: TestVault = { ...VAULT, ...options.extra };
	for (const path of options.without ?? []) delete vault[path];
	const files: Record<string, string> = {};
	for (const [path, note] of Object.entries(vault)) files[path] = noteText(note);
	files[`${CONFIG}/app.json`] = JSON.stringify({ alwaysUpdateLinks: true, newLinkFormat: 'shortest' });
	files[SETTINGS_FILE] = JSON.stringify({ ...SETTINGS, ...options.settings }, null, 2);
	writeFiles(root, files);
	return root;
}

/** A copy of the fixture vault (the sample package on Friday 9 October 2026, with edge cases). */
export function fixtureCopy(): string {
	const root = join(tempDir(), 'mtm-fixture');
	cpSync(FIXTURE, root, { recursive: true });
	return root;
}

/** Every file under a folder with its SHA-256. */
export function hashes(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (rel: string) => {
		for (const e of readdirSync(rel ? join(root, rel) : root, { withFileTypes: true })) {
			const path = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) walk(path);
			else out[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
		}
	};
	walk('');
	return out;
}

export interface Ran {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs `mtm` with these arguments; `--now 2026-10-09T12:00` unless another time is given. */
export async function mtm(argv: string[], io: Partial<CliIo> & { tty?: boolean } = {}): Promise<Ran> {
	let stdout = '';
	let stderr = '';
	const args = argv.includes('--now') ? argv : [...argv, '--now', '2026-10-09T12:00'];
	const code = await run(args, {
		stdout: { write: (t: string) => (stdout += t), isTTY: io.tty },
		stderr: { write: (t: string) => (stderr += t), isTTY: io.tty },
		env: {},
		cwd: tmpdir(),
		home: '/home/nobody',
		...io,
	});
	return { code, stdout, stderr };
}

/** Output with the vault's folder written as `<vault>`. */
export const normalise = (text: string, root: string) => text.split(root).join('<vault>');

export const read = (root: string, path: string) => readFileSync(join(root, ...path.split('/')), 'utf8');
