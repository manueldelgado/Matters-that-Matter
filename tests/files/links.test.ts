import { describe, expect, it } from 'vitest';
import { bodyLinks, frontmatterLinks, linkpath, markdownTarget, parseWikilink, shownLink } from '../../src/files/links';
import { scanBody, splitLines } from '../../src/files/scan';

const links = (text: string) => bodyLinks(scanBody(splitLines(text), 0));
const originals = (text: string) => {
	const found = links(text);
	return [...found.links, ...found.embeds].map((l) => l.original);
};

describe('wikilinks', () => {
	it('reads the link, the alias and the shown text', () => {
		expect(parseWikilink('Note')).toEqual({ link: 'Note', displayText: 'Note' });
		expect(parseWikilink('Note|Alias')).toEqual({ link: 'Note', displayText: 'Alias' });
		expect(parseWikilink('Note#Heading')).toEqual({ link: 'Note#Heading', displayText: 'Note > Heading' });
		expect(parseWikilink('Note#^block')).toEqual({ link: 'Note#^block', displayText: 'Note > ^block' });
		expect(parseWikilink('#Heading')).toEqual({ link: '#Heading', displayText: 'Heading' });
		expect(parseWikilink('Note\\|In a table')).toEqual({ link: 'Note', displayText: 'In a table' });
	});

	it('gives each link its line and column, embeds from the !', () => {
		const found = links('First line\nSee [[A]] and ![[B.png]] and [[C|c]].');
		expect(found.links).toEqual([
			{ link: 'A', original: '[[A]]', displayText: 'A', line: 1, col: 4 },
			{ link: 'C', original: '[[C|c]]', displayText: 'c', line: 1, col: 29 },
		]);
		expect(found.embeds).toEqual([{ link: 'B.png', original: '![[B.png]]', displayText: 'B.png', line: 1, col: 14 }]);
	});

	it('takes the innermost link when brackets nest, and skips empty and escaped ones', () => {
		expect(originals('[[a [[b]]')).toEqual(['[[b]]']);
		expect(originals('[[]] and [[ ]]')).toEqual([]);
		expect(originals('\\[\\[x\\]\\] and \\[[y]]')).toEqual([]);
		expect(originals('\\![[z]]')).toEqual(['[[z]]']);
	});

	it('never spans lines', () => {
		expect(originals('[[a\nb]]')).toEqual([]);
	});
});

describe('Markdown links', () => {
	it('decodes the destination, drops angle brackets, keeps headings and titles out', () => {
		expect(markdownTarget('Link%20target.md')).toBe('Link target.md');
		expect(markdownTarget('<Link target.md>')).toBe('Link target.md');
		expect(markdownTarget('100%.md')).toBe('100%.md');
		expect(markdownTarget('https://example.com/a.md')).toBeNull();
		expect(markdownTarget('obsidian://open?x')).toBeNull();
		expect(markdownTarget('mailto:a@b.c')).toBeNull();
		expect(markdownTarget('')).toBeNull();
		const found = links('[t](A%20b.md#Some%20heading "Title") ![alt](<pic one.png>)');
		expect(found.links).toEqual([{ link: 'A b.md#Some heading', original: '[t](A%20b.md#Some%20heading "Title")', displayText: 't', line: 0, col: 0 }]);
		expect(found.embeds).toEqual([{ link: 'pic one.png', original: '![alt](<pic one.png>)', displayText: 'alt', line: 0, col: 37 }]);
	});

	it('is not a link with a space in a bare destination, or with escaped brackets', () => {
		expect(originals('[spaces](Link target.md)')).toEqual([]);
		expect(originals('\\[x](y.md)')).toEqual([]);
		expect(originals('[web](https://example.com)')).toEqual([]);
	});
});

describe('what does not count', () => {
	it('skips code spans, fenced and indented code and HTML comments, but counts %% comments', () => {
		const text = [
			'`[[a]]` and ``x `[[b]]` y`` but [[c]]',
			'```',
			'[[d]]',
			'```',
			'',
			'    [[e]] indented',
			'',
			'<!-- [[f]] --> [[g]]',
			'<!--',
			'[[h]]',
			'--> [[i]]',
			'%% [[j]] %%',
		].join('\n');
		expect(originals(text)).toEqual(['[[c]]', '[[g]]', '[[i]]', '[[j]]']);
	});

	it('runs an unclosed fence to the end of the note', () => {
		expect(originals('~~~\n[[a]]\n```\n[[b]]')).toEqual([]);
	});

	it('reads an indented line under a list item as part of the list, not code', () => {
		expect(originals('- item\n\n    [[a]] continues the item')).toEqual(['[[a]]']);
		expect(originals('Paragraph\n    [[b]] continues the paragraph')).toEqual(['[[b]]']);
	});
});

describe('frontmatterLinks', () => {
	it('finds whole-value links, keyed with list indexes, and ignores links inside text', () => {
		expect(
			frontmatterLinks({
				'mtm-matter': '[[Kitchen|K]]',
				'mtm-people': ['[[Bob]]', 'plain'],
				source: '[t](A%20b.md)',
				inside: 'Before [[X]] after',
				bare: [['X']],
				nested: { deep: '[[Y]]' },
				web: '[w](https://example.com)',
				count: 3,
			}),
		).toEqual([
			{ key: 'mtm-matter', link: 'Kitchen', original: '[[Kitchen|K]]', displayText: 'K' },
			{ key: 'mtm-people.0', link: 'Bob', original: '[[Bob]]', displayText: 'Bob' },
			{ key: 'source', link: 'A b.md', original: '[t](A%20b.md)', displayText: 't' },
			{ key: 'nested.deep', link: 'Y', original: '[[Y]]', displayText: 'Y' },
		]);
		expect(frontmatterLinks(null)).toEqual([]);
	});
});

describe('linkpath and shownLink', () => {
	it('drops the heading or block part', () => {
		expect(linkpath('Note#Heading')).toBe('Note');
		expect(linkpath('#Heading')).toBe('');
		expect(linkpath('Note')).toBe('Note');
		expect(shownLink('a#b#c')).toBe('a > b > c');
	});
});
