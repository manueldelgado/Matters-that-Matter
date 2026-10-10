// Renaming a file and the links that follow it, as Obsidian's "Automatically update internal links" does: every link
// in the vault (body links, embeds, links in properties) that reached a file before the rename and reaches another
// set of files after it, or none, is rewritten to reach the same file as before, with link text computed as Obsidian
// writes it after the rename. Aliases, headings and block parts are kept; Markdown links are URL-encoded. Pure.

import { frontmatterValueLine, setFrontmatterString } from './frontmatterEdit';
import { readFrontmatter, stripBom } from './frontmatter';
import { bodyLinks, frontmatterLinks, linkpath, type LinkRef } from './links';
import type { LinkFormat } from './linkText';
import { byCodeUnit, extensionOf, nameOf, parentOf } from './paths';
import { scanBody, splitLines } from './scan';

// ——— Obsidian's file lookup ———

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

	has(path: string): boolean {
		return this.exact.has(path);
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
	 * Every file a link path (no `#` part) can mean from `sourcePath`, best first (Obsidian's `getLinkpathDest`): an
	 * exact or relative path wins alone; otherwise every file whose path ends with the link, those under the source's
	 * folder first, shorter paths first.
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
function withoutExtension(path: string): string {
	const dot = path.lastIndexOf('.');
	return dot <= 0 || dot === path.length - 1 ? path : path.slice(0, dot);
}

/** The file name without its extension. */
function nameWithoutExtension(path: string): string {
	return withoutExtension(nameOf(path));
}

/** A name as a link shows it: a note's without `.md`, other files' with their extension. */
const shownName = (path: string) => (extensionOf(nameOf(path)) === 'md' ? nameWithoutExtension(path) : nameOf(path));
/** A path as a link shows it: a note's without `.md`. */
const shownPath = (path: string) => (extensionOf(nameOf(path)) === 'md' ? withoutExtension(path) : path);

// ——— Rewriting one link ———

const WIKILINK = /^(!?\[\[)(.*?)(\|(.*))?(]])$/;
const MARKDOWN_LINK = /^(!?\[)(.*?)(]\(\s*)((<[^>]*?>|[^ "]+?)(\s+([^ ]+|"[^"]+"|'[^']+'|\([^']+\)))?)?(\s*\))$/;

/** Whether a link was written as a wikilink or embed (its new link text then leaves `.md` out). */
export function isWikilink(original: string): boolean {
	return WIKILINK.test(original);
}

/**
 * A Markdown link destination: spaces, backslashes and control characters encoded, as Obsidian writes it, and `%`,
 * so a name with a percent sign still reads back as itself (links are percent-decoded when read).
 */
function encodeDestination(link: string): string {
	let out = '';
	for (const c of link) {
		const code = c.charCodeAt(0);
		const control = code === 0 || code === 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
		out += c === '\\' || c === ' ' || c === '%' || control ? encodeURIComponent(c) : c;
	}
	return out;
}

/**
 * A link written again with new link text (`link` is what it held, `newLink` the new target with its `#` part), as
 * Obsidian rewrites it: the alias kept (an alias that was the old name of a path link becomes the new name), a
 * Markdown link's text following the name when it showed the name, angle brackets and titles kept.
 */
export function rewriteLink(original: string, link: string, newLink: string): string {
	const w = WIKILINK.exec(original);
	if (w) {
		const target = w[2] ?? '';
		let alias = w[4] ?? '';
		if (alias) {
			const bar = /\\\|/.test(original) ? '\\|' : '|';
			if (target.includes('/') && nameWithoutExtension(target) === alias.trim()) alias = nameWithoutExtension(linkpath(newLink));
			return `${w[1] ?? ''}${newLink}${bar}${alias}${w[5] ?? ''}`;
		}
		return `${w[1] ?? ''}${newLink}${w[5] ?? ''}`;
	}
	const m = MARKDOWN_LINK.exec(original);
	const destination = !m || !(m[5] ?? '').startsWith('<') ? encodeDestination(newLink) : `<${newLink}>`;
	if (!m) return original.startsWith('!') ? `![](${destination})` : `[](${destination})`;
	let text = m[2] ?? '';
	const shown = text.replace(/\u00A0|\u202F/g, ' ').trim();
	const old = linkpath(link);
	if (shown === shownName(old)) text = shownName(linkpath(newLink));
	else if (shown.includes('/') && shown === shownPath(old)) text = shownPath(linkpath(newLink));
	return `${m[1] ?? ''}${text}${m[3] ?? ''}${destination}${m[6] ?? ''}${m[8] ?? ''}`;
}

// ——— Renaming ———

/** What a rename reads: every file in the vault, and the text of notes. */
export interface RenameState {
	/** Every vault file (any extension), as Obsidian lists them. */
	files: readonly string[];
	/** A note's text, or null. */
	content(path: string): string | null;
}

export interface RenameOptions {
	/** Obsidian's "Automatically update internal links". */
	updateLinks: boolean;
	/** Obsidian's "New link format". */
	format: LinkFormat;
}

/** A link a rename touched or left behind. */
export interface LinkChange {
	/** The note holding the link, as it is named before the rename. */
	path: string;
	/** 0-based line in the note. */
	line: number;
	/** The property holding the link (`see.1`), for links in properties. */
	key?: string;
	before: string;
	/** Null for a link left pointing nowhere. */
	after: string | null;
}

export interface RenameResult {
	/** New text of every note whose links changed, by its path before the rename. */
	contents: Map<string, string>;
	/** Links rewritten. */
	rewritten: LinkChange[];
	/** Links that reached a file before and reach nothing now (only when links aren't updated, or can't be). */
	dangling: LinkChange[];
}

interface Ref {
	source: string;
	link: string;
	original: string;
	/** Body links: where the link starts in the note. */
	offset?: number;
	line: number;
	key?: string;
	before: string[];
}

/** Offsets where each line of a text starts. */
function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 13 && text.charCodeAt(i + 1) === 10) continue;
		if (c === 10 || c === 13) starts.push(i + 1);
	}
	return starts;
}

/** Every link of every note that reaches a file, with what it reaches. */
function collectRefs(state: RenameState, lookup: FileLookup): Ref[] {
	const refs: Ref[] = [];
	for (const source of state.files) {
		if (extensionOf(source) !== 'md') continue;
		const raw = state.content(source);
		if (raw === null) continue;
		// Offsets and lines count from after a byte-order mark, as Obsidian counts them.
		const content = stripBom(raw);
		const info = readFrontmatter(content);
		const body = bodyLinks(scanBody(splitLines(content), info.bodyLine));
		const starts = lineStarts(content);
		const add = (ref: Omit<Ref, 'before'>) => {
			const target = linkpath(ref.link);
			if (target === '') return;
			const before = lookup.destinations(target, source);
			if (before.length > 0) refs.push({ ...ref, before });
		};
		for (const ref of [...body.links, ...body.embeds] as LinkRef[]) {
			add({ source, link: ref.link, original: ref.original, offset: (starts[ref.line] ?? 0) + ref.col, line: ref.line });
		}
		for (const ref of frontmatterLinks(info.frontmatter)) add({ source, link: ref.link, original: ref.original, key: ref.key, line: frontmatterValueLine(content, ref.key.split('.')) ?? 0 });
	}
	return refs;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The link changes a rename of `from` to `to` makes. With `updateLinks`, links whose targets change are rewritten
 * to reach the file they reached before; without it nothing is rewritten and the links left pointing nowhere are
 * listed. The file itself is not moved here.
 */
export function renameLinks(state: RenameState, from: string, to: string, options: RenameOptions): RenameResult {
	const before = new FileLookup(state.files);
	const after = before.renamed(from, to);
	const moved = (path: string) => (path === from ? to : path);
	const refs = collectRefs(state, before);
	const contents = new Map<string, string>();
	const rewritten: LinkChange[] = [];
	const dangling: LinkChange[] = [];
	const body = new Map<string, { start: number; end: number; text: string; ref: Ref }[]>();
	const props = new Map<string, { ref: Ref; text: string }[]>();

	for (const ref of refs) {
		const source = moved(ref.source);
		const { path, subpath } = splitLink(ref.link);
		const now = after.destinations(path, source);
		if (now.length > 0 && sameList(ref.before, now)) continue;
		if (!options.updateLinks) {
			if (now.length === 0) dangling.push(changeOf(ref, null));
			continue;
		}
		const target = moved(ref.before[0] ?? '');
		const newLink = after.linkText(target, source, options.format, isWikilink(ref.original)) + subpath;
		if (newLink === ref.link) {
			if (now.length === 0) dangling.push(changeOf(ref, null));
			continue;
		}
		const text = rewriteLink(ref.original, ref.link, newLink);
		if (ref.offset !== undefined) {
			const list = body.get(ref.source) ?? [];
			list.push({ start: ref.offset, end: ref.offset + ref.original.length, text, ref });
			body.set(ref.source, list);
		} else {
			const list = props.get(ref.source) ?? [];
			list.push({ ref, text });
			props.set(ref.source, list);
		}
	}

	for (const source of new Set([...body.keys(), ...props.keys()])) {
		const raw = state.content(source) ?? '';
		const bom = raw.slice(0, raw.length - stripBom(raw).length);
		let content = stripBom(raw);
		// Body links first, from the end; then properties, which sit before the body.
		const edits = [...(body.get(source) ?? [])].sort((a, b) => b.start - a.start);
		for (const e of edits) {
			if (content.slice(e.start, e.end) !== e.ref.original) continue;
			content = content.slice(0, e.start) + e.text + content.slice(e.end);
			rewritten.push(changeOf(e.ref, e.text));
		}
		for (const { ref, text } of props.get(source) ?? []) {
			const done = setFrontmatterString(content, (ref.key ?? '').split('.'), text, source);
			if (!done) continue;
			content = done.content;
			rewritten.push(changeOf({ ...ref, line: done.line }, text));
		}
		contents.set(source, bom + content);
	}
	const order = (a: LinkChange, b: LinkChange) => byCodeUnit(a.path, b.path) || a.line - b.line;
	return { contents, rewritten: rewritten.sort(order), dangling: dangling.sort(order) };
}

function splitLink(link: string): { path: string; subpath: string } {
	const i = link.indexOf('#');
	return i < 0 ? { path: link, subpath: '' } : { path: link.slice(0, i), subpath: link.slice(i) };
}

function changeOf(ref: Ref, after: string | null): LinkChange {
	return { path: ref.source, line: ref.line, ...(ref.key !== undefined ? { key: ref.key } : {}), before: ref.original, after };
}
