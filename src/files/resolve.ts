// Which file a link reaches, as Obsidian's `getFirstLinkpathDest` answers it, over a list of vault paths. Pure.

import { byCodeUnit, joinPath, nameOf, parentOf } from './paths';

/**
 * Resolves link paths (links without `#heading`) to files:
 *
 * 1. the exact vault path, with or without `.md`;
 * 2. the path relative to the linking note's folder (`../` and `./` included), ignoring case, so a note in the
 *    same folder wins over one with the same name elsewhere;
 * 3. any file whose path ends with the link, ignoring case: the shortest path first, then code-unit order.
 *
 * An empty link path (`[[#Heading]]`) is the linking note itself.
 */
export class LinkResolver {
	private readonly exact: Set<string>;
	private readonly lower = new Map<string, string>();
	private readonly byName = new Map<string, string[]>();

	constructor(paths: Iterable<string>) {
		this.exact = new Set(paths);
		for (const path of this.exact) {
			const key = path.toLowerCase();
			if (!this.lower.has(key)) this.lower.set(key, path);
			const name = nameOf(key);
			const list = this.byName.get(name);
			if (list) list.push(path);
			else this.byName.set(name, [path]);
		}
		for (const list of this.byName.values()) list.sort(byLength);
	}

	/** Whether the vault has a file at exactly this path. */
	has(path: string): boolean {
		return this.exact.has(path);
	}

	/** How many files carry this file name (extension included), ignoring case. */
	nameCount(name: string): number {
		return this.byName.get(name.toLowerCase())?.length ?? 0;
	}

	/** The file a link path reaches from `sourcePath`, or null. */
	resolve(linkpath: string, sourcePath: string): string | null {
		if (linkpath === '') return this.exact.has(sourcePath) ? sourcePath : null;
		const path = linkpath.startsWith('/') ? linkpath.slice(1) : linkpath;
		if (this.exact.has(path)) return path;
		if (this.exact.has(`${path}.md`)) return `${path}.md`;
		const joined = joinPath(parentOf(sourcePath), path);
		if (joined !== null && joined !== '') {
			const near = this.lower.get(joined.toLowerCase()) ?? this.lower.get(`${joined.toLowerCase()}.md`);
			if (near) return near;
		}
		return this.bySuffix(path);
	}

	/** The shortest path ending with the link (as a whole path segment), ignoring case. */
	private bySuffix(path: string): string | null {
		const suffix = path.toLowerCase();
		const name = nameOf(suffix);
		const candidates = [...(this.byName.get(name) ?? []), ...(this.byName.get(`${name}.md`) ?? [])];
		let best: string | null = null;
		for (const candidate of candidates) {
			const lower = candidate.toLowerCase();
			const matches = [suffix, `${suffix}.md`].some((s) => lower === s || lower.endsWith(`/${s}`));
			if (matches && (best === null || byLength(candidate, best) < 0)) best = candidate;
		}
		return best;
	}
}

/** Shorter paths first, then code-unit order. */
function byLength(a: string, b: string): number {
	return a.length - b.length || byCodeUnit(a, b);
}
