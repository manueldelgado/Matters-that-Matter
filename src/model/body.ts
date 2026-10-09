// Action note body: details and checklist. Edits change only the targeted lines, and repair damaged details markers.

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/;
const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;
const EMBED_RE = /^\s*!\[/;
const FENCE_RE = /^\s*(```|~~~)/;
const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[(.)\]/;

/** Splits off the frontmatter block (with its delimiters and trailing newline). */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const m = FRONTMATTER_RE.exec(content);
	const frontmatter = m ? m[0] : '';
	return { frontmatter, body: content.slice(frontmatter.length) };
}

/** The note's line ending: notes written on Windows may use CRLF; edits keep it. */
const eolOf = (content: string) => (content.includes('\r\n') ? '\r\n' : '\n');

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

export const DETAILS_OPEN = "<!-- mtm-details: the Action's details, as edited in Matters. Keep this line. -->";
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

/** Separates task items (with the lines nested under them) from the other lines, outside code blocks. */
function splitTasks(lines: readonly string[]): { text: string[]; tasks: string[] } {
	const inCode = fenced(lines);
	const text: string[] = [];
	const tasks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (inCode[i] || !TASK_RE.test(line)) {
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
	const lines = splitFrontmatter(content).body.replace(/\r\n/g, '\n').split('\n');
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
	const eol = eolOf(content);
	if (eol !== '\n') return setDetails(content.replace(/\r\n/g, '\n'), details, previous).replace(/\n/g, eol);
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
		return frontmatter + assemble(head, typed.tasks, rest);
	}
	const before = pick(lines, m, 0, m.open ?? 0);
	const inside = splitTasks(pick(lines, m, m.start, m.end)).tasks;
	const head = [...before, DETAILS_OPEN, ...textLines, DETAILS_CLOSE];
	const tasks = [...typed.tasks, ...inside];
	const raw = pick(lines, m, m.close !== null ? m.close + 1 : m.end);
	const after = dropPrefix(raw, previousTasks);
	// Nothing moves after the details: the rest of the body stays exactly as it was.
	if (!tasks.length && after.length === dropLeadingBlanks(raw).length) return frontmatter + [...head, ...raw].join('\n');
	return frontmatter + assemble(head, tasks, after);
}

/**
 * Repairs damaged details markers: adds a missing one, removes extra ones (their text stays) and restores the
 * standard wording. Notes without markers, or with correct ones, are returned unchanged.
 */
export function repairDetailsMarkers(content: string): string {
	const eol = eolOf(content);
	if (eol !== '\n') return repairDetailsMarkers(content.replace(/\r\n/g, '\n')).replace(/\n/g, eol);
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
	return frontmatter + out.join('\n');
}

/** Line numbers (in the whole file) of task items outside code blocks, between the details markers too. */
export function taskLines(content: string): number[] {
	const lines = content.split('\n');
	const start = splitFrontmatter(content).frontmatter.split('\n').length - 1;
	const inCode = fenced(lines.slice(start));
	const out: number[] = [];
	for (let i = start; i < lines.length; i++) if (!inCode[i - start] && TASK_RE.test(lines[i] ?? '')) out.push(i);
	return out;
}

/**
 * Adds "- [ ] text" after the last task item (and any lines nested under it),
 * or at the end of the body if there is none. `lastTaskLine` may come from metadataCache.
 * Damaged details markers are repaired in the same write.
 */
export function insertTask(content: string, text: string, lastTaskLine?: number): string {
	return repairDetailsMarkers(addTask(content, text, lastTaskLine));
}

function addTask(content: string, text: string, lastTaskLine?: number): string {
	const eol = eolOf(content);
	if (eol !== '\n') return addTask(content.replace(/\r\n/g, '\n'), text, lastTaskLine).replace(/\n/g, eol);
	const item = `- [ ] ${text.replace(/\s+/g, ' ').trim()}`;
	const last = lastTaskLine ?? taskLines(content).at(-1);
	const lines = content.split('\n');
	if (last === undefined || last >= lines.length) {
		const { frontmatter, body } = splitFrontmatter(content);
		const trimmed = body.replace(/\s+$/, '');
		return trimmed ? `${frontmatter}${trimmed}\n\n${item}\n` : `${frontmatter}${item}\n`;
	}
	const indent = indentOf(lines[last] ?? '');
	let at = last + 1;
	while (at < lines.length && (lines[at] ?? '').trim() !== '' && indentOf(lines[at] ?? '') > indent) at++;
	lines.splice(at, 0, (lines[last] ?? '').slice(0, indent) + item);
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

const TASK_TEXT_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;

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
