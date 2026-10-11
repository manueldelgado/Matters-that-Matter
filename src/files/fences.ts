// Where a note's properties block sits, found without parsing its YAML (the plugin uses this too, so it stays
// free of the YAML parser). Pure.

/** Where the properties block sits in a note, whether or not its YAML parses. */
export interface FrontmatterBlock {
	/** The YAML between the two `---` lines, line breaks as written. */
	yaml: string;
	/** The closing `---` line (0-based). */
	endLine: number;
	/** The offset just after the closing `---`, before its line break. */
	endOffset: number;
	/** The first line after the block: where the body starts. */
	bodyLine: number;
}

/** The closing line may have spaces or tabs after the dashes; the opening line may not (Obsidian 1.14 reads neither else). */
const CLOSE = /^---[ \t]*$/;
const BOM = '\uFEFF';

/** The text without a leading byte-order mark, as Obsidian reads notes: lines, columns and offsets count from after it. */
export function stripBom(content: string): string {
	return content.startsWith(BOM) ? content.slice(1) : content;
}

/**
 * The properties block: the note's very first line is exactly `---` and a later line is `---`, optionally followed
 * by spaces or tabs. A blank line before the first `---`, spaces after it, or no closing line, means there is no block. A byte-order mark before the first line
 * is skipped; `endOffset` counts from after it.
 */
export function splitFrontmatter(text: string): FrontmatterBlock | null {
	const content = stripBom(text);
	if (!content.startsWith('---')) return null;
	let start = 0;
	let line = 0;
	let yamlStart = -1;
	while (start <= content.length) {
		const { end, next } = lineAt(content, start);
		const text = content.slice(start, end);
		if (line === 0) {
			if (text !== '---' || next < 0) return null;
			yamlStart = next;
		} else if (CLOSE.test(text)) {
			const yaml = start > yamlStart ? content.slice(yamlStart, lineBreakBefore(content, start)) : '';
			return { yaml, endLine: line, endOffset: end, bodyLine: line + 1 };
		}
		if (next < 0) return null;
		start = next;
		line++;
	}
	return null;
}

/**
 * The note with a plain properties block, or null when it already has one (or has none). Obsidian reads a block
 * after a byte-order mark, or closed by a `---` line with spaces or tabs after the dashes, but `processFrontMatter`
 * doesn't find it there and writes a second block in front, leaving the first as text. Dropping the mark and the
 * spaces first lets it edit the block in place; nothing else in the note changes.
 */
export function plainFences(text: string): string | null {
	const block = splitFrontmatter(text);
	if (!block) return null;
	const content = stripBom(text);
	let start = 0;
	for (let line = 0; line < block.endLine; line++) start = lineAt(content, start).next;
	const close = lineAt(content, start);
	if (content === text && close.end - start === 3) return null;
	return content.slice(0, start) + '---' + content.slice(close.end);
}

/** The end of the line starting at `start` (before its break) and the start of the next line, or -1 at the end. */
export function lineAt(content: string, start: number): { end: number; next: number } {
	for (let i = start; i < content.length; i++) {
		const c = content.charCodeAt(i);
		if (c === 10) return { end: i, next: i + 1 };
		if (c === 13) return { end: i, next: content.charCodeAt(i + 1) === 10 ? i + 2 : i + 1 };
	}
	return { end: content.length, next: -1 };
}

/** The offset of the line break that ends the line before `start`. */
function lineBreakBefore(content: string, start: number): number {
	if (start >= 2 && content.charCodeAt(start - 2) === 13 && content.charCodeAt(start - 1) === 10) return start - 2;
	return start - 1;
}
