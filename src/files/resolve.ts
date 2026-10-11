// Which file a link reaches, as Obsidian's metadata cache answers it (`getLinkpathDest`, `getFirstLinkpathDest`),
// over a list of vault paths, and the link text Obsidian writes for a file. Pure.

import { linkpath } from './links';
import type { LinkFormat } from './linkText';
import { byCodeUnit, extensionOf, nameOf, parentOf } from './paths';

/**
 * Files by name, as Obsidian's metadata cache keeps them to resolve links: each name (lower case, extension
 * included) lists its files in the order they were added. A renamed file is added again at the end of its new
 * name's list, as Obsidian does.
 */
export class FileLookup {
	private readonly exact: Set<string>;
	private readonly byName: Map<string, string[]>;

	constructor(paths: Iterable<string>, byName?: Map<string, string[]>) {
		this.exact = new Set(paths);
		if (byName) {
			this.byName = byName;
			return;
		}
		this.byName = new Map();
		for (const path of [...this.exact].sort(byCodeUnit)) {
			const key = nameOf(path).toLowerCase();
			const list = this.byName.get(key);
			if (list) list.push(path);
			else this.byName.set(key, [path]);
		}
	}

	/** Whether the vault has a file at exactly this path. */
	has(path: string): boolean {
		return this.exact.has(path);
	}

	/** How many files carry this file name (extension included), ignoring case. */
	nameCount(name: string): number {
		return this.byName.get(name.toLowerCase())?.length ?? 0;
	}

	/** The lookup after `from` is renamed to `to`. */
	renamed(from: string, to: string): FileLookup {
		const byName = new Map([...this.byName].map(([k, v]) => [k, v.filter((p) => p !== from)] as const));
		const key = nameOf(to).toLowerCase();
		byName.set(key, [...(byName.get(key) ?? []), to]);
		for (const [k, v] of byName) if (v.length === 0) byName.delete(k);
		return new FileLookup([...[...this.exact].filter((p) => p !== from), to], byName);
	}

	/**
	 * Every file a link path (no `#` part) can mean from `sourcePath`, best first (Obsidian's `getLinkpathDest`):
	 *
	 * 1. a path starting with `./` or `../`, taken from the source's folder, wins alone when a file is there;
	 * 2. the exact path (a leading `/` means from the vault root), ignoring case, wins alone; a link with a leading
	 *    `/` reaches nothing else;
	 * 3. otherwise every file whose path ends with the link (a plain suffix, ignoring case: `B/Thing` reaches
	 *    `AB/Thing`), those whose path starts with the source's folder first, shorter paths first.
	 *
	 * An empty link path (`[[#Heading]]`) is the linking note itself.
	 */
	destinations(link: string, sourcePath: string): string[] {
		if (link === '') return this.exact.has(sourcePath) ? [sourcePath] : [];
		if (link.startsWith('file:')) return [];
		let o = link.toLowerCase();
		let name = nameOf(o);
		let list = name.includes('.') ? this.byName.get(name) : undefined;
		if (!list) {
			o = `${link}.md`.toLowerCase();
			name = nameOf(o);
			list = this.byName.get(name);
		}
		if (!list) return [];
		if (name === o && list.length === 1) return [...list];
		let folder = parentOf(sourcePath).toLowerCase();
		if (o.startsWith('./') || o.startsWith('../')) {
			if (o.startsWith('./../')) o = o.slice(2);
			if (o.startsWith('./')) {
				if (folder !== '') folder += '/';
				o = folder + o.slice(2);
			} else {
				while (o.startsWith('../')) {
					o = o.slice(3);
					folder = parentOf(folder);
				}
				if (folder !== '') folder += '/';
				o = folder + o;
			}
			for (const path of list) if (path.toLowerCase() === o) return [path];
		}
		if (o.startsWith('/')) o = o.slice(1);
		for (const path of list) if (path.toLowerCase() === o) return [path];
		if (link.startsWith('/')) return [];
		const near: string[] = [];
		const far: string[] = [];
		for (const path of list) {
			const lower = path.toLowerCase();
			if (lower.endsWith(o)) (lower.startsWith(folder) ? near : far).push(path);
		}
		const byLength = (a: string, b: string) => a.length - b.length;
		return [...near.sort(byLength), ...far.sort(byLength)];
	}

	/**
	 * The link text Obsidian writes for `target` from `sourcePath` (`fileToLinktext`): with `omitMd` (wikilinks) a
	 * note's `.md` is left out, Markdown links keep it.
	 */
	linkText(target: string, sourcePath: string, format: LinkFormat, omitMd: boolean): string {
		const md = extensionOf(target) === 'md';
		const full = md && omitMd ? withoutExtension(target) : target;
		if (format === 'absolute') return full;
		if (format === 'relative') {
			let up = '';
			let folder = parentOf(sourcePath);
			while (folder !== '' && folder !== '/' && !full.startsWith(`${folder}/`)) {
				up = `../${up}`;
				folder = parentOf(folder);
			}
			return full.startsWith(`${folder}/`) ? up + full.slice(folder.length + 1) : up + full;
		}
		const short = md && omitMd ? nameWithoutExtension(target) : nameOf(target);
		const found = this.destinations(linkpath(short), sourcePath);
		return found.length === 1 && found[0] === target ? short : full;
	}
}

/** The path without its extension (any extension), as Obsidian strips it. */
export function withoutExtension(path: string): string {
	const dot = path.lastIndexOf('.');
	return dot <= 0 || dot === path.length - 1 ? path : path.slice(0, dot);
}

/** The file name without its extension. */
export function nameWithoutExtension(path: string): string {
	return withoutExtension(nameOf(path));
}

/**
 * Resolves link paths (links without `#heading`) to the one file Obsidian's `getFirstLinkpathDest` gives: the first
 * of `FileLookup.destinations`. Answers are kept by the linking note's folder and the link path, since the same link
 * from the same folder resolves the same way.
 */
export class LinkResolver {
	private readonly lookup: FileLookup;
	private readonly answers = new Map<string, string | null>();

	constructor(paths: Iterable<string>) {
		this.lookup = new FileLookup(paths);
	}

	/** Whether the vault has a file at exactly this path. */
	has(path: string): boolean {
		return this.lookup.has(path);
	}

	/** How many files carry this file name (extension included), ignoring case. */
	nameCount(name: string): number {
		return this.lookup.nameCount(name);
	}

	/** The file a link path reaches from `sourcePath`, or null. */
	resolve(link: string, sourcePath: string): string | null {
		if (link === '') return this.lookup.has(sourcePath) ? sourcePath : null;
		const key = `${parentOf(sourcePath)}\n${link}`;
		const known = this.answers.get(key);
		if (known !== undefined) return known;
		const answer = this.lookup.destinations(link, sourcePath)[0] ?? null;
		this.answers.set(key, answer);
		return answer;
	}
}
