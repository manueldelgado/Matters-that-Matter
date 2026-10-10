import { describe, expect, it } from 'vitest';
import { lineAt, parseYaml, readFrontmatter, splitFrontmatter } from '../../src/files/frontmatter';

describe('splitFrontmatter', () => {
	it('finds the block between the first two --- lines', () => {
		const block = splitFrontmatter('---\nmtm-kind: action\n---\nBody\n');
		expect(block).toEqual({ yaml: 'mtm-kind: action', endLine: 2, endOffset: 24, bodyLine: 3 });
	});

	it('keeps CRLF inside the YAML and measures the offset in the text as written', () => {
		const block = splitFrontmatter('---\r\na: 1\r\nb: 2\r\n---\r\nBody');
		expect(block).toEqual({ yaml: 'a: 1\r\nb: 2', endLine: 3, endOffset: 20, bodyLine: 4 });
	});

	it('accepts an empty block and a block at the end of the file', () => {
		expect(splitFrontmatter('---\n---\nText')).toEqual({ yaml: '', endLine: 1, endOffset: 7, bodyLine: 2 });
		expect(splitFrontmatter('---\na: 1\n---')).toEqual({ yaml: 'a: 1', endLine: 2, endOffset: 12, bodyLine: 3 });
	});

	it('finds no block after a blank line, without a closing line, or with text on the opening line', () => {
		expect(splitFrontmatter('\n---\na: 1\n---\n')).toBeNull();
		expect(splitFrontmatter('---\na: 1\n\nText\n')).toBeNull();
		expect(splitFrontmatter('--- a\na: 1\n---\n')).toBeNull();
		expect(splitFrontmatter('----\na: 1\n---\n')).toBeNull();
		expect(splitFrontmatter('---')).toBeNull();
		expect(splitFrontmatter('')).toBeNull();
	});
});

describe('parseYaml', () => {
	it('keeps dates and times as strings and numbers as numbers (YAML 1.2 core schema)', () => {
		expect(parseYaml('a: 2026-10-15\nb: 2026-10-15T10:00\nc: 007\nd: yes\ne: 1.5\nf: ~\ng:')).toEqual({
			a: '2026-10-15',
			b: '2026-10-15T10:00',
			c: 7,
			d: 'yes',
			e: 1.5,
			f: null,
			g: null,
		});
	});

	it('reads unquoted [[links]] as nested lists, as YAML does', () => {
		expect(parseYaml('bare: [[Link target]]')).toEqual({ bare: [['Link target']] });
	});

	it('gives nothing for invalid YAML, an empty block, comments only or a value that is not a mapping', () => {
		expect(parseYaml('a: [next\nb: 1')).toBeNull();
		expect(parseYaml('')).toBeNull();
		expect(parseYaml('# just a comment')).toBeNull();
		expect(parseYaml('- a\n- b')).toBeNull();
		expect(parseYaml('plain text')).toBeNull();
		expect(parseYaml('a: 1\na: 2')).toBeNull();
	});

	it('gives nothing, without throwing, for aliases to no anchor and for alias bombs', () => {
		expect(parseYaml('note: *important*')).toBeNull();
		expect(parseYaml('rating: ***')).toBeNull();
		const bomb = ['a: &a [1, 1, 1, 1, 1, 1, 1, 1, 1]', ...['b', 'c', 'd', 'e'].map((k, i) => `${k}: &${k} [${Array<string>(9).fill(`*${'abcd'[i]}`).join(', ')}]`)].join('\n');
		expect(() => parseYaml(bomb)).not.toThrow();
		expect(parseYaml(bomb)).toBeNull();
	});

	it('reads a value with an unknown tag as its plain value', () => {
		expect(parseYaml('a: !foo bar')).toEqual({ a: 'bar' });
	});
});

describe('readFrontmatter', () => {
	it('returns the properties and the end of the block', () => {
		expect(readFrontmatter('---\nmtm-kind: action\n---\n')).toEqual({ frontmatter: { 'mtm-kind': 'action' }, end: { line: 2, offset: 24 }, bodyLine: 3 });
	});

	it('drops properties and their end when the YAML does not parse, but the body still starts after the block', () => {
		expect(readFrontmatter('---\na: [x\n---\nBody')).toEqual({ frontmatter: null, end: null, bodyLine: 3 });
		expect(readFrontmatter('---\n---\nBody')).toEqual({ frontmatter: null, end: null, bodyLine: 2 });
	});

	it('reads the whole note as body when there is no block', () => {
		expect(readFrontmatter('Just text')).toEqual({ frontmatter: null, end: null, bodyLine: 0 });
	});
});

describe('lineAt', () => {
	it('ends lines at LF, CRLF and a lone CR', () => {
		expect(lineAt('ab\ncd', 0)).toEqual({ end: 2, next: 3 });
		expect(lineAt('ab\r\ncd', 0)).toEqual({ end: 2, next: 4 });
		expect(lineAt('ab\rcd', 0)).toEqual({ end: 2, next: 3 });
		expect(lineAt('ab', 0)).toEqual({ end: 2, next: -1 });
	});
});
