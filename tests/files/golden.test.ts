// The file index of the fixture vault must equal what Obsidian's metadata cache holds for it (expected/cache.json,
// dumped from Obsidian), apart from the differences listed in expected/ACCEPTED.md.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cacheShape, sortKeys, type CacheShape } from '../../src/files/cacheShape';
import { VaultIndex } from '../../src/files/index';

const root = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');
const EXPECTED = join(root, 'tests/fixtures/expected/cache.json');
const ACCEPTED = join(root, 'tests/fixtures/expected/ACCEPTED.md');

/** Every file under `dir`, as vault paths. */
function walk(dir: string, prefix = ''): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...walk(dir, rel));
		else out.push(rel);
	}
	return out;
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(join(FIXTURE, path))).digest('hex');

/** Paths (as key lists) where two JSON values differ. */
function differences(actual: unknown, expected: unknown, at: string[] = []): string[][] {
	if (Object.is(actual, expected)) return [];
	const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
	if (!isObject(actual) || !isObject(expected) || Array.isArray(actual) !== Array.isArray(expected)) return [at];
	const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
	const out: string[][] = [];
	for (const key of keys) {
		if (!(key in actual) || !(key in expected)) out.push([...at, key]);
		else out.push(...differences(actual[key], expected[key], [...at, key]));
	}
	return out;
}

/** The accepted differences: the JSON block in ACCEPTED.md, a list of `{ "path": [keys…], "reason": "…" }`. */
function accepted(): string[][] {
	if (!existsSync(ACCEPTED)) return [];
	const block = /```json\n([\s\S]*?)\n```/.exec(readFileSync(ACCEPTED, 'utf8'));
	if (!block) throw new Error('ACCEPTED.md has no ```json block');
	const list = JSON.parse(block[1] ?? '[]') as { path: string[]; reason: string }[];
	for (const item of list) if (!item.reason?.trim()) throw new Error(`No reason given for ${JSON.stringify(item.path)}`);
	return list.map((item) => item.path);
}

const startsWith = (path: string[], prefix: string[]) => prefix.every((key, i) => path[i] === key);

describe.skipIf(!existsSync(EXPECTED))('the file index equals Obsidian\'s cache (waiting for cache.json when skipped)', () => {
	const expected = existsSync(EXPECTED) ? (JSON.parse(readFileSync(EXPECTED, 'utf8')) as CacheShape) : null;
	const files = walk(FIXTURE);
	const index = new VaultIndex({ list: () => files, read: (path) => readFileSync(join(FIXTURE, path), 'utf8') }, { configDir: '.obsidian' });

	it('dumps the fixture as it is now (otherwise cache.json is out of date: re-run the Obsidian dump)', () => {
		const stale = Object.entries(expected?.notes ?? {})
			.filter(([path, note]) => !existsSync(join(FIXTURE, path)) || note.sha256 !== sha256(path))
			.map(([path]) => path);
		expect(stale, 'cache.json is out of date: re-run the Obsidian dump').toEqual([]);
		expect(index.notePaths, 'cache.json is out of date: re-run the Obsidian dump').toEqual(Object.keys(expected?.notes ?? {}));
	});

	it('reproduces cache.json, apart from the accepted differences', () => {
		const actual = sortKeys(cacheShape(index, sha256));
		const ignore = accepted();
		const found = differences(actual, expected).filter((path) => !ignore.some((prefix) => startsWith(path, prefix)));
		expect(found).toEqual([]);
	});

	it('lists no accepted difference that has gone away', () => {
		const actual = sortKeys(cacheShape(index, sha256));
		const all = differences(actual, expected);
		const unused = accepted().filter((prefix) => !all.some((path) => startsWith(path, prefix)));
		expect(unused).toEqual([]);
	});
});
