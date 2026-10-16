// The write cases through the command line: each case as the `matters-that-matter` command a person would type, run in-process on a
// copy of the fixture vault. The files on disk afterwards must be Obsidian's results byte for byte (or, for the
// differences accepted in expected/ACCEPTED.md, exactly what the files layer computes): what the command line
// writes is what the files layer computed, nothing added and nothing lost.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { acceptedWrites, CONFIG_DIR, loadCases, runCase, WRITES, type WriteCase } from '../files/writeCases';
import { fixtureCopy, hashes, mtm, writeFiles } from './helpers';

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cases = loadCases();
const accepted = acceptedWrites();

/** The command for a case: its target as words, every other field as a flag by its public name. */
export function argvOf(c: WriteCase): string[] {
	const input = { ...c.input };
	const words: Record<WriteCase['op'], [string, string | null]> = {
		addAction: ['add', 'text'],
		updateAction: ['update', 'action'],
		markAsDone: ['done', 'action'],
		reopen: ['reopen', 'action'],
		addMatter: ['add-matter', 'name'],
	};
	const [command, wordKey] = words[c.op];
	const argv = [command];
	if (wordKey && typeof input[wordKey] === 'string') {
		argv.push(input[wordKey]);
		delete input[wordKey];
	}
	for (const [key, value] of Object.entries(input)) {
		if (value === null) argv.push(`--no-${key}`);
		else if (Array.isArray(value)) for (const v of value) argv.push(`--${key}`, String(v));
		else if (typeof value === 'string' || typeof value === 'number') argv.push(`--${key}`, String(value));
		else throw new Error(`${c.name}: ${key} can’t be a flag`);
	}
	return [...argv, '--now', c.now];
}

/** Files the Obsidian script writes beside the vault files of a case's result. */
const RESULT_FILES = new Set(['removed.json', 'unresolved.json']);

/** Every file under a folder, as vault paths. */
function walk(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

/** A copy of the fixture as the case sets it up: its notes added, Obsidian's link setting as it says. */
function caseVault(c: WriteCase): string {
	const root = fixtureCopy();
	made.push(dirname(root));
	writeFiles(root, c.setup ?? {});
	if (c.alwaysUpdateLinks !== undefined) {
		const app = join(root, CONFIG_DIR, 'app.json');
		writeFileSync(app, `${JSON.stringify({ ...(JSON.parse(readFileSync(app, 'utf8')) as object), alwaysUpdateLinks: c.alwaysUpdateLinks }, null, 2)}\n`);
	}
	return root;
}

describe('the write cases, through the command line', () => {
	it('maps a case to a command line', () => {
		const c = cases.find((x) => x.name === 'update-priority-remove');
		expect(c && argvOf(c)).toEqual(['update', 'Confirm the worktop measurements', '--no-priority', '--now', '2026-10-09T12:00']);
	});

	it('covers every case', () => {
		expect(cases.length).toBeGreaterThanOrEqual(45);
		for (const c of cases) expect(existsSync(join(WRITES, c.name)), `no Obsidian result for ${c.name}`).toBe(true);
	});

	it.each(cases.map((c) => [c.name, c] as [string, WriteCase]))('%s: the files written are Obsidian’s', async (name, c) => {
		const root = caseVault(c);
		const before = hashes(root);
		// The same sequential IDs for new notes as the files layer's run of the case.
		const r = await mtm([...argvOf(c), '--json', '--vault', root]);
		expect(r.code, `${name}: ${r.stdout}${r.stderr}`).toBe(0);
		const after = hashes(root);

		const dir = join(WRITES, name);
		const removed = existsSync(join(dir, 'removed.json')) ? (JSON.parse(readFileSync(join(dir, 'removed.json'), 'utf8')) as string[]) : [];
		const expected = walk(dir).filter((p) => !RESULT_FILES.has(p));
		const filesLayer = runCase(c).written;

		// Byte for byte: Obsidian's result, or for an accepted difference (style or meaning) the files layer's.
		for (const path of expected) {
			const disk = join(root, ...path.split('/'));
			expect(existsSync(disk), `${name}: ${path} is missing`).toBe(true);
			const want = accepted.some((a) => a.case === name && a.path === path)
				? Buffer.from(filesLayer.get(path) ?? '', 'utf8')
				: readFileSync(join(dir, ...path.split('/')));
			expect(readFileSync(disk).equals(want), `${name}: ${path}\n${readFileSync(disk, 'utf8')}`).toBe(true);
		}
		// By exact name: on a case-insensitive file system the new name of a case-only rename answers for the old.
		const listed = (path: string) => readdirSync(dirname(join(root, ...path.split('/')))).includes(path.split('/').pop() ?? '');
		for (const path of removed) expect(listed(path), `${name}: ${path} should be gone`).toBe(false);
		for (const path of expected) expect(listed(path), `${name}: ${path} under its exact name`).toBe(true);

		// Nothing else changed: every file written is in Obsidian's result; every file gone is in its list (fixture files
		// only) or is a setup note that moved away.
		const setup = Object.keys(c.setup ?? {});
		const changed = Object.keys(after).filter((p) => before[p] !== after[p]);
		const gone = Object.keys(before).filter((p) => !(p in after));
		expect(changed.filter((p) => !expected.includes(p)), name).toEqual([]);
		expect(gone.filter((p) => !setup.includes(p)).sort(), name).toEqual([...removed].sort());
		for (const p of setup) expect(p in after, `${name}: setup note ${p}`).toBe(expected.includes(p));

		// As many links left pointing nowhere as Obsidian counted.
		const unresolved = join(dir, 'unresolved.json');
		if (existsSync(unresolved)) {
			const u = JSON.parse(readFileSync(unresolved, 'utf8')) as { before: number; after: number };
			expect((JSON.parse(r.stdout) as { danglingLinks: number }).danglingLinks, name).toBe(u.after - u.before);
		}
	});
});
