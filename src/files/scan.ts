// Which parts of a note's body Obsidian reads links and tasks from: everything except code (fenced, indented,
// inline) and HTML comments. Obsidian's own `%%` comments count, as its cache shows. Pure.

/** One line of the body, with what doesn't count blanked out. */
export interface BodyLine {
	/** 0-based, counted from the top of the note. */
	line: number;
	text: string;
	/** The same length as `text`, with code spans and HTML comments replaced by spaces; all spaces on code lines. */
	masked: string;
	/** A line of a fenced or indented code block (fences included). */
	code: boolean;
	/** The line starts inside an HTML comment. */
	inComment: boolean;
	/** The line starts inside an Obsidian `%%` comment: its links count, its tasks don't (as Obsidian's cache has it). */
	inObsidianComment: boolean;
}

const LINE_BREAK = /\r\n|\r|\n/;
const QUOTE = /^(?: {0,3}>[ \t]?)+/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/** The lines of a note, split as Obsidian splits them (LF, CRLF or a lone CR). */
export function splitLines(content: string): string[] {
	return content.split(LINE_BREAK);
}

/** Columns of leading whitespace, tabs to the next multiple of four. */
export function indentWidth(text: string): number {
	let width = 0;
	for (const c of text) {
		if (c === ' ') width++;
		else if (c === '\t') width += 4 - (width % 4);
		else break;
	}
	return width;
}

/** Strips blockquote markers (`> `, `>> `…) from the start of a line. */
export function unquote(text: string): string {
	return text.replace(QUOTE, '');
}

/** The body lines from `fromLine` on, classified and masked. */
export function scanBody(lines: readonly string[], fromLine: number): BodyLine[] {
	const out: BodyLine[] = [];
	let fence: { char: string; size: number } | null = null;
	let inComment = false;
	let inObsidianComment = false;
	let inList = false;
	let prevBlank = true;
	let prevIndentedCode = false;
	for (let line = fromLine; line < lines.length; line++) {
		const text = lines[line] ?? '';
		const startsInComment = inComment;
		if (fence) {
			const close = FENCE.exec(unquote(text));
			if (close && close[2]?.[0] === fence.char && (close[2]?.length ?? 0) >= fence.size && (close[3] ?? '').trim() === '') fence = null;
			out.push(codeLine(line, text));
			prevBlank = false;
			prevIndentedCode = false;
			continue;
		}
		if (!inComment) {
			const inner = unquote(text);
			const blank = inner.trim() === '';
			const indent = indentWidth(inner);
			const open = FENCE.exec(inner);
			if (open && (indent <= 3 || inList) && !(open[2]?.[0] === '`' && (open[3] ?? '').includes('`'))) {
				fence = { char: open[2]?.[0] ?? '`', size: open[2]?.length ?? 3 };
				out.push(codeLine(line, text));
				prevBlank = false;
				prevIndentedCode = false;
				continue;
			}
			if (!blank && indent >= 4 && !inList && (prevBlank || prevIndentedCode)) {
				out.push(codeLine(line, text));
				prevBlank = false;
				prevIndentedCode = true;
				continue;
			}
			if (LIST_ITEM.test(inner)) inList = true;
			else if (!blank && indent === 0 && prevBlank) inList = false;
			prevBlank = blank;
			prevIndentedCode = false;
		} else {
			prevBlank = false;
			prevIndentedCode = false;
		}
		const { masked, open } = maskInline(text, inComment);
		inComment = open;
		const startsInObsidianComment = inObsidianComment;
		if (countMarks(masked) % 2 === 1) inObsidianComment = !inObsidianComment;
		out.push({ line, text, masked, code: false, inComment: startsInComment, inObsidianComment: startsInObsidianComment });
	}
	return out;
}

function codeLine(line: number, text: string): BodyLine {
	return { line, text, masked: ' '.repeat(text.length), code: true, inComment: false, inObsidianComment: false };
}

/** How many `%%` marks a (masked) line holds, each pair of characters counted once. */
function countMarks(masked: string): number {
	let n = 0;
	for (let i = masked.indexOf('%%'); i >= 0; i = masked.indexOf('%%', i + 2)) n++;
	return n;
}

/** Blanks code spans and HTML comments in one line; `inComment` carries a comment over from the line before. */
export function maskInline(text: string, inComment: boolean): { masked: string; open: boolean } {
	if (!inComment && !text.includes('`') && !text.includes('<!--')) return { masked: text, open: false };
	const chars = text.split('');
	const blank = (from: number, to: number) => {
		for (let k = from; k < to; k++) chars[k] = ' ';
	};
	let i = 0;
	if (inComment) {
		const end = text.indexOf('-->');
		if (end < 0) return { masked: ' '.repeat(text.length), open: true };
		blank(0, end + 3);
		i = end + 3;
	}
	while (i < text.length) {
		const c = text[i];
		if (c === '\\') {
			i += 2;
			continue;
		}
		if (c === '`') {
			let run = 1;
			while (text[i + run] === '`') run++;
			const close = closingRun(text, i + run, run);
			if (close < 0) {
				i += run;
				continue;
			}
			blank(i, close + run);
			i = close + run;
			continue;
		}
		if (c === '<' && text.startsWith('<!--', i)) {
			const end = text.indexOf('-->', i + 4);
			if (end < 0) {
				blank(i, text.length);
				return { masked: chars.join(''), open: true };
			}
			blank(i, end + 3);
			i = end + 3;
			continue;
		}
		i++;
	}
	return { masked: chars.join(''), open: false };
}

/** The start of the next run of exactly `size` backticks at or after `from`, or -1. */
function closingRun(text: string, from: number, size: number): number {
	let i = from;
	while (i < text.length) {
		if (text[i] !== '`') {
			i++;
			continue;
		}
		let run = 1;
		while (text[i + run] === '`') run++;
		if (run === size) return i;
		i += run;
	}
	return -1;
}
