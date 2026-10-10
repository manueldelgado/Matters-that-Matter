import { describe, expect, it } from 'vitest';
import { cacheJson, cacheShape, sortKeys } from '../../src/files/cacheShape';
import { isVaultFile, readLinkConfig, VaultIndex } from '../../src/files/index';
import { filesSnapshot } from '../../src/files/snapshot';
import { DEFAULT_SETTINGS } from '../../src/settings';

const VAULT: Record<string, string> = {
	'.obsidian/app.json': '{"newLinkFormat":"relative","alwaysUpdateLinks":true}',
	'.obsidian/plugins/x/data.json': '{}',
	'.trash/Old.md': '[[Gone]]',
	'.hidden/Note.md': '',
	'Folder/.DS_Store': '',
	'Matters/Kitchen.md': '---\nmtm-kind: matter\n---\nIdeas in [[Ideas]].\n',
	'Actions/Order.md': '---\nmtm-kind: action\nmtm-matter: "[[Kitchen]]"\n---\nSee [[Ideas#Wood]], [[Nowhere]], [x](Nowhere.md) and ![[plan.svg]].\n\n- [ ] Measure\n',
	'Notes/Ideas.md': 'No properties. [[#Top]]',
	'Notes/plan.svg': '<svg/>',
};
const reader = { list: () => Object.keys(VAULT), read: (path: string) => VAULT[path] ?? null };

describe('isVaultFile', () => {
	it('leaves out the configuration folder, .trash and anything hidden', () => {
		expect(isVaultFile('Notes/a.md', '.obsidian')).toBe(true);
		expect(isVaultFile('.obsidian/app.json', '.obsidian')).toBe(false);
		expect(isVaultFile('.trash/a.md', '.obsidian')).toBe(false);
		expect(isVaultFile('a/.b/c.md', '.obsidian')).toBe(false);
		expect(isVaultFile('a/.DS_Store', '.obsidian')).toBe(false);
		expect(isVaultFile('config/a.md', 'config')).toBe(false);
		expect(isVaultFile('configs/a.md', 'config')).toBe(true);
	});
});

describe('readLinkConfig', () => {
	it('reads app.json and falls back to Obsidian\'s defaults', () => {
		expect(readLinkConfig(reader, '.obsidian')).toEqual({ alwaysUpdateLinks: true, newLinkFormat: 'relative', useMarkdownLinks: false });
		expect(readLinkConfig({ read: () => null }, '.obsidian')).toEqual({ alwaysUpdateLinks: false, newLinkFormat: 'shortest', useMarkdownLinks: false });
		expect(readLinkConfig({ read: () => 'not json' }, '.obsidian')).toEqual({ alwaysUpdateLinks: false, newLinkFormat: 'shortest', useMarkdownLinks: false });
		expect(
			readLinkConfig({
				read: () => {
					throw new Error('missing');
				},
			}, '.obsidian'),
		).toEqual({ alwaysUpdateLinks: false, newLinkFormat: 'shortest', useMarkdownLinks: false });
	});
});

describe('VaultIndex', () => {
	const index = new VaultIndex(reader, { configDir: '.obsidian' });

	it('lists files and notes in code-unit order', () => {
		expect(index.files).toEqual(['Actions/Order.md', 'Matters/Kitchen.md', 'Notes/Ideas.md', 'Notes/plan.svg']);
		expect(index.notePaths).toEqual(['Actions/Order.md', 'Matters/Kitchen.md', 'Notes/Ideas.md']);
	});

	it('holds each note\'s properties, body links and tasks', () => {
		expect(index.note('Actions/Order.md')?.frontmatter).toEqual({ 'mtm-kind': 'action', 'mtm-matter': '[[Kitchen]]' });
		expect(index.note('Notes/Ideas.md')?.frontmatter).toBeNull();
		expect(index.body('Actions/Order.md')?.links.map((l) => l.link)).toEqual(['Ideas#Wood', 'Nowhere', 'Nowhere.md']);
		expect(index.body('Actions/Order.md')?.embeds.map((l) => l.link)).toEqual(['plan.svg']);
		expect(index.body('Actions/Order.md')?.tasks).toEqual([{ line: 6, task: ' ' }]);
		expect(index.note('Missing.md')).toBeNull();
		expect(index.body('Missing.md')).toBeNull();
		expect(index.content('Missing.md')).toBeNull();
	});

	it('counts resolved and unresolved links from the body, embeds and properties', () => {
		expect(index.resolvedLinks('Actions/Order.md')).toEqual({ 'Notes/Ideas.md': 1, 'Notes/plan.svg': 1, 'Matters/Kitchen.md': 1 });
		expect(index.unresolvedLinks('Actions/Order.md')).toEqual({ Nowhere: 2 });
		expect(index.resolvedLinks('Notes/Ideas.md')).toEqual({ 'Notes/Ideas.md': 1 });
	});

	it('writes link text in the vault\'s format unless told otherwise', () => {
		expect(index.linkText('Matters/Kitchen.md', 'Actions/Order.md')).toBe('../Matters/Kitchen');
		expect(index.linkText('Matters/Kitchen.md', 'Actions/Order.md', 'shortest')).toBe('Kitchen');
	});

	it('knows files and folders ignoring case', () => {
		expect(index.existsIgnoringCase('notes/ideas.md')).toBe(true);
		expect(index.existsIgnoringCase('NOTES')).toBe(true);
		expect(index.existsIgnoringCase('Notes/Other.md')).toBe(false);
		expect(index.has('notes/ideas.md')).toBe(false);
	});
});

describe('cacheShape', () => {
	it('sorts keys at every level and turns undefined into null', () => {
		expect(JSON.stringify(sortKeys({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } }))).toBe('{"a":{"c":[{"y":2,"z":1}],"d":null},"b":1}');
	});

	it('produces the dump\'s shape, with link text from every Action in each format', () => {
		const shape = cacheShape(new VaultIndex(reader, { configDir: '.obsidian' }), (path) => `hash of ${path}`);
		expect(Object.keys(shape)).toEqual(['config', 'files', 'linkText', 'notes']);
		expect(Object.keys(shape.linkText)).toEqual(['absolute', 'relative', 'shortest']);
		expect(shape.linkText.shortest).toEqual({ 'Actions/Order.md': { 'Actions/Order.md': 'Order', 'Matters/Kitchen.md': 'Kitchen', 'Notes/Ideas.md': 'Ideas' } });
		expect(shape.notes['Actions/Order.md']?.sha256).toBe('hash of Actions/Order.md');
		expect(shape.notes['Actions/Order.md']?.links[0]).toEqual({ col: 4, dest: 'Notes/Ideas.md', displayText: 'Ideas > Wood', line: 4, link: 'Ideas#Wood', original: '[[Ideas#Wood]]' });
		expect(cacheJson(shape).endsWith('}\n')).toBe(true);
	});
});

describe('filesSnapshot', () => {
	it('gives the operations the notes, body links, resolution and link text', () => {
		const now = new Date(2026, 9, 9, 12);
		const s = filesSnapshot(new VaultIndex(reader, { configDir: '.obsidian' }), DEFAULT_SETTINGS, now);
		expect(s.now).toBe(now);
		expect(s.notes.map((n) => [n.path, n.basename])).toEqual([
			['Actions/Order.md', 'Order'],
			['Matters/Kitchen.md', 'Kitchen'],
			['Notes/Ideas.md', 'Ideas'],
		]);
		expect(s.notes[2]?.frontmatter).toBeUndefined();
		expect(s.links('Actions/Order.md')).toEqual(['Ideas#Wood', 'Nowhere', 'Nowhere.md']);
		expect(s.resolve('Kitchen', 'Actions/Order.md')).toBe('Matters/Kitchen.md');
		expect(s.resolve('Ideas#Wood', 'Actions/Order.md')).toBe('Notes/Ideas.md');
		expect(s.linkText('Notes/Ideas.md', 'Actions/Order.md')).toBe('../Notes/Ideas');
		expect(s.exists('actions')).toBe(true);
		expect(s.content('Notes/Ideas.md')).toBe('No properties. [[#Top]]');
	});
});
