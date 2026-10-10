// Links in a note as Obsidian's metadata cache lists them: wikilinks, embeds and Markdown links in the body,
// and properties whose whole value is a link. Pure.

import type { Frontmatter } from './frontmatter';
import type { BodyLine } from './scan';

/** A link or embed in the body; fields as Obsidian's cache names them. */
export interface LinkRef {
	/** The target as written, decoded for Markdown links: a path or name, with any `#heading` or `#^block`. */
	link: string;
	/** The link exactly as it appears in the note, `!` included for embeds. */
	original: string;
	/** The alias or Markdown link text; for a bare wikilink, the target with `#` shown as ` > `. */
	displayText: string;
	line: number;
	/** In UTF-16 code units, where the link starts (at `!` for embeds). */
	col: number;
}

/** A property whose value is a link; list items are keyed `key.0`, `key.1`… */
export interface FrontmatterLinkRef {
	key: string;
	link: string;
	original: string;
	displayText: string;
}

export interface BodyLinks {
	links: LinkRef[];
	embeds: LinkRef[];
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_LINK = /(!?)\[([^[\]\n]*)\]\([ \t]*(<[^<>\n]*>|[^\s<>()]*(?:\([^\s()]*\)[^\s<>()]*)*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*\)/g;
const WHOLE_MARKDOWN_LINK = new RegExp(`^${MARKDOWN_LINK.source}$`);

/** The link without its `#heading` or `#^block` part: what is resolved to a file. */
export function linkpath(link: string): string {
	const i = link.indexOf('#');
	return i < 0 ? link : link.slice(0, i);
}

/** How Obsidian shows a bare link: `Note#Heading` as `Note > Heading`, `#Heading` as `Heading`. */
export function shownLink(link: string): string {
	return link
		.split('#')
		.filter((part) => part !== '')
		.join(' > ');
}

/** The inside of `[[…]]`: the link and what it shows. A `\|` (a pipe escaped in a table) also starts the alias. */
export function parseWikilink(inner: string): { link: string; displayText: string } {
	const bar = inner.indexOf('|');
	if (bar < 0) {
		const link = inner.trim();
		return { link, displayText: shownLink(link) };
	}
	let target = inner.slice(0, bar);
	if (target.endsWith('\\')) target = target.slice(0, -1);
	return { link: target.trim(), displayText: inner.slice(bar + 1) };
}

/** A Markdown link's destination as the cache stores it: angle brackets removed, percent-decoded. Null for web addresses and other schemes. */
export function markdownTarget(destination: string): string | null {
	const raw = destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination;
	if (raw === '' || SCHEME.test(raw)) return null;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

/** Links and embeds in the body lines (from `scanBody`), in document order. */
export function bodyLinks(lines: readonly BodyLine[]): BodyLinks {
	const links: LinkRef[] = [];
	const embeds: LinkRef[] = [];
	for (const body of lines) {
		if (body.code || !body.masked.includes('[')) continue;
		const found = lineLinks(body.text, body.masked, body.line);
		for (const ref of found) (ref.original.startsWith('!') ? embeds : links).push(ref);
	}
	return { links, embeds };
}

/** Links in one line; `masked` blanks what doesn't count (code spans, comments). */
export function lineLinks(text: string, masked: string, line: number): LinkRef[] {
	const out: LinkRef[] = [];
	const chars = masked.split('');
	let i = masked.indexOf('[[');
	while (i >= 0) {
		const close = masked.indexOf(']]', i + 2);
		if (close < 0) break;
		const inner = masked.slice(i + 2, close);
		const nested = inner.indexOf('[[');
		if (nested >= 0) {
			i = i + 2 + nested;
			continue;
		}
		if (escaped(masked, i) || inner.trim() === '') {
			i = masked.indexOf('[[', i + 1);
			continue;
		}
		const embed = i > 0 && masked[i - 1] === '!' && !escaped(masked, i - 1);
		const start = embed ? i - 1 : i;
		const end = close + 2;
		const { link, displayText } = parseWikilink(text.slice(i + 2, close));
		out.push({ link, original: text.slice(start, end), displayText, line, col: start });
		for (let k = start; k < end; k++) chars[k] = ' ';
		i = masked.indexOf('[[', end);
	}
	const rest = chars.join('');
	for (const m of rest.matchAll(MARKDOWN_LINK)) {
		const at = m.index ?? 0;
		const bracket = at + (m[1] ? 1 : 0);
		if (escaped(rest, bracket) || (m[1] && escaped(rest, at))) continue;
		const textEnd = bracket + 1 + (m[2]?.length ?? 0);
		let destAt = textEnd + 2;
		while (rest[destAt] === ' ' || rest[destAt] === '\t') destAt++;
		const target = markdownTarget(text.slice(destAt, destAt + (m[3]?.length ?? 0)));
		if (target === null) continue;
		const displayText = text.slice(bracket + 1, textEnd);
		out.push({ link: target, original: text.slice(at, at + m[0].length), displayText, line, col: at });
	}
	return out.sort((a, b) => a.col - b.col);
}

/** Whether the character at `index` is escaped by an odd run of backslashes. */
function escaped(text: string, index: number): boolean {
	let n = 0;
	for (let k = index - 1; k >= 0 && text[k] === '\\'; k--) n++;
	return n % 2 === 1;
}

/** Properties whose whole value is a wikilink or a Markdown link, nested values keyed with dots. */
export function frontmatterLinks(frontmatter: Frontmatter | null): FrontmatterLinkRef[] {
	const out: FrontmatterLinkRef[] = [];
	const visit = (key: string, value: unknown) => {
		if (typeof value === 'string') {
			const ref = valueLink(value);
			if (ref) out.push({ key, ...ref });
		} else if (Array.isArray(value)) {
			value.forEach((item, index) => visit(`${key}.${index}`, item));
		} else if (value !== null && typeof value === 'object') {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(`${key}.${k}`, v);
		}
	};
	if (frontmatter) for (const [key, value] of Object.entries(frontmatter)) visit(key, value);
	return out;
}

/** A property value that is one link and nothing else. */
export function valueLink(value: string): { link: string; original: string; displayText: string } | null {
	if (value.startsWith('[[') && value.endsWith(']]')) {
		const inner = value.slice(2, -2);
		if (inner.includes('[[') || inner.includes(']]') || inner.trim() === '') return null;
		return { ...parseWikilink(inner), original: value };
	}
	const m = WHOLE_MARKDOWN_LINK.exec(value);
	if (!m || m[1]) return null;
	const link = markdownTarget(m[3] ?? '');
	if (link === null) return null;
	return { link, original: value, displayText: m[2] ?? '' };
}
