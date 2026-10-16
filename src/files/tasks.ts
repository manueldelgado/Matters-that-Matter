// Task list items, as Obsidian's cache lists them: any list item whose text starts with `[c] `. Pure.

import { QUOTE, type BodyLine } from './scan';

export interface TaskLine {
	/** 0-based, counted from the top of the note. */
	line: number;
	/** The character between the brackets: ' ' open, 'x' or 'X' done, anything else a custom status. */
	task: string;
}

/** A list item (bullet or numbered, at any depth) holding `[c]` and then a space or the end of the line. */
const TASK = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[([^\]])\](?:[ \t]|$)/;

/** A task item on one line of a note, as Obsidian reads it. */
export interface TaskItem {
	/** What comes before the list marker: blockquote markers and indentation. */
	prefix: string;
	/** Where the character between the brackets is in the line. */
	mark: number;
	/** The character between the brackets: ' ' open, 'x' or 'X' done, anything else a custom status. */
	task: string;
	/** The item's text, trimmed. */
	text: string;
}

/**
 * The task item on a line (in a blockquote too), or null. The one reading of a task every rule uses, so the plugin's
 * checklist, the operations and the index agree. Says nothing about code and comments: callers check those.
 */
export function readTask(line: string): TaskItem | null {
	const text = line.replace(/\r$/, '');
	const quote = QUOTE.exec(text)?.[0] ?? '';
	const m = TASK.exec(text.slice(quote.length));
	if (!m) return null;
	const head = m[0].replace(/[ \t]$/, '');
	return { prefix: quote + (m[1] ?? ''), mark: quote.length + head.length - 2, task: m[2] ?? ' ', text: text.slice(quote.length + m[0].length).trim() };
}

/** Task lines of the body, outside code and comments (HTML and `%%`), in document order. */
export function taskLines(lines: readonly BodyLine[]): TaskLine[] {
	const out: TaskLine[] = [];
	for (const body of lines) {
		if (body.code || body.inComment || body.inObsidianComment) continue;
		const task = readTask(body.text);
		if (task) out.push({ line: body.line, task: task.task });
	}
	return out;
}
