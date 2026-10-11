// Renaming a file and the links that follow it, as Obsidian's "Automatically update internal links" does: every link
// in the vault (body links, embeds, links in properties) that reached a file before the rename and reaches another
// set of files after it, or none, is rewritten to reach the same file as before, with link text computed as Obsidian
// writes it after the rename. Aliases, headings and block parts are kept; Markdown links are URL-encoded. Pure.

import { frontmatterValueLine, setFrontmatterString } from './frontmatterEdit';
import { readFrontmatter, stripBom } from './frontmatter';
import { bodyLinks, frontmatterLinks, linkpath, type LinkRef } from './links';
import type { LinkFormat } from './linkText';
import { byCodeUnit, extensionOf, nameOf } from './paths';
import { FileLookup, nameWithoutExtension, withoutExtension } from './resolve';
import { scanBody, splitLines } from './scan';

export { FileLookup } from './resolve';

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
		for (const ref of frontmatterLinks(info.frontmatter)) add({ source, link: ref.link, original: ref.original, key: ref.key, line: frontmatterValueLine(content, ref.key, ref.original) ?? 0 });
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
	const props = new Map<string, { ref: Ref; text: string; target: string }[]>();

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
			list.push({ ref, text, target });
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
		const unwritten: { ref: Ref; target: string }[] = [];
		for (const { ref, text, target } of props.get(source) ?? []) {
			const done = setFrontmatterString(content, ref.key ?? '', text, source, ref.original);
			if (!done) {
				unwritten.push({ ref, target });
				continue;
			}
			content = done.content;
			rewritten.push(changeOf({ ...ref, line: done.line }, text));
		}
		// A value that can't be written where it was read (an alias, say) may follow one that was; one that now
		// reaches anything else is a link left behind.
		if (unwritten.length > 0) {
			const now = frontmatterLinks(readFrontmatter(content).frontmatter);
			for (const { ref, target } of unwritten) {
				const link = now.find((l) => l.key === ref.key)?.link;
				const reached = link === undefined ? null : (after.destinations(splitLink(link).path, moved(source))[0] ?? null);
				if (reached !== target) dangling.push(changeOf(ref, null));
			}
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
