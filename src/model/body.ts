// Note bodies: an Action's details and checklist, and the review notes at the end of a Matter note.
// Edits change only the targeted lines, and repair damaged details markers.

import { indentWidth, scanBody } from '../files/scan';
import { parseMtmDate, type Ymd } from './dates';

// As Obsidian reads it: after an optional byte-order mark (`Vault.process` keeps it), an opening line that is exactly
// `---`, possibly nothing in between, and a closing `---` line that may have spaces or tabs after the dashes.
const FRONTMATTER_RE = /^\uFEFF?---\r?\n(?:---[ \t]*(?:\r?\n|$)|[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/;
const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;
const EMBED_RE = /^\s*!\[/;
const FENCE_RE = /^\s*(```|~~~)/;
// As Obsidian reads a task: the mark and then a space or the end of the line, so "- [1](https://…)" is a link.
const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([^\]])\](?=[ \t]|$)/;

/** Splits off the frontmatter block (with a byte-order mark before it, its delimiters and trailing newline). */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const m = FRONTMATTER_RE.exec(content);
	const frontmatter = m ? m[0] : '';
	return { frontmatter, body: content.slice(frontmatter.length) };
}

/** The frontmatter and the body joined, the body on a line of its own when the block ends the file without a line break. */
const joinBody = (frontmatter: string, body: string) => (frontmatter && body && !frontmatter.endsWith('\n') ? `${frontmatter}\n${body}` : frontmatter + body);

/**
 * The line ending new lines get: the note's first line break, as the properties block is written. Notes written on
 * Windows may use CRLF; a note with mixed endings follows its first line, so one stray CRLF further down never
 * decides for the whole note.
 */
function eolOf(content: string): '\n' | '\r\n' {
	const i = content.indexOf('\n');
	return i > 0 && content[i - 1] === '\r' ? '\r\n' : '\n';
}

/** Text typed or passed in, with every line break as LF (CRLF, or a lone CR, which Obsidian also reads as one). */
const lf = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * Runs an edit written for LF text on a note with any line endings. Lines the edit leaves alone at the start and at
 * the end of the note keep their own ending, so only the targeted lines change; the lines it writes get the note's
 * line ending (`eolOf`).
 */
function keepingEndings(content: string, edit: (content: string) => string): string {
	if (!content.includes('\r\n')) return edit(content);
	const eol = eolOf(content);
	const before = content.split('\n');
	const last = before.length - 1;
	const crlf = before.map((line, i) => i < last && line.endsWith('\r'));
	const plain = before.map((line, i) => (crlf[i] ? line.slice(0, -1) : line));
	const after = edit(plain.join('\n')).split('\n');
	let head = 0;
	while (head < plain.length && head < after.length && plain[head] === after[head]) head++;
	let tail = 0;
	while (tail < plain.length - head && tail < after.length - head && plain[last - tail] === after[after.length - 1 - tail]) tail++;
	const endingOf = (i: number) => (i < last ? (crlf[i] ? '\r\n' : '\n') : eol);
	return after
		.map((line, j) => {
			if (j === after.length - 1) return line;
			if (j < head) return line + endingOf(j);
			if (j >= after.length - tail) return line + endingOf(j - after.length + before.length);
			return line + eol;
		})
		.join('');
}

const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] ?? '').length;

function endsDetails(line: string): boolean {
	return LIST_RE.test(line) || HEADING_RE.test(line) || EMBED_RE.test(line) || FENCE_RE.test(line);
}

/** Index of the first body line that ends the details (list item, heading, embed or code block). */
function detailsEnd(lines: readonly string[]): number {
	const i = lines.findIndex(endsDetails);
	return i < 0 ? lines.length : i;
}

/** For each line: whether it is a code fence or inside a code block. */
function fenced(lines: readonly string[]): boolean[] {
	let fence: string | null = null;
	return lines.map((line) => {
		const f = FENCE_RE.exec(line);
		if (!f) return fence !== null;
		const marker = f[1] ?? '';
		if (fence === null) fence = marker;
		else if (marker === fence) fence = null;
		return true;
	});
}

// ——— Details markers ———
// Details that contain a line the rule above would cut (a list, a heading…) are kept between two comment lines.
// They are recognised by their token alone, at the start of a line and outside code blocks; the rest is a note
// for people reading the file, and is rewritten to the standard wording whenever the plugin writes the body.

export const DETAILS_OPEN = "<!-- mtm-details: the Action's details, as edited in Matters that Matter. Keep this line. -->";
export const DETAILS_CLOSE = '<!-- /mtm-details: end of the details. Write details above this line. -->';
const OPEN_RE = /^<!-- mtm-details(?![\w-])/;
const CLOSE_RE = /^<!-- \/mtm-details(?![\w-])/;

interface Markers {
	/** Body line of the opening marker in use; null when it is missing. */
	open: number | null;
	/** Body line of the closing marker in use; null when it is missing. */
	close: number | null;
	/** Other marker lines, removed on repair. */
	stray: Set<number>;
	/** First details line. */
	start: number;
	/** Line after the last details line: the closing marker, or where a missing one goes. */
	end: number;
}

/**
 * Finds the details markers in body lines. The first opening marker followed by a closing one is the pair in use;
 * without such a pair, the first marker alone decides. A missing closing marker goes after the details as the
 * fallback rule would end them, except that plain list items continue them; a missing opening marker goes at the
 * start of the body.
 */
function findMarkers(lines: readonly string[]): Markers | null {
	const inCode = fenced(lines);
	const found: { line: number; open: boolean }[] = [];
	lines.forEach((line, i) => {
		if (inCode[i]) return;
		if (OPEN_RE.test(line)) found.push({ line: i, open: true });
		else if (CLOSE_RE.test(line)) found.push({ line: i, open: false });
	});
	if (!found.length) return null;
	const first = found.find((m) => m.open);
	const pairClose = first && found.find((m) => !m.open && m.line > first.line);
	let open: number | null = null;
	let close: number | null = null;
	if (first && pairClose) {
		open = first.line;
		close = pairClose.line;
	} else if (found[0]?.open) open = found[0].line;
	else close = found[0]?.line ?? null;
	const stray = new Set(found.map((m) => m.line).filter((i) => i !== open && i !== close));

	let start = 0;
	let end = close ?? lines.length;
	if (open !== null) {
		start = open + 1;
		if (close === null) {
			end = start;
			while (end < lines.length && !ends(end)) end++;
			while (end > start && (stray.has(end - 1) || (lines[end - 1] ?? '').trim() === '')) end--;
		}
	}
	return { open, close, stray, start, end };

	function ends(i: number): boolean {
		const line = lines[i] ?? '';
		return !stray.has(i) && (TASK_RE.test(line) || HEADING_RE.test(line) || EMBED_RE.test(line) || FENCE_RE.test(line));
	}
}

/** Lines from..to (exclusive) without stray markers. */
function pick(lines: readonly string[], m: Markers, from: number, to = lines.length): string[] {
	const out: string[] = [];
	for (let i = from; i < to; i++) if (!m.stray.has(i)) out.push(lines[i] ?? '');
	return out;
}

/**
 * For each line from `from` on: whether a task item there counts, as Obsidian's cache lists them: outside code
 * blocks (fenced or indented) and comments (HTML and `%%`).
 */
function tasksCount(lines: readonly string[], from = 0): boolean[] {
	return scanBody(lines, from).map((l) => !l.code && !l.inComment && !l.inObsidianComment);
}

/** Separates task items (with the lines nested under them) from the other lines, outside code blocks and comments. */
function splitTasks(lines: readonly string[]): { text: string[]; tasks: string[] } {
	const counts = tasksCount(lines);
	const text: string[] = [];
	const tasks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (!counts[i] || !TASK_RE.test(line)) {
			text.push(line);
			continue;
		}
		tasks.push(line);
		const indent = indentOf(line);
		while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== '' && indentOf(lines[i + 1] ?? '') > indent) tasks.push(lines[++i] ?? '');
	}
	return { text, tasks };
}

const dropLeadingBlanks = (lines: string[]) => {
	const i = lines.findIndex((l) => l.trim() !== '');
	return i < 0 ? [] : lines.slice(i);
};

/** Removes `prefix` from the start of `lines` (ignoring blank lines before it) when it is there, line for line. */
function dropPrefix(lines: string[], prefix: readonly string[]): string[] {
	const rest = dropLeadingBlanks(lines);
	if (!prefix.length || prefix.length > rest.length) return rest;
	return prefix.every((p, i) => p.trimEnd() === (rest[i] ?? '').trimEnd()) ? dropLeadingBlanks(rest.slice(prefix.length)) : rest;
}

/** Joins head lines, task items and the rest of the body, with a blank line between them. */
function assemble(head: readonly string[], tasks: readonly string[], rest: readonly string[]): string {
	const out = [...head];
	if (tasks.length) {
		if (out.length) out.push('');
		out.push(...tasks);
	}
	if (!rest.length) return out.length ? `${out.join('\n')}\n` : '';
	// A list right after the moved tasks joins them; anything else needs a blank line, or it would continue the last item.
	if (out.length && !(tasks.length && LIST_RE.test(rest[0] ?? ''))) out.push('');
	return [...out, ...rest].join('\n');
}

/**
 * The Action's details: the lines between the details markers without task items, or, in a note without markers,
 * the body text before the first list item, heading, embed or code block.
 */
export function getDetails(content: string): string {
	const lines = lf(splitFrontmatter(content).body).split('\n');
	const m = findMarkers(lines);
	if (!m) return lines.slice(0, detailsEnd(lines)).join('\n').trim();
	return splitTasks(pick(lines, m, m.start, m.end)).text.join('\n').trim();
}

/**
 * Replaces the details, keeping the frontmatter and everything after them.
 * Text with a line the fallback rule would cut is written between the details markers; a note that has markers
 * keeps them. Task items typed in the details, and any found between the markers, become checklist items just
 * after the details. `previous` is the details text the editor last read or wrote: task items it typed are already
 * there from the last save, so they are replaced rather than added again.
 */
export function setDetails(content: string, details: string, previous?: string): string {
	return keepingEndings(content, (note) => detailsSet(note, lf(details), previous === undefined ? undefined : lf(previous)));
}

function detailsSet(content: string, details: string, previous?: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const lines = body.split('\n');
	const typed = splitTasks(details.trim().split('\n'));
	const text = typed.text.join('\n').trim();
	const textLines = text ? text.split('\n') : [];
	const previousTasks = previous ? splitTasks(previous.trim().split('\n')).tasks : [];
	const m = findMarkers(lines);
	if (!m) {
		const rest = dropPrefix(lines.slice(detailsEnd(lines)), previousTasks);
		const head = textLines.some(endsDetails) ? [DETAILS_OPEN, ...textLines, DETAILS_CLOSE] : textLines;
		return joinBody(frontmatter, assemble(head, typed.tasks, rest));
	}
	const before = pick(lines, m, 0, m.open ?? 0);
	const inside = splitTasks(pick(lines, m, m.start, m.end)).tasks;
	const head = [...before, DETAILS_OPEN, ...textLines, DETAILS_CLOSE];
	const tasks = [...typed.tasks, ...inside];
	const raw = pick(lines, m, m.close !== null ? m.close + 1 : m.end);
	const after = dropPrefix(raw, previousTasks);
	// Nothing moves after the details: the rest of the body stays exactly as it was.
	if (!tasks.length && after.length === dropLeadingBlanks(raw).length) return joinBody(frontmatter, [...head, ...raw].join('\n'));
	return joinBody(frontmatter, assemble(head, tasks, after));
}

/**
 * Repairs damaged details markers: adds a missing one, removes extra ones (their text stays) and restores the
 * standard wording. Notes without markers, or with correct ones, are returned unchanged.
 */
export function repairDetailsMarkers(content: string): string {
	return keepingEndings(content, markersRepaired);
}

function markersRepaired(content: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const lines = body.split('\n');
	const m = findMarkers(lines);
	if (!m) return content;
	const out: string[] = [];
	for (let i = 0; i <= lines.length; i++) {
		if (i === 0 && m.open === null) out.push(DETAILS_OPEN);
		if (i === m.end && m.close === null) out.push(DETAILS_CLOSE);
		if (i === lines.length || m.stray.has(i)) continue;
		out.push(i === m.open ? DETAILS_OPEN : i === m.close ? DETAILS_CLOSE : (lines[i] ?? ''));
	}
	return joinBody(frontmatter, out.join('\n'));
}

/** Line numbers (in the whole file) of task items outside code blocks and comments, between the details markers too. */
export function taskLines(content: string): number[] {
	const lines = content.split('\n').map((line) => line.replace(/\r$/, ''));
	const start = splitFrontmatter(content).frontmatter.split('\n').length - 1;
	const counts = tasksCount(lines, start);
	const out: number[] = [];
	for (let i = start; i < lines.length; i++) if (counts[i - start] && TASK_RE.test(lines[i] ?? '')) out.push(i);
	return out;
}

/**
 * Adds "- [ ] text" after the last top-level task item (and any lines nested under it, sub-items included), at its
 * indentation, or at the end of the body if there is none. Top-level items are the least indented ones, so a
 * checklist under a plain list item ("- Shopping") stays there. `lastTaskLine` (from metadataCache) puts it after
 * that item instead, at its indentation. Damaged details markers are repaired in the same write.
 */
export function insertTask(content: string, text: string, lastTaskLine?: number): string {
	return repairDetailsMarkers(addTask(content, text, lastTaskLine));
}

function addTask(content: string, text: string, lastTaskLine?: number): string {
	return keepingEndings(content, (note) => taskAdded(note, text, lastTaskLine));
}

function taskAdded(content: string, text: string, lastTaskLine?: number): string {
	const item = `- [ ] ${text.replace(/\s+/g, ' ').trim()}`;
	const lines = content.split('\n');
	const width = (i: number) => indentWidth(lines[i] ?? '');
	let last = lastTaskLine;
	if (last === undefined) {
		const tasks = taskLines(content);
		const top = Math.min(...tasks.map(width));
		last = tasks.filter((i) => width(i) === top).at(-1);
	}
	if (last === undefined || last >= lines.length) {
		const { frontmatter, body } = splitFrontmatter(content);
		const trimmed = body.replace(/\s+$/, '');
		return joinBody(frontmatter, trimmed ? `${trimmed}\n\n${item}\n` : `${item}\n`);
	}
	// After the lines nested under it, across blank lines between them.
	let at = last + 1;
	for (let i = last + 1; i < lines.length; i++) {
		if ((lines[i] ?? '').trim() === '') continue;
		if (width(i) <= width(last)) break;
		at = i + 1;
	}
	lines.splice(at, 0, (lines[last] ?? '').slice(0, indentOf(lines[last] ?? '')) + item);
	return lines.join('\n');
}

/** Ticks or unticks the task on a line; unchanged if the line is not a task. */
export function setTaskChecked(content: string, line: number, checked: boolean): string {
	const lines = content.split('\n');
	const current = lines[line];
	if (current === undefined) return content;
	const m = TASK_RE.exec(current);
	if (!m) return content;
	const pos = m[0].length - 2;
	lines[line] = current.slice(0, pos) + (checked ? 'x' : ' ') + current.slice(pos + 1);
	return lines.join('\n');
}

export interface ChecklistItem {
	/** Line number in the whole file. */
	line: number;
	checked: boolean;
	text: string;
}

const TASK_TEXT_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\](?:[ \t](.*))?$/;

/** The task on a line, or null. Any mark other than a space counts as checked, as Obsidian renders it. */
export function parseTask(line: string): { checked: boolean; text: string } | null {
	const m = TASK_TEXT_RE.exec(line.replace(/\r$/, ''));
	if (!m) return null;
	return { checked: m[1] !== ' ', text: (m[2] ?? '').trim() };
}

/** Checklist items on the given lines (from metadataCache list items), or on every task line. */
export function checklistItems(content: string, lines: readonly number[] = taskLines(content)): ChecklistItem[] {
	const all = content.split('\n');
	const out: ChecklistItem[] = [];
	for (const line of lines) {
		const task = parseTask(all[line] ?? '');
		if (task) out.push({ line, ...task });
	}
	return out;
}

/**
 * Ticks or unticks a checklist item. The line may be stale (the note changed since it was read),
 * so it must still hold a task with the same text; otherwise the first task with that text is used.
 * Damaged details markers are repaired in the same write.
 */
export function toggleTask(content: string, line: number, text: string, checked: boolean): string {
	const lines = content.split('\n');
	const matches = (i: number) => parseTask(lines[i] ?? '')?.text === text;
	const target = matches(line) ? line : taskLines(content).find(matches);
	return target === undefined ? content : repairDetailsMarkers(setTaskChecked(content, target, checked));
}

// ——— Review notes ———
// A review can leave one dated line at the end of the Matter note: "- Reviewed 2026-10-09: text". The word stays
// English in notes whatever the interface language, so the line's shape always recognises it.

/** Review notes are capped at this many characters. */
export const REVIEW_NOTE_MAX = 300;
const REVIEW_LINE_RE = /^- Reviewed (\d{4}-\d{2}-\d{2}): (.+)$/;

export interface ReviewNote {
	date: Ymd;
	text: string;
}

/** Line breaks of every kind, and tabs: none of them may stay in a one-line note. */
const NOTE_BREAKS_RE = /[^\S\r\n\t\v\f\u0085\u2028\u2029]*[\r\n\t\v\f\u0085\u2028\u2029]+\s*/g;

/** The text as it is written: trimmed, line breaks and tabs as spaces, capped. Everything else is kept as typed. */
export function cleanReviewNote(text: string): string {
	const flat = text.replace(NOTE_BREAKS_RE, ' ').trim();
	// Capped by characters, not UTF-16 units, so an emoji is never cut in half.
	const chars = Array.from(flat);
	return chars.length > REVIEW_NOTE_MAX ? chars.slice(0, REVIEW_NOTE_MAX).join('').trimEnd() : flat;
}

/** The line a review note is written as, or null when the text is empty. */
export function reviewNoteLine(ymd: Ymd, text: string): string | null {
	const clean = cleanReviewNote(text);
	return clean ? `- Reviewed ${ymd}: ${clean}` : null;
}

/** The review note on a line, or null (other lines, malformed dates, empty text). */
export function parseReviewNote(line: string): ReviewNote | null {
	const m = REVIEW_LINE_RE.exec(line.replace(/\r$/, ''));
	const date = m ? parseMtmDate(m[1]) : null;
	const text = (m?.[2] ?? '').trim();
	return date && !date.time && text ? { date: date.date, text } : null;
}

/** The latest review note in the body (by date, then the later line), or null. Frontmatter and code blocks never count. */
export function latestReviewNote(content: string): ReviewNote | null {
	let latest: ReviewNote | null = null;
	const lines = lf(splitFrontmatter(content).body).split('\n');
	const inCode = fenced(lines);
	for (let i = 0; i < lines.length; i++) {
		if (inCode[i]) continue;
		const note = parseReviewNote(lines[i] ?? '');
		if (note && (!latest || note.date >= latest.date)) latest = note;
	}
	return latest;
}

/** Adds a line after the body's last non-empty line: a blank line first unless that line is a review note; one trailing newline. */
function appendReviewLine(content: string, line: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const lines = body.split('\n');
	let end = lines.length;
	while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
	if (!end) return joinBody(frontmatter, `${line}\n`);
	const kept = lines.slice(0, end);
	const gap = parseReviewNote(kept[end - 1] ?? '') ? [] : [''];
	return joinBody(frontmatter, `${[...kept, ...gap, line].join('\n')}\n`);
}

/** Appends "- Reviewed <ymd>: <text>" at the end of the note. Empty text leaves the note unchanged. */
export function appendReviewNote(content: string, ymd: Ymd, text: string): string {
	const line = reviewNoteLine(ymd, text);
	return line ? keepingEndings(content, (note) => appendReviewLine(note, line)) : content;
}

/**
 * Replaces a review note written earlier (`previous`, the exact line) with a new one, in place: its last occurrence
 * in the body, so an earlier identical note stays. Empty text removes it. When the line isn't there any more
 * (edited or deleted by hand), the new note is appended instead.
 */
export function replaceReviewNote(content: string, previous: string, ymd: Ymd, text: string): string {
	return keepingEndings(content, (note) => reviewNoteReplaced(note, previous, ymd, text));
}

function reviewNoteReplaced(content: string, previous: string, ymd: Ymd, text: string): string {
	const line = reviewNoteLine(ymd, text);
	const { frontmatter, body } = splitFrontmatter(content);
	const lines = body.split('\n');
	let at = -1;
	for (let i = lines.length - 1; i >= 0 && at < 0; i--) if ((lines[i] ?? '').trimEnd() === previous.trimEnd()) at = i;
	if (at < 0) return line ? appendReviewLine(content, line) : content;
	if (line) {
		lines[at] = line;
		return joinBody(frontmatter, lines.join('\n'));
	}
	lines.splice(at, 1);
	// Removing the last note leaves no trailing blank lines behind.
	let end = lines.length;
	while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
	if (end === lines.length || at < end) return joinBody(frontmatter, lines.join('\n'));
	return end ? joinBody(frontmatter, `${lines.slice(0, end).join('\n')}\n`) : frontmatter;
}

/**
 * Adds a line at the end of the body as a paragraph of its own (a blank line before it unless the body is empty),
 * keeping the frontmatter and the note's line ending.
 */
export function appendLine(content: string, line: string): string {
	return keepingEndings(content, (note) => {
		const { frontmatter, body } = splitFrontmatter(note);
		const text = line.replace(/\s+/g, ' ').trim();
		const trimmed = body.replace(/\s+$/, '');
		return joinBody(frontmatter, trimmed ? `${trimmed}\n\n${text}\n` : `${text}\n`);
	});
}
