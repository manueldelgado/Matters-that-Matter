// The link text Obsidian writes for a file (`fileToLinktext`), in each of its "New link format" settings. Pure.

import { basenameOf, nameOf, parentOf, relativePath, withoutMd } from './paths';

/** Obsidian's `newLinkFormat`: shortest path when possible, relative to the note, or the full path. */
export type LinkFormat = 'shortest' | 'relative' | 'absolute';

export const LINK_FORMATS: readonly LinkFormat[] = ['shortest', 'relative', 'absolute'];

/** Reads a `newLinkFormat` value; anything unknown is Obsidian's default, shortest. */
export function linkFormat(value: unknown): LinkFormat {
	return value === 'relative' || value === 'absolute' ? value : 'shortest';
}

/**
 * The link text from `sourcePath` to `targetPath`, `.md` left out. Shortest: the name alone when no other file
 * in the vault has the same file name (ignoring case), otherwise the full path. Relative: the path from the
 * source's folder, with `../`. Absolute: the full path.
 */
export function fileToLinktext(targetPath: string, sourcePath: string, format: LinkFormat, nameCount: (name: string) => number): string {
	const full = withoutMd(targetPath);
	if (format === 'absolute') return full;
	if (format === 'relative') return relativePath(parentOf(sourcePath), full);
	return nameCount(nameOf(targetPath)) <= 1 ? basenameOf(targetPath) : full;
}
