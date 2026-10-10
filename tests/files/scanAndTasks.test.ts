import { describe, expect, it } from 'vitest';
import { indentWidth, maskInline, scanBody, splitLines, unquote } from '../../src/files/scan';
import { taskLines } from '../../src/files/tasks';

const tasks = (text: string, from = 0) => taskLines(scanBody(splitLines(text), from));

describe('scan', () => {
	it('splits on LF, CRLF and a lone CR', () => {
		expect(splitLines('a\nb\r\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
	});

	it('measures indentation with tabs to the next multiple of four', () => {
		expect(indentWidth('\tx')).toBe(4);
		expect(indentWidth('  \tx')).toBe(4);
		expect(indentWidth('     x')).toBe(5);
	});

	it('strips quote markers', () => {
		expect(unquote('> > - [ ] x')).toBe('- [ ] x');
	});

	it('masks code spans and comments without moving columns', () => {
		expect(maskInline('a `b` c', false)).toEqual({ masked: 'a     c', open: false });
		expect(maskInline('a <!-- b', false)).toEqual({ masked: 'a       ', open: true });
		expect(maskInline('b --> c', true)).toEqual({ masked: '      c', open: false });
		expect(maskInline('a \\`b` c', false)).toEqual({ masked: 'a \\`b` c', open: false });
		expect(maskInline('``unclosed', false)).toEqual({ masked: '``unclosed', open: false });
	});

	it('numbers lines from the top of the note and marks fences as code', () => {
		const lines = scanBody(['---', 'a: 1', '---', '```js', 'x', '```', 'y'], 3);
		expect(lines.map((l) => [l.line, l.code])).toEqual([
			[3, true],
			[4, true],
			[5, true],
			[6, false],
		]);
	});

	it('closes a fence only with the same character, at least as long', () => {
		const lines = scanBody(['````', '```', '~~~~', '````', 'out'], 0);
		expect(lines.map((l) => l.code)).toEqual([true, true, true, true, false]);
	});
});

describe('taskLines', () => {
	it('reads every bullet, numbered, nested and quoted task with its status character', () => {
		const text = ['- [ ] a', '- [x] b', '* [X] c', '+ [-] d', '1. [ ] e', '2) [/] f', '\t- [ ] g', '    - [ ] h', '> - [ ] i', '- [ ]'].join('\n');
		expect(tasks(text).map((t) => t.task)).toEqual([' ', 'x', 'X', '-', ' ', '/', ' ', ' ', ' ', ' ']);
	});

	it('skips items without a space after the brackets, empty brackets, plain items and code', () => {
		const text = ['- [ ]Missing space', '- [] no', '- plain', '', 'Text', '', '[ ] no bullet', '```', '- [ ] code', '```', '', '    - [ ] indented code'].join('\n');
		expect(tasks(text)).toEqual([]);
	});

	it('skips tasks inside HTML comments', () => {
		expect(tasks('<!--\n- [ ] hidden\n-->\n- [ ] shown')).toEqual([{ line: 3, task: ' ' }]);
	});

	it('skips tasks inside %% comments, over several lines or on one, and counts those after them', () => {
		expect(tasks('%%\n- [ ] hidden\n%%\n%% - [ ] one line %%\n- [ ] shown %% a note %%\n- [ ] also shown')).toEqual([
			{ line: 4, task: ' ' },
			{ line: 5, task: ' ' },
		]);
	});

	it('ignores %% inside code when tracking comments', () => {
		expect(tasks('`%%`\n- [ ] shown')).toEqual([{ line: 1, task: ' ' }]);
	});
});
