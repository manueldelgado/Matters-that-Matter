// A note's properties block, read from its text as Obsidian's metadata cache reads it. Pure.

import { parseDocument } from 'yaml';

export type Frontmatter = Record<string, unknown>;

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

/** What the cache holds for a note's properties. */
export interface FrontmatterInfo {
	/** The properties; null when there is no block, it is empty, or it doesn't parse to a mapping. */
	frontmatter: Frontmatter | null;
	/** The closing line and the offset after it; null whenever `frontmatter` is null. */
	end: { line: number; offset: number } | null;
	/** The first body line: after the block when there is one, even if its YAML doesn't parse. */
	bodyLine: number;
}

const FENCE = /^---[ \t]*$/;

/**
 * The properties block: the note's very first line is `---` and a later line is `---`. A blank line
 * before the first `---`, or no closing line, means there is no block.
 */
export function splitFrontmatter(content: string): FrontmatterBlock | null {
	if (!content.startsWith('---')) return null;
	let start = 0;
	let line = 0;
	let yamlStart = -1;
	while (start <= content.length) {
		const { end, next } = lineAt(content, start);
		const text = content.slice(start, end);
		if (line === 0) {
			if (!FENCE.test(text) || next < 0) return null;
			yamlStart = next;
		} else if (FENCE.test(text)) {
			const yaml = start > yamlStart ? content.slice(yamlStart, lineBreakBefore(content, start)) : '';
			return { yaml, endLine: line, endOffset: end, bodyLine: line + 1 };
		}
		if (next < 0) return null;
		start = next;
		line++;
	}
	return null;
}

/** The note's properties as the cache gives them: YAML 1.2 core schema, so dates stay strings. */
export function readFrontmatter(content: string): FrontmatterInfo {
	const block = splitFrontmatter(content);
	if (!block) return { frontmatter: null, end: null, bodyLine: 0 };
	const frontmatter = parseYaml(block.yaml);
	return {
		frontmatter,
		end: frontmatter ? { line: block.endLine, offset: block.endOffset } : null,
		bodyLine: block.bodyLine,
	};
}

/** Parses a properties block; null when it has errors or isn't a mapping. */
export function parseYaml(yaml: string): Frontmatter | null {
	if (yaml.trim() === '') return null;
	const doc = parseDocument(yaml, { schema: 'core', prettyErrors: false });
	if (doc.errors.length > 0) return null;
	const value: unknown = doc.toJS({ maxAliasCount: 100 });
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Frontmatter;
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
