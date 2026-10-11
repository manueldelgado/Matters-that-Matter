// A note's properties block, read from its text as Obsidian's metadata cache reads it. Pure.

import { parseDocument } from 'yaml';
import { splitFrontmatter } from './fences';

export { lineAt, plainFences, splitFrontmatter, stripBom, type FrontmatterBlock } from './fences';

export type Frontmatter = Record<string, unknown>;

/** What the cache holds for a note's properties. */
export interface FrontmatterInfo {
	/** The properties; null when there is no block, it is empty, or it doesn't parse to a mapping. */
	frontmatter: Frontmatter | null;
	/** The closing line and the offset after it; null whenever `frontmatter` is null. */
	end: { line: number; offset: number } | null;
	/** The first body line: after the block when there is one, even if its YAML doesn't parse. */
	bodyLine: number;
}

/** The note's properties as the cache gives them: YAML 1.2 core schema, so dates stay strings. A byte-order mark is skipped. */
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

/**
 * Parses a properties block; null when it has errors, can't be built (an alias to no anchor, too many aliases) or
 * isn't a mapping: no properties, as Obsidian treats YAML it can't read. Warnings (an unknown tag) stay quiet.
 */
export function parseYaml(yaml: string): Frontmatter | null {
	if (yaml.trim() === '') return null;
	try {
		const doc = parseDocument(yaml, { schema: 'core', prettyErrors: false, logLevel: 'error' });
		if (doc.errors.length > 0) return null;
		const value: unknown = doc.toJS({ maxAliasCount: 100 });
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
		return value as Frontmatter;
	} catch {
		return null;
	}
}
