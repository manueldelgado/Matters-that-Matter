// The file index of the fixture vault must equal what Obsidian's metadata cache holds for it (expected/cache.json,
// dumped from Obsidian), apart from the differences listed in expected/ACCEPTED.md.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cacheJson, cacheShape, sortKeys, type CacheShape } from '../../src/files/cacheShape';
import { dumpChanges, dumpText, EXPECTED, fixtureIndex, fixtureSha256 as sha256 } from './fixtureDump';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ACCEPTED = join(root, 'tests/fixtures/expected/ACCEPTED.md');

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
	const text = dumpText();
	const expected = text ? (JSON.parse(text) as CacheShape) : null;
	const index = fixtureIndex();
	const { changed, added } = dumpChanges(expected, index);
	// A stale dump fails only the first test: comparing the index with it would report the fixture's changes as index differences.
	const stale = changed.length > 0 || added.length > 0;

	it('dumps the fixture as it is now (otherwise cache.json is out of date: re-run the Obsidian dump)', () => {
		expect({ changed, added }, 'cache.json is out of date: re-run the Obsidian dump').toEqual({ changed: [], added: [] });
	});

	it('reproduces cache.json, apart from the accepted differences', () => {
		if (stale) return;
		const shape = cacheShape(index, sha256);
		const ignore = accepted();
		const found = differences(sortKeys(shape), expected).filter((path) => !ignore.some((prefix) => startsWith(path, prefix)));
		expect(found).toEqual([]);
		// With nothing accepted, the very bytes of the dump: key order and formatting included.
		if (ignore.length === 0) expect(cacheJson(shape) === text, 'the index differs from cache.json in formatting or key order').toBe(true);
	});

	it('lists no accepted difference that has gone away', () => {
		if (stale) return;
		const all = differences(sortKeys(cacheShape(index, sha256)), expected);
		const unused = accepted().filter((prefix) => !all.some((path) => startsWith(path, prefix)));
		expect(unused).toEqual([]);
	});
});
