// The index in the normalised shape of a dump of Obsidian's metadata cache, so the two can be compared. Pure.

import type { VaultIndex } from './index';
import { linkpath, type LinkRef } from './links';
import { LINK_FORMATS } from './linkText';
import { byCodeUnit } from './paths';

export interface CacheRef {
	link: string;
	original: string;
	displayText: string | null;
	line: number;
	col: number;
	dest: string | null;
}

export interface CacheNote {
	sha256?: string;
	frontmatter: Record<string, unknown> | null;
	frontmatterEnd: { line: number; offset: number } | null;
	links: CacheRef[];
	embeds: CacheRef[];
	frontmatterLinks: { key: string; link: string; original: string; displayText: string | null; dest: string | null }[];
	tasks: { line: number; task: string }[];
	resolvedLinks: Record<string, number>;
	unresolvedLinks: Record<string, number>;
}

export interface CacheShape {
	config: { alwaysUpdateLinks: boolean; newLinkFormat: string; useMarkdownLinks: boolean };
	files: string[];
	notes: Record<string, CacheNote>;
	/** Format → Action → note → link text. */
	linkText: Record<string, Record<string, Record<string, string>>>;
}

/**
 * Everything the dump holds: the link settings, the file list, each note's cache entry, and the link text from
 * every Action (a note with `mtm-kind: action`) to every note in each link format. Keys are sorted in code-unit
 * order at every level; `sha256` gives each note's hash when the caller has one.
 */
export function cacheShape(index: VaultIndex, sha256?: (path: string) => string | undefined): CacheShape {
	const notes: Record<string, CacheNote> = {};
	const actions: string[] = [];
	for (const path of index.notePaths) {
		const note = index.note(path);
		const body = index.body(path);
		if (!note || !body) continue;
		if (note.frontmatter?.['mtm-kind'] === 'action') actions.push(path);
		const ref = (l: LinkRef): CacheRef => ({ ...l, dest: index.resolve(linkpath(l.link), path) });
		const hash = sha256?.(path);
		notes[path] = {
			...(hash === undefined ? {} : { sha256: hash }),
			frontmatter: note.frontmatter,
			frontmatterEnd: note.frontmatterEnd,
			links: body.links.map(ref).sort(byPosition),
			embeds: body.embeds.map(ref).sort(byPosition),
			frontmatterLinks: note.frontmatterLinks
				.map((l) => ({ ...l, dest: index.resolve(linkpath(l.link), path) }))
				.sort((a, b) => byCodeUnit(a.key, b.key) || byCodeUnit(a.original, b.original)),
			tasks: [...body.tasks].sort((a, b) => a.line - b.line),
			resolvedLinks: index.resolvedLinks(path),
			unresolvedLinks: index.unresolvedLinks(path),
		};
	}
	const linkText: CacheShape['linkText'] = {};
	for (const format of LINK_FORMATS) {
		const texts: Record<string, Record<string, string>> = (linkText[format] = {});
		for (const source of actions) {
			const row: Record<string, string> = (texts[source] = {});
			for (const target of index.notePaths) row[target] = index.linkText(target, source, format);
		}
	}
	return sortKeys({ config: { ...index.config }, files: [...index.files], notes, linkText }) as CacheShape;
}

/** The shape as the dump writes it: tab-indented JSON and a final line break. */
export function cacheJson(shape: CacheShape): string {
	return `${JSON.stringify(sortKeys(shape), null, '\t')}\n`;
}

/** Sorts object keys in code-unit order, recursively; undefined becomes null. */
export function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value !== null && typeof value === 'object') {
		const object = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(object)
				.sort(byCodeUnit)
				.map((key) => [key, sortKeys(object[key])]),
		);
	}
	return value === undefined ? null : value;
}

function byPosition(a: CacheRef, b: CacheRef): number {
	return a.line - b.line || a.col - b.col;
}
