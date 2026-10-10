// The operations on the fixture vault through the file snapshot: they must answer as they do over Obsidian's own
// cache (expected/cache.json), and the answers must match what the fixture holds.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CacheShape } from '../../src/files/cacheShape';
import { VaultIndex } from '../../src/files/index';
import { filesSnapshot } from '../../src/files/snapshot';
import { getAction, listActions, listMatters, today } from '../../src/ops/index';
import type { Snapshot } from '../../src/ops/types';
import { migrateSettings } from '../../src/services/migrations';

const root = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');
const EXPECTED = join(root, 'tests/fixtures/expected/cache.json');

/** The fixture's day: Friday 9 October 2026 at noon, local time. */
const NOW = new Date(2026, 9, 9, 12, 0);

function walk(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

const read = (path: string) => readFileSync(join(FIXTURE, path), 'utf8');
const files = walk(FIXTURE);
const index = new VaultIndex({ list: () => files, read }, { configDir: '.obsidian' });
const settings = migrateSettings(JSON.parse(read('.obsidian/plugins/matters-that-matter/data.json')));
const fromFiles = filesSnapshot(index, settings, NOW);

/** The same snapshot answered from Obsidian's dump: its properties, its body links and how each link resolved. */
function fromCache(cache: CacheShape): Snapshot {
	const dests = new Map<string, string | null>();
	// Link paths no note of that folder links with (an unbracketed property, say): what they reach from anywhere, when that is one file.
	const anywhere = new Map<string, Set<string | null>>();
	const pathPart = (link: string) => link.split('#')[0] ?? '';
	for (const [path, note] of Object.entries(cache.notes)) {
		for (const ref of [...note.links, ...note.embeds, ...note.frontmatterLinks]) {
			dests.set(`${path}\n${pathPart(ref.link)}`, ref.dest);
			const seen = anywhere.get(pathPart(ref.link)) ?? new Set();
			anywhere.set(pathPart(ref.link), seen.add(ref.dest));
		}
	}
	const name = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '');
	return {
		settings,
		now: NOW,
		notes: Object.entries(cache.notes).map(([path, note]) => ({ path, basename: name(path), frontmatter: note.frontmatter ?? undefined })),
		content: (path) => (cache.notes[path] ? read(path) : null),
		links: (path) => cache.notes[path]?.links.map((ref) => ref.link) ?? [],
		resolve: (link, fromPath) => {
			const key = `${fromPath}\n${pathPart(link)}`;
			const elsewhere = anywhere.get(pathPart(link));
			if (!dests.has(key) && elsewhere?.size === 1) return [...elsewhere][0] ?? null;
			if (!dests.has(key)) throw new Error(`Obsidian's dump has no resolution for "${link}" from ${fromPath}`);
			return dests.get(key) ?? null;
		},
		linkText: (path, fromPath) => {
			const text = cache.linkText.shortest?.[fromPath]?.[path];
			if (text === undefined) throw new Error(`Obsidian's dump has no link text from ${fromPath} to ${path}`);
			return text;
		},
		exists: (path) => cache.files.some((f) => f.toLowerCase() === path.toLowerCase()),
	};
}

describe('the operations on the fixture through the file snapshot', () => {
	it('lists the open Actions, the edge cases included', () => {
		const result = listActions({}, fromFiles);
		if (!result.ok) throw new Error(result.error.message);
		const paths = result.value.map((a) => a.path);
		expect(paths).toContain('MTM/Sample/Actions/Order the worktop.md');
		expect(paths).not.toContain('MTM/Sample/Edge cases/Edge - done without a completion date.md');
		const orphan = result.value.find((a) => a.path === 'MTM/Sample/Edge cases/Edge - unknown status.md');
		expect(orphan?.orphans).toEqual([{ field: 'status', raw: 'someday' }]);
		const alias = result.value.find((a) => a.path === 'MTM/Sample/Edge cases/Edge - Matter link with an alias.md');
		expect(alias?.matter.path).toBe('MTM/Sample/Matters/Kitchen renovation.md');
		const twin = result.value.find((a) => a.path === 'MTM/Sample/Edge cases/Edge - Matter with a twin name.md');
		expect(twin?.matter.path).toBe('MTM/Sample/Edge cases/Links/Edge - twin.md');
	});

	it('reads one Action with its checklist and linked notes', () => {
		const result = getAction('Order the worktop', fromFiles);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.linkedNotes.map((n) => n.path)).toEqual(['MTM/Sample/Notes/Kitchen ideas.md']);
	});

	it.skipIf(!existsSync(EXPECTED))('answers as it does over Obsidian\'s cache', () => {
		const cache = JSON.parse(readFileSync(EXPECTED, 'utf8')) as CacheShape;
		const obsidian = fromCache(cache);
		expect(listActions({ done: true }, fromFiles)).toEqual(listActions({ done: true }, obsidian));
		expect(today(fromFiles)).toEqual(today(obsidian));
		expect(listMatters(fromFiles)).toEqual(listMatters(obsidian));
		for (const action of Object.keys(cache.linkText.shortest ?? {})) {
			expect(getAction(action, fromFiles)).toEqual(getAction(action, obsidian));
		}
	});

	it('finds what is due today or late on the fixture\'s day', () => {
		const result = today(fromFiles);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.date).toBe('2026-10-09');
		expect(result.value.due.length).toBe(result.value.dueToday + result.value.late);
		expect(result.value.due.length).toBeGreaterThan(0);
		for (const a of result.value.due) expect(a.today).toBe(true);
	});
});
