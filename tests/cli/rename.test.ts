// A new title renames the note and, as Obsidian does, updates the links to it when "Automatically update internal
// links" is on, or says how many now point nowhere when it is off. Every note and line is listed, in a dry run too.

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadCases } from '../files/writeCases';
import { fixtureCopy, hashes, mtm, writeFiles } from './helpers';

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const setup = loadCases().find((c) => c.name === 'rename-links-on')?.setup ?? {};
const RENAME = ['update', 'Confirm the worktop measurements', '--title', 'Measure the worktop'];

/** The fixture with two notes linking to the Action in every form, links updated or not. */
function vault(updateLinks: boolean): string {
	const root = fixtureCopy();
	made.push(dirname(root));
	writeFiles(root, setup);
	const app = join(root, '.obsidian', 'app.json');
	writeFileSync(app, JSON.stringify({ ...(JSON.parse(readFileSync(app, 'utf8')) as object), alwaysUpdateLinks: updateLinks }));
	return root;
}

describe('renaming', () => {
	it('lists the links it updated, note by note', async () => {
		const root = vault(true);
		const r = await mtm([...RENAME, '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Renamed to “Measure the worktop”
			  MTM/Sample/Actions/Measure the worktop.md
			  Updated 15 links in 2 notes:
			    MTM/Sample/Notes/Worktop links in CRLF.md      lines 3, 4
			    MTM/Sample/Notes/Worktop links.md              lines 2, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21
			"
		`);
		expect(readFileSync(join(root, 'MTM/Sample/Notes/Worktop links.md'), 'utf8')).toContain('- Plain: [[Measure the worktop]]');
	});

	it('says how many links point nowhere, and where, when Obsidian doesn’t update links', async () => {
		const root = vault(false);
		const r = await mtm([...RENAME, '--vault', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatchInlineSnapshot(`
			"Renamed to “Measure the worktop”
			  MTM/Sample/Actions/Measure the worktop.md
			  15 links still point to the old name: Obsidian’s “Automatically update internal links” is off in this vault.
			    MTM/Sample/Notes/Worktop links in CRLF.md      lines 3, 4
			    MTM/Sample/Notes/Worktop links.md              lines 2, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21
			"
		`);
		expect(readFileSync(join(root, 'MTM/Sample/Notes/Worktop links.md'), 'utf8')).toContain('- Plain: [[Confirm the worktop measurements]]');
	});

	it('a dry run lists every note and line it would touch, and writes nothing', async () => {
		for (const updateLinks of [true, false]) {
			const root = vault(updateLinks);
			const before = hashes(root);
			const r = await mtm([...RENAME, '--dry-run', '--vault', root]);
			expect(r.code).toBe(0);
			expect(r.stdout).toContain('Would rename to “Measure the worktop”');
			expect(r.stdout).toContain('    MTM/Sample/Notes/Worktop links in CRLF.md      lines 3, 4\n');
			expect(r.stdout).toContain(updateLinks ? 'Would update 15 links in 2 notes:' : '15 links would point to the old name');
			expect(hashes(root)).toEqual(before);
		}
	});

	it('--json gives the notes and lines, and the count left pointing nowhere', async () => {
		const on = JSON.parse((await mtm([...RENAME, '--json', '--dry-run', '--vault', vault(true)])).stdout) as Record<string, unknown>;
		expect(on).toMatchObject({
			links: [
				{ path: 'MTM/Sample/Notes/Worktop links in CRLF.md', lines: [3, 4] },
				{ path: 'MTM/Sample/Notes/Worktop links.md', lines: [2, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21] },
			],
			danglingLinks: 0,
		});
		const root = vault(false);
		const off = JSON.parse((await mtm([...RENAME, '--json', '--vault', root])).stdout) as Record<string, unknown>;
		expect(off.links).toEqual([]);
		expect(off.danglingLinks).toBe(15);
	});
});
