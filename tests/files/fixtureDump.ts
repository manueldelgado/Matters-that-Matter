// The fixture vault and Obsidian's dump of it (expected/cache.json), shared by the tests that compare against it.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CacheShape } from '../../src/files/cacheShape';
import { VaultIndex } from '../../src/files/index';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');
export const EXPECTED = join(root, 'tests/fixtures/expected/cache.json');

/** Every file under `dir`, as vault paths. */
export function walk(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

export const readFixture = (path: string) => readFileSync(join(FIXTURE, path), 'utf8');
export const fixtureSha256 = (path: string) => createHash('sha256').update(readFileSync(join(FIXTURE, path))).digest('hex');

/** The fixture vault, indexed from its files. */
export function fixtureIndex(): VaultIndex {
	const files = walk(FIXTURE);
	return new VaultIndex({ list: () => files, read: readFixture }, { configDir: '.obsidian' });
}

/** The dump's text, or '' while there is none. */
export const dumpText = (): string => (existsSync(EXPECTED) ? readFileSync(EXPECTED, 'utf8') : '');

/** Notes the dump holds that have changed or gone since, and notes it doesn't hold yet. Both empty: the dump is current. */
export function dumpChanges(cache: CacheShape | null, index: VaultIndex): { changed: string[]; added: string[] } {
	const notes = cache?.notes ?? {};
	const changed = Object.keys(notes).filter((path) => !existsSync(join(FIXTURE, path)) || notes[path]?.sha256 !== fixtureSha256(path));
	const added = index.notePaths.filter((path) => !notes[path]);
	return { changed, added };
}
