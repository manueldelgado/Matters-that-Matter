import { describe, expect, it } from 'vitest';
import { fileToLinktext, linkFormat } from '../../src/files/linkText';
import { basenameOf, extensionOf, joinPath, parentOf, relativePath, withoutMd } from '../../src/files/paths';
import { FileLookup, LinkResolver } from '../../src/files/resolve';

const FILES = [
	'Inbox.md',
	'MTM/Matters/Inbox.md',
	'MTM/Matters/Kitchen.md',
	'A/Twin.md',
	'A/B/Twin.md',
	'A/B/C/Deep.md',
	'A/Casing.md',
	'A/B/casing.md',
	'Notes/plan.svg',
	'Notes/plan.md',
];
const resolver = new LinkResolver(FILES);
const resolve = (link: string, from = 'Other/Source.md') => resolver.resolve(link, from);

describe('LinkResolver', () => {
	it('takes the exact path first, with or without .md', () => {
		expect(resolve('Inbox')).toBe('Inbox.md');
		expect(resolve('MTM/Matters/Inbox')).toBe('MTM/Matters/Inbox.md');
		expect(resolve('MTM/Matters/Inbox.md')).toBe('MTM/Matters/Inbox.md');
		expect(resolve('/MTM/Matters/Kitchen')).toBe('MTM/Matters/Kitchen.md');
	});

	it('then the path from the linking note\'s folder, ignoring case, ../ and ./ included', () => {
		expect(resolve('Twin', 'A/B/Source.md')).toBe('A/B/Twin.md');
		expect(resolve('Casing', 'A/B/Source.md')).toBe('A/B/casing.md');
		expect(resolve('casing', 'A/Source.md')).toBe('A/Casing.md');
		expect(resolve('../Twin', 'A/B/Source.md')).toBe('A/Twin.md');
		expect(resolve('./C/Deep', 'A/B/Source.md')).toBe('A/B/C/Deep.md');
		expect(resolve('B/Twin', 'A/Source.md')).toBe('A/B/Twin.md');
		expect(resolve('../../../x', 'A/Source.md')).toBeNull();
	});

	it('then the shortest path ending with the link, ignoring case', () => {
		expect(resolve('Twin')).toBe('A/Twin.md');
		expect(resolve('casing')).toBe('A/Casing.md');
		expect(resolve('KITCHEN')).toBe('MTM/Matters/Kitchen.md');
		expect(resolve('B/C/Deep')).toBe('A/B/C/Deep.md');
		expect(resolve('C/Twin')).toBeNull();
		expect(resolve('win')).toBeNull();
	});

	it('reaches other files by their full name and notes before files with the same base name', () => {
		expect(resolve('plan.svg')).toBe('Notes/plan.svg');
		expect(resolve('plan')).toBe('Notes/plan.md');
	});

	it('resolves an empty link path to the linking note itself', () => {
		expect(resolver.resolve('', 'A/Twin.md')).toBe('A/Twin.md');
		expect(resolver.resolve('', 'Missing.md')).toBeNull();
	});

	it('counts file names ignoring case', () => {
		expect(resolver.nameCount('casing.md')).toBe(2);
		expect(resolver.nameCount('Kitchen.md')).toBe(1);
		expect(resolver.nameCount('nothing.md')).toBe(0);
	});
});

describe('LinkResolver as Obsidian resolves links', () => {
	// Observed in Obsidian 1.14.4 with `metadataCache.getFirstLinkpathDest` on exactly these files.
	const observed = new LinkResolver(['QAR/B/Note.md', 'QAR/A/C/Note.md', 'QAR/AB/Thing.md', 'QAR/A/x.md', 'QAR/Z/x.md', 'QAR/A/Solo.md']);
	const cases: [link: string, from: string, expected: string | null][] = [
		['Note', 'QAR/A/x.md', 'QAR/A/C/Note.md'],
		['Note', 'QAR/Z/x.md', 'QAR/B/Note.md'],
		['/Solo', 'QAR/A/x.md', null],
		['/QAR/A/Solo', 'QAR/Z/x.md', 'QAR/A/Solo.md'],
		['B/Thing', 'QAR/Z/x.md', 'QAR/AB/Thing.md'],
		['AB/Thing', 'QAR/Z/x.md', 'QAR/AB/Thing.md'],
		['C/Note', 'QAR/Z/x.md', 'QAR/A/C/Note.md'],
		['Solo', 'QAR/Z/x.md', 'QAR/A/Solo.md'],
		['A/Solo', 'x.md', 'QAR/A/Solo.md'],
		['../B/Note', 'QAR/A/x.md', 'QAR/B/Note.md'],
		['./C/Note', 'QAR/A/x.md', 'QAR/A/C/Note.md'],
	];
	it.each(cases)('%s from %s reaches %s', (link, from, expected) => {
		expect(observed.resolve(link, from)).toBe(expected);
	});

	it('agrees with the file lookup the renames use', () => {
		const lookup = new FileLookup(['QAR/B/Note.md', 'QAR/A/C/Note.md', 'QAR/AB/Thing.md', 'QAR/A/x.md', 'QAR/Z/x.md', 'QAR/A/Solo.md']);
		for (const [link, from, expected] of cases) expect(lookup.destinations(link, from)[0] ?? null).toBe(expected);
	});
});

describe('fileToLinktext', () => {
	const count = (name: string) => resolver.nameCount(name);
	it('shortest: the name when no other file has it, otherwise the full path', () => {
		expect(fileToLinktext('MTM/Matters/Kitchen.md', 'A/x.md', 'shortest', count)).toBe('Kitchen');
		expect(fileToLinktext('A/Twin.md', 'A/x.md', 'shortest', count)).toBe('A/Twin');
		expect(fileToLinktext('A/B/casing.md', 'A/B/x.md', 'shortest', count)).toBe('A/B/casing');
		expect(fileToLinktext('Notes/plan.svg', 'A/x.md', 'shortest', count)).toBe('plan.svg');
	});

	it('relative: from the source\'s folder, without ./', () => {
		expect(fileToLinktext('MTM/Matters/Kitchen.md', 'A/B/x.md', 'relative', count)).toBe('../../MTM/Matters/Kitchen');
		expect(fileToLinktext('A/B/Twin.md', 'A/x.md', 'relative', count)).toBe('B/Twin');
		expect(fileToLinktext('A/Twin.md', 'A/x.md', 'relative', count)).toBe('Twin');
		expect(fileToLinktext('Inbox.md', 'A/x.md', 'relative', count)).toBe('../Inbox');
		expect(fileToLinktext('A/Twin.md', 'Root.md', 'relative', count)).toBe('A/Twin');
	});

	it('absolute: the full path', () => {
		expect(fileToLinktext('A/B/Twin.md', 'x.md', 'absolute', count)).toBe('A/B/Twin');
		expect(fileToLinktext('Notes/plan.svg', 'x.md', 'absolute', count)).toBe('Notes/plan.svg');
	});

	it('reads the format setting, shortest by default', () => {
		expect(linkFormat('relative')).toBe('relative');
		expect(linkFormat('absolute')).toBe('absolute');
		expect(linkFormat(undefined)).toBe('shortest');
		expect(linkFormat('odd')).toBe('shortest');
	});
});

describe('paths', () => {
	it('splits and joins vault paths', () => {
		expect(parentOf('a/b/c.md')).toBe('a/b');
		expect(parentOf('c.md')).toBe('');
		expect(basenameOf('a/b/c.md')).toBe('c');
		expect(basenameOf('a/b/c.svg')).toBe('c.svg');
		expect(extensionOf('a/.hidden')).toBe('');
		expect(extensionOf('a/B.MD')).toBe('md');
		expect(withoutMd('a/b.md')).toBe('a/b');
		expect(joinPath('a/b', '../c/./d')).toBe('a/c/d');
		expect(joinPath('', '..')).toBeNull();
		expect(relativePath('a/b', 'a/c/d')).toBe('../c/d');
		expect(relativePath('', 'a/b')).toBe('a/b');
		expect(relativePath('a/b', 'a/b/c')).toBe('c');
	});
});
