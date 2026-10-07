// Action note body: details and checklist. Edits change only the targeted lines.

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

function endsDetails(line: string): boolean {
	return LIST_RE.test(line) || HEADING_RE.test(line) || EMBED_RE.test(line) || FENCE_RE.test(line);
}

/** Index of the first body line that ends the details (list item, heading, embed or code block). */
function detailsEnd(lines: readonly string[]): number {
	const i = lines.findIndex(endsDetails);
	return i < 0 ? lines.length : i;
}

/** Body text before the first list item, heading, embed or code block. */
export function getDetails(content: string): string {
	const lines = splitFrontmatter(content).body.split('\n');
	return lines.slice(0, detailsEnd(lines)).join('\n').trim();
}

/** Replaces the details, keeping the frontmatter and everything from the first block on. */
export function setDetails(content: string, details: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const lines = body.split('\n');
	const rest = lines.slice(detailsEnd(lines)).join('\n');
	const text = details.trim();
	if (!text) return frontmatter + rest;
	if (!rest) return `${frontmatter}${text}\n`;
	return `${frontmatter}${text}\n\n${rest}`;
}

/** Line numbers (in the whole file) of task items outside code blocks. */
export function taskLines(content: string): number[] {
	const lines = content.split('\n');
	const start = splitFrontmatter(content).frontmatter.split('\n').length - 1;
	const out: number[] = [];
	let fence: string | null = null;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const f = FENCE_RE.exec(line);
		if (f) {
			const marker = f[1] ?? '';
			if (fence === null) fence = marker;
			else if (marker === fence) fence = null;
			continue;
		}
		if (fence === null && TASK_RE.test(line)) out.push(i);
	}
	return out;
}

const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] ?? '').length;

/**
 * Adds "- [ ] text" after the last task item (and any lines nested under it),
 * or at the end of the body if there is none. `lastTaskLine` may come from metadataCache.
 */
export function insertTask(content: string, text: string, lastTaskLine?: number): string {
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
