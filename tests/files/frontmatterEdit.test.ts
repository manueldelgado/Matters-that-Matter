import { describe, expect, it } from 'vitest';
import { editFrontmatter, frontmatterSpan, newNoteContent, obsidianYaml, setFrontmatterString } from '../../src/files/frontmatterEdit';

const SAMPLE = [
	'---',
	'mtm-kind: action',
	'mtm-type: message',
	'mtm-status: waiting',
	'mtm-matter: "[[Kitchen renovation]]"',
	'mtm-due: 2026-10-11',
	'mtm-waiting-on: "[[Charlie Carter]]"',
	'mtm-people:',
	'  - "[[Charlie Carter]]"',
	'mtm-waiting-since: 2026-10-05',
	'mtm-sample: true',
	'---',
	'With the tiles included.',
	'',
].join('\n');

const UNUSUAL = [
	'---',
	'# A comment before the properties',
	'mtm-kind: action',
	'mtm-type: call   # a comment after a value',
	"mtm-status: 'next'",
	'mtm-matter: "[[Kitchen renovation]]"',
	'aliases: [Unusual, "Odd one"]',
	'tags:',
	'- edge',
	'- yaml',
	'note: |',
	'  A block of text',
	'  over two lines.',
	'count: 007',
	'when: 2026-10-09',
	'flag: yes',
	'empty:',
	'mtm-sample: true',
	'---',
	'Body.',
	'',
].join('\n');

describe("Obsidian's style", () => {
	it('writes lists indented, links double-quoted, dates and numbers bare, empty values empty', () => {
		expect(obsidianYaml({ a: '2026-10-15', b: '2026-10-15T10:00', c: '[[x]]', d: ['[[x]]', '[[y]]'], e: 1, f: null, g: '10', h: true })).toBe(
			['a: 2026-10-15', 'b: 2026-10-15T10:00', 'c: "[[x]]"', 'd:', '  - "[[x]]"', '  - "[[y]]"', 'e: 1', 'f:', 'g: "10"', 'h: true', ''].join('\n'),
		);
	});

	it('writes a new note as the plugin does in Obsidian: the block in key order, then the body', () => {
		expect(newNoteContent([['mtm-kind', 'action'], ['mtm-people', ['[[A]]']]], 'Body\n')).toBe('---\nmtm-kind: action\nmtm-people:\n  - "[[A]]"\n---\nBody\n');
		expect(newNoteContent([], 'Body\n')).toBe('Body\n');
	});
});

describe('where the properties block is', () => {
	it('finds it as Obsidian does when it writes', () => {
		expect(frontmatterSpan('---\na: 1\n---\nbody')).toEqual({ from: 4, to: 9, contentStart: 13, eol: '\n' });
		expect(frontmatterSpan('---\r\na: 1\r\n---\r\nbody')).toEqual({ from: 5, to: 11, contentStart: 16, eol: '\r\n' });
		expect(frontmatterSpan('---\n---\n')).toEqual({ from: 4, to: 4, contentStart: 8, eol: '\n' });
		expect(frontmatterSpan('\n---\na: 1\n---\n')).toBeNull();
		expect(frontmatterSpan('---\na: 1\n')).toBeNull();
	});

	it('takes a closing line with spaces or tabs after the dashes, as the index reads it', () => {
		expect(frontmatterSpan('---\na: 1\n--- \t\nbody')).toEqual({ from: 4, to: 9, contentStart: 15, eol: '\n' });
		expect(editFrontmatter('---\na: 1\n--- \t\nbody', { 'mtm-kind': 'action' })).toBe('---\na: 1\nmtm-kind: action\n--- \t\nbody');
	});

	it('never writes before an opening line with spaces after the dashes, which Obsidian reads as no block', () => {
		expect(() => editFrontmatter('---  \na: 1\n---\nbody', { 'mtm-status': 'next' }, [], 'x.md')).toThrow(/not closed/);
	});

	it('never adds a second block before a fence that is never closed', () => {
		expect(() => editFrontmatter('---\nmtm-kind: action\nno closing line\n', { 'mtm-status': 'next' }, [], 'x.md')).toThrow(/not closed/);
		expect(() => editFrontmatter('\uFEFF---  \nmtm-kind: action\n', { 'mtm-status': 'next' }, [], 'x.md')).toThrow(/not closed/);
	});
});

describe('editing properties', () => {
	it('changes a value in place', () => {
		expect(editFrontmatter(SAMPLE, { 'mtm-status': 'done' })).toBe(SAMPLE.replace('mtm-status: waiting', 'mtm-status: done'));
	});

	it('adds new keys after the last mtm- key, in the order given', () => {
		const out = editFrontmatter(SAMPLE, { 'mtm-completed': '2026-10-09', 'mtm-priority': 2 });
		expect(out).toBe(SAMPLE.replace('mtm-sample: true\n', 'mtm-sample: true\nmtm-completed: 2026-10-09\nmtm-priority: 2\n'));
	});

	it('removes keys with their lines, lists included', () => {
		const out = editFrontmatter(SAMPLE, {}, ['mtm-people', 'mtm-waiting-since']);
		expect(out).toBe(SAMPLE.replace('mtm-people:\n  - "[[Charlie Carter]]"\n', '').replace('mtm-waiting-since: 2026-10-05\n', ''));
	});

	it('rewrites a list whole', () => {
		const out = editFrontmatter(SAMPLE, { 'mtm-people': ['[[Charlie Carter]]', '[[Dave Dawson]]'] });
		expect(out).toBe(SAMPLE.replace('  - "[[Charlie Carter]]"\n', '  - "[[Charlie Carter]]"\n  - "[[Dave Dawson]]"\n'));
	});

	it('turns a scalar into a list and back', () => {
		const list = editFrontmatter(SAMPLE, { 'mtm-due': ['a'] });
		expect(list).toContain('mtm-due:\n  - a\nmtm-waiting-on');
		expect(editFrontmatter(list, { 'mtm-due': '2026-10-11' })).toBe(SAMPLE);
	});

	it('leaves a value already as asked byte for byte', () => {
		expect(editFrontmatter(UNUSUAL, { 'mtm-status': 'next', 'mtm-type': 'call' })).toBe(UNUSUAL);
	});

	it('keeps comments, quoting and every other key byte for byte', () => {
		const out = editFrontmatter(UNUSUAL, { 'mtm-type': 'meet', 'mtm-status': 'doing', 'mtm-priority': 2 });
		expect(out).toBe(
			UNUSUAL.replace('mtm-type: call   # a comment', 'mtm-type: meet   # a comment')
				.replace("mtm-status: 'next'", 'mtm-status: doing')
				.replace('mtm-sample: true\n', 'mtm-sample: true\nmtm-priority: 2\n'),
		);
	});

	it('keeps CRLF line endings, in new lines too', () => {
		const crlf = SAMPLE.replace(/\n/g, '\r\n');
		const out = editFrontmatter(crlf, { 'mtm-status': 'done', 'mtm-completed': '2026-10-09', 'mtm-people': ['[[A]]', '[[B]]'] });
		expect(out).not.toMatch(/[^\r]\n/);
		expect(out.replace(/\r\n/g, '\n')).toBe(
			SAMPLE.replace('mtm-status: waiting', 'mtm-status: done')
				.replace('  - "[[Charlie Carter]]"\n', '  - "[[A]]"\n  - "[[B]]"\n')
				.replace('mtm-sample: true\n', 'mtm-sample: true\nmtm-completed: 2026-10-09\n'),
		);
	});

	it('adds a block to a note without one, and removes a block left empty, as Obsidian does', () => {
		expect(editFrontmatter('Body\n', { 'mtm-kind': 'action' })).toBe('---\nmtm-kind: action\n---\nBody\n');
		expect(editFrontmatter('---\nmtm-kind: action\n---\nBody\n', {}, ['mtm-kind'])).toBe('Body\n');
		expect(editFrontmatter('---\n---\nBody\n', { 'mtm-kind': 'action' })).toBe('---\nmtm-kind: action\n---\nBody\n');
	});

	it('adds keys at the end when there is no mtm- key', () => {
		expect(editFrontmatter('---\ntitle: x\n# end\n---\n', { 'mtm-kind': 'action' })).toBe('---\ntitle: x\n# end\nmtm-kind: action\n---\n');
	});

	it('writes a flow mapping whole, as Obsidian does', () => {
		expect(editFrontmatter('---\n{a: 1}\n---\n', { 'mtm-kind': 'action' })).toBe('---\na: 1\nmtm-kind: action\n---\n');
	});

	it('refuses properties that are not valid YAML', () => {
		expect(() => editFrontmatter('---\na: [1\n---\n', { 'mtm-kind': 'action' }, [], 'x.md')).toThrow(/not valid YAML/);
	});

	it('changes nothing when nothing is asked', () => {
		expect(editFrontmatter(UNUSUAL, {}, ['mtm-missing'])).toBe(UNUSUAL);
	});
});

describe('replacing a link in properties', () => {
	const NOTE = ['---', 'related: "[[A]]"', 'see:', '  - "[[A#h|first]]" # kept', '  - "[[B]]"', 'flow: ["[[A]]", x]', '---', ''].join('\n');

	it('replaces the one string, wherever it is', () => {
		expect(setFrontmatterString(NOTE, ['see', '0'], '[[C#h|first]]')).toEqual({ content: NOTE.replace('"[[A#h|first]]"', '"[[C#h|first]]"'), line: 3 });
		expect(setFrontmatterString(NOTE, ['flow', '0'], '[[C]]')?.content).toBe(NOTE.replace('["[[A]]"', '["[[C]]"'));
		expect(setFrontmatterString(NOTE, ['related'], '[[C]]')?.line).toBe(1);
	});

	it('does nothing for a path that names no string', () => {
		expect(setFrontmatterString(NOTE, ['see'], 'x')).toBeNull();
		expect(setFrontmatterString(NOTE, ['nothing', '0'], 'x')).toBeNull();
	});
});
