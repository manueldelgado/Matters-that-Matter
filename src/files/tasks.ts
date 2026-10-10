// Task list items, as Obsidian's cache lists them: any list item whose text starts with `[c] `. Pure.

import { unquote, type BodyLine } from './scan';

export interface TaskLine {
	/** 0-based, counted from the top of the note. */
	line: number;
	/** The character between the brackets: ' ' open, 'x' or 'X' done, anything else a custom status. */
	task: string;
}

/** A list item (bullet or numbered, at any depth, in quotes too) holding `[c]` and then a space or the end of the line. */
const TASK = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([^\]])\](?:[ \t]|$)/;

/** Task lines of the body, outside code and HTML comments, in document order. */
export function taskLines(lines: readonly BodyLine[]): TaskLine[] {
	const out: TaskLine[] = [];
	for (const body of lines) {
		if (body.code || body.inComment) continue;
		const m = TASK.exec(unquote(body.text));
		if (m) out.push({ line: body.line, task: m[1] ?? ' ' });
	}
	return out;
}
