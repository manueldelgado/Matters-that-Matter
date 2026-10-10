import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isVaultFile, VaultIndex } from '../../src/files/index';
import { linkpath } from '../../src/files/links';
import { LINK_FORMATS } from '../../src/files/linkText';
import { FileLookup, renameLinks, rewriteLink } from '../../src/files/rename';

const root = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(root, 'tests/fixtures/mtm-fixture');

function walk(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? walk(dir, rel) : [rel];
	});
}

const all = walk(FIXTURE);
const read = (path: string) => readFileSync(join(FIXTURE, path), 'utf8');
const index = new VaultIndex({ list: () => all, read }, { configDir: '.obsidian' });

describe("the file lookup agrees with the index (Obsidian's resolution)", () => {
	const lookup = new FileLookup(index.files);

	it('resolves every link in the fixture to the same first file', () => {
		const differ: string[] = [];
		for (const path of index.notePaths) {
			const body = index.body(path);
			const refs = [...(body?.links ?? []), ...(body?.embeds ?? []), ...(index.note(path)?.frontmatterLinks ?? [])];
			for (const ref of refs) {
				const target = linkpath(ref.link);
				const mine = lookup.destinations(target, path)[0] ?? null;
				if (mine !== index.resolve(ref.link, path)) differ.push(`${path}: ${ref.link} → ${mine}`);
			}
		}
		expect(differ).toEqual([]);
	});

	it('writes the same link text in every format', () => {
		const differ: string[] = [];
		const sources = index.notePaths.filter((p) => index.note(p)?.frontmatter?.['mtm-kind'] === 'action');
		for (const format of LINK_FORMATS) {
			for (const source of sources) {
				for (const target of index.notePaths) {
					if (lookup.linkText(target, source, format, true) !== index.linkText(target, source, format)) differ.push(`${format} ${source} → ${target}`);
				}
			}
		}
		expect(differ).toEqual([]);
	});

	it('lists every file a name can mean, those near the note first', () => {
		expect(lookup.destinations('Edge - twin', 'MTM/Sample/Edge cases/Links/Elsewhere/Relative links.md')).toEqual([
			'MTM/Sample/Edge cases/Links/Elsewhere/Edge - twin.md',
			'MTM/Sample/Edge cases/Links/Edge - twin.md',
		]);
		expect(lookup.destinations('Edge - twin', 'MTM/Sample/Edge cases/Links/Links in the body.md')).toEqual([
			'MTM/Sample/Edge cases/Links/Edge - twin.md',
			'MTM/Sample/Edge cases/Links/Elsewhere/Edge - twin.md',
		]);
		expect(lookup.destinations('Link target', 'Anywhere.md')).toEqual(['MTM/Sample/Edge cases/Links/Link target.md']);
		expect(lookup.destinations('/MTM/Sample/Edge cases/Links/Link target', 'Anywhere.md')).toEqual(['MTM/Sample/Edge cases/Links/Link target.md']);
		expect(lookup.destinations('Nowhere', 'Anywhere.md')).toEqual([]);
	});

	it('moves a renamed file to the end of its new name', () => {
		const after = lookup.renamed('MTM/Sample/Actions/Book the hotel.md', 'MTM/Sample/Actions/Link target.md');
		expect(after.has('MTM/Sample/Actions/Book the hotel.md')).toBe(false);
		expect(after.destinations('Link target', 'Anywhere.md')).toEqual(['MTM/Sample/Actions/Link target.md', 'MTM/Sample/Edge cases/Links/Link target.md']);
		expect(after.destinations('Book the hotel', 'Anywhere.md')).toEqual([]);
	});
});

describe('rewriting one link as Obsidian does', () => {
	it('keeps aliases, headings, blocks and the embed mark', () => {
		expect(rewriteLink('[[Old]]', 'Old', 'New')).toBe('[[New]]');
		expect(rewriteLink('![[Old#Head]]', 'Old#Head', 'New#Head')).toBe('![[New#Head]]');
		expect(rewriteLink('[[Old#^b|the item]]', 'Old#^b', 'New#^b')).toBe('[[New#^b|the item]]');
		expect(rewriteLink('[[Old\\|in a table]]', 'Old', 'New')).toBe('[[New\\|in a table]]');
	});

	it('renames an alias that was the old name of a path link', () => {
		expect(rewriteLink('[[A/Old|Old]]', 'A/Old', 'A/New')).toBe('[[A/New|New]]');
		expect(rewriteLink('[[Old|Old]]', 'Old', 'New')).toBe('[[New|Old]]');
	});

	it('encodes Markdown links and follows their text when it showed the name', () => {
		expect(rewriteLink('[encoded](Old%20name.md)', 'Old name.md', 'New name.md')).toBe('[encoded](New%20name.md)');
		expect(rewriteLink('[Old name](Old%20name.md)', 'Old name.md', 'New name.md')).toBe('[New name](New%20name.md)');
		expect(rewriteLink('[x](<Old name.md>)', 'Old name.md', 'New name.md')).toBe('[x](<New name.md>)');
		expect(rewriteLink('![p](a.svg "title")', 'a.svg', 'b c.svg')).toBe('![p](b%20c.svg "title")');
		expect(rewriteLink('[A/Old](A/Old.md)', 'A/Old.md', 'A/New.md')).toBe('[A/New](A/New.md)');
	});
});

describe('renaming with links', () => {
	const backlinks = [
		'---',
		'related: "[[Old note]]"',
		'see:',
		'  - "[[Old note#Head|head]]" # kept',
		'---',
		'[[Old note]] [[Old note|alias]] ![[Old note#Head]] [[Old note#^b]]',
		'[md](Old%20note.md) [path](Folder/Old%20note.md) `[[Old note]]`',
		'[[Other]]',
		'',
	].join('\n');
	const files: Record<string, string> = {
		'Folder/Old note.md': 'Body [[Old note#Head]]\n',
		'Backlinks.md': backlinks,
		'Other.md': '',
		'Folder/Other.md': '',
	};
	const state = { files: Object.keys(files), content: (p: string) => files[p] ?? null };

	it('rewrites every kind of link and leaves code alone', () => {
		const r = renameLinks(state, 'Folder/Old note.md', 'Folder/New note.md', { updateLinks: true, format: 'shortest' });
		expect(r.contents.get('Backlinks.md')).toBe(
			[
				'---',
				'related: "[[New note]]"',
				'see:',
				'  - "[[New note#Head|head]]" # kept',
				'---',
				'[[New note]] [[New note|alias]] ![[New note#Head]] [[New note#^b]]',
				'[md](New%20note.md) [path](New%20note.md) `[[Old note]]`',
				'[[Other]]',
				'',
			].join('\n'),
		);
		// Links that still reach the same file (the note's own, by heading) stay as they are.
		expect(r.contents.get('Folder/Old note.md')).toBe('Body [[New note#Head]]\n');
		expect(r.rewritten.map((c) => [c.path, c.line])).toEqual([
			['Backlinks.md', 1],
			['Backlinks.md', 3],
			['Backlinks.md', 5],
			['Backlinks.md', 5],
			['Backlinks.md', 5],
			['Backlinks.md', 5],
			['Backlinks.md', 6],
			['Backlinks.md', 6],
			['Folder/Old note.md', 0],
		]);
		expect(r.dangling).toEqual([]);
	});

	it('writes the path when the new name is taken elsewhere, for the renamed note and the other', () => {
		const r = renameLinks(state, 'Folder/Old note.md', 'Folder/Other.md', { updateLinks: false, format: 'shortest' });
		expect(r.contents.size).toBe(0);
		const u = renameLinks({ ...state, files: state.files.filter((f) => f !== 'Folder/Other.md') }, 'Folder/Old note.md', 'Folder/Other.md', { updateLinks: true, format: 'shortest' });
		const text = u.contents.get('Backlinks.md') ?? '';
		expect(text).toContain('[[Folder/Other]] [[Folder/Other|alias]]');
		// [[Other]] still reaches Other.md by its exact path, so it stays.
		expect(text).toContain('\n[[Other]]\n');
	});

	it('without link updates, counts the links left pointing nowhere', () => {
		const r = renameLinks(state, 'Folder/Old note.md', 'Folder/New note.md', { updateLinks: false, format: 'shortest' });
		expect(r.contents.size).toBe(0);
		expect(r.rewritten).toEqual([]);
		expect(r.dangling.length).toBe(9);
		expect(r.dangling[0]).toEqual({ path: 'Backlinks.md', line: 1, key: 'related', before: '[[Old note]]', after: null });
	});

	it('only lists vault files it is given', () => {
		expect(all.filter((p) => isVaultFile(p, '.obsidian')).length).toBe(index.files.length);
	});
});
