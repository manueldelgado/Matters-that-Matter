// Editing a note's properties as text: set or remove keys while every other byte of the block stays as it was
// (comments, order, quoting, blank lines, other keys). New text is written in Obsidian's own style, the style of
// `FileManager.processFrontMatter`, so a note the plugin wrote reads the same whichever wrote it last. Pure.

import { isMap, isNode, isScalar, isSeq, parseDocument, stringify, visit, type Document, type Node } from 'yaml';
import { lineAt, readFrontmatter, splitFrontmatter, stripBom } from './frontmatter';

/** The options Obsidian writes properties with (`stringifyYaml`). */
export const OBSIDIAN_YAML = { nullStr: '', lineWidth: 0, aliasDuplicateObjects: false } as const;

/** A mapping as Obsidian writes it in a properties block: lists as `  - "[[x]]"`, dates and numbers bare. Ends with a line break. */
export function obsidianYaml(value: Readonly<Record<string, unknown>>): string {
	return stringify(value, null, OBSIDIAN_YAML);
}

/**
 * Why a note's properties can't be edited: `invalid`, they aren't valid YAML or aren't closed; `unsafe`, they use
 * YAML an edit in place can't keep as it reads (anchors, aliases or tags in what changes, or a layout the edit would
 * break), so the edit is refused rather than risk the note's other properties.
 */
export class FrontmatterError extends Error {
	constructor(
		readonly path: string,
		message: string,
		readonly reason: 'invalid' | 'unsafe' = 'invalid',
	) {
		super(message);
		this.name = 'FrontmatterError';
	}
}

function unsafe(path: string): FrontmatterError {
	return new FrontmatterError(
		path,
		`The properties of ${path} use YAML (anchors, aliases, tags or an unusual layout) that the command line can't change safely, so nothing was written. Change them in Obsidian instead.`,
		'unsafe',
	);
}

/**
 * Where the properties block is, found as the index finds it (and Obsidian's cache reads it): the note's first line
 * is `---` (spaces or tabs after it allowed) and a later line is the same; offsets in the text after a byte-order
 * mark, which callers strip first.
 */
export interface FrontmatterSpan {
	/** The first character of the YAML, after the opening line. */
	from: number;
	/** Where the closing line starts (the YAML ends with the line break before it, if any). */
	to: number;
	/** Where the body starts, after the closing line. */
	contentStart: number;
	/** The opening line's line break: the note's line ending. */
	eol: '\n' | '\r\n';
}

export function frontmatterSpan(content: string): FrontmatterSpan | null {
	const block = splitFrontmatter(content);
	if (!block || content.startsWith(BOM)) return null;
	const open = lineAt(content, 0);
	const to = lineStart(content, block.endOffset);
	const close = lineAt(content, to);
	const eol = content.slice(open.end, open.next) === '\r\n' ? '\r\n' : '\n';
	return { from: open.next, to, contentStart: close.next < 0 ? content.length : close.next, eol };
}

/** Whether the note's first line is a `---` fence (so a block the index can't see must not be written over or before). */
function startsWithFence(content: string): boolean {
	return FENCE.test(content.slice(0, lineAt(content, 0).end));
}

const FENCE = /^---[ \t]*$/;
const BOM = '\uFEFF';

/** Text written with `\n`, in the note's line ending. */
export function withEol(text: string, eol: string): string {
	return eol === '\n' ? text : text.replace(/\r?\n/g, eol);
}

/** The offset where the line holding `pos` starts. */
function lineStart(text: string, pos: number): number {
	let i = Math.min(pos, text.length);
	while (i > 0 && text[i - 1] !== '\n' && text[i - 1] !== '\r') i--;
	return i;
}

/** The offset just after the line break ending the line that holds `pos` (the end of the text when there is none). */
function lineEndAfter(text: string, pos: number): number {
	for (let i = Math.max(pos, 0); i < text.length; i++) {
		const c = text[i];
		if (c === '\n') return i + 1;
		if (c === '\r') return text[i + 1] === '\n' ? i + 2 : i + 1;
	}
	return text.length;
}

interface Splice {
	start: number;
	end: number;
	text: string;
}

function applySplices(text: string, splices: Splice[]): string {
	// From the end, so earlier offsets stay valid; at the same start, the wider splice first.
	const sorted = [...splices].sort((a, b) => b.start - a.start || b.end - a.end);
	let out = text;
	for (const s of sorted) out = out.slice(0, s.start) + s.text + out.slice(s.end);
	return out;
}

/** A top-level property and the lines it occupies in the YAML. */
interface Entry {
	key: string;
	/** The start of the key's line. */
	start: number;
	/** After the line break of the value's last line (trailing comment lines after a list stay outside). */
	end: number;
	keyNode: Node;
	value: Node | null;
	/** Where the key starts. */
	keyAt: number;
}

function entriesOf(yaml: string, doc: Document): Entry[] {
	const root = doc.contents;
	if (!isMap(root)) return [];
	const out: Entry[] = [];
	for (const pair of root.items) {
		const key = pair.key as Node | null;
		if (!isScalar(key) || !key.range) continue;
		const value = (pair.value as Node | null) ?? null;
		const valueEnd = Math.max(key.range[1], value?.range?.[1] ?? 0);
		out.push({ key: String(key.value), keyNode: key, start: lineStart(yaml, key.range[0]), end: lineEndAfter(yaml, Math.max(valueEnd - 1, key.range[0])), value, keyAt: key.range[0] });
	}
	// A value never reaches into the next key's line.
	for (let i = 0; i < out.length - 1; i++) {
		const entry = out[i] as Entry;
		entry.end = Math.min(entry.end, (out[i + 1] as Entry).start);
	}
	return out;
}

const INLINE_TYPES = new Set(['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE']);

/** A scalar written on its key's line, which a new one-line value can replace in place (keeping a comment after it). */
function inlineScalar(yaml: string, entry: Entry): [number, number] | null {
	const v = entry.value;
	if (!isScalar(v) || !v.range || !INLINE_TYPES.has(String(v.type)) || v.range[1] <= v.range[0]) return null;
	return /[\r\n]/.test(yaml.slice(entry.keyAt, v.range[1])) ? null : [v.range[0], v.range[1]];
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Parses a properties block as Obsidian does (YAML 1.2, core schema); errors are thrown, as Obsidian refuses to write then. */
function parseBlock(yaml: string, path: string): Document {
	const doc = parseDocument(yaml);
	if (doc.errors.length > 0) throw new FrontmatterError(path, `The properties of ${path} are not valid YAML: ${doc.errors[0]?.message ?? ''}`);
	return doc;
}

/**
 * Sets and removes top-level properties. Keys that exist are changed where they are (a one-line value in place, so
 * a comment after it stays); new keys go after the last `mtm-` key, or at the end, in the order given; removed keys
 * disappear with their lines. A value already as asked is left byte for byte. Nothing else in the note changes.
 * Like Obsidian: a note without properties gets a block at the top, and a block left empty is removed.
 * `undefined` values count as removals.
 */
export function editFrontmatter(text: string, set: Readonly<Record<string, unknown>>, remove: readonly string[] = [], path = ''): string {
	return keepingBom(text, (content) => editBlock(content, set, remove, path));
}

/**
 * Edits the text after a leading byte-order mark and puts the mark back: Obsidian reads properties after it, and
 * the file keeps it.
 */
export function keepingBom(text: string, edit: (content: string) => string): string {
	const content = stripBom(text);
	return text.slice(0, text.length - content.length) + edit(content);
}

function editBlock(content: string, set: Readonly<Record<string, unknown>>, remove: readonly string[], path: string): string {
	const removed = new Set([...remove, ...Object.keys(set).filter((k) => set[k] === undefined)]);
	const entries = Object.entries(set).filter(([k]) => !removed.has(k));
	const span = frontmatterSpan(content);
	if (!span) {
		if (entries.length === 0) return content;
		// A note that opens with a fence the index doesn't read as properties (never closed): adding a block before it
		// would leave two, so the write is refused.
		if (startsWithFence(content)) throw new FrontmatterError(path, `The properties of ${path} are not closed by a --- line`);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		return `---${eol}${withEol(obsidianYaml(Object.fromEntries(entries)), eol)}---${eol}${content}`;
	}
	const { eol } = span;
	const yaml = content.slice(span.from, span.to);
	const doc = parseBlock(yaml, path);
	const root = doc.contents;
	const plain = (doc.toJS({ maxAliasCount: -1 }) ?? {}) as Record<string, unknown>;

	// What the properties must read as afterwards: every other property exactly as before.
	const expected: Record<string, unknown> = isMap(root) ? { ...plain } : {};
	for (const [k, v] of entries) expected[k] = v;
	for (const k of removed) delete expected[k];
	const checked = (out: string): string => {
		if (Object.keys(expected).length > 0 && !sameProperties(readFrontmatter(out).frontmatter, expected)) throw unsafe(path);
		return out;
	};

	// Not a block mapping (a flow mapping, a list, a scalar): written whole, as Obsidian writes it.
	if (root !== null && !(isMap(root) && !root.flow)) {
		if (Object.keys(expected).length === 0) return content.slice(span.contentStart);
		return checked(content.slice(0, span.from) + withEol(obsidianYaml(expected), eol) + content.slice(span.to));
	}

	const all = entriesOf(yaml, doc);
	const byKey = new Map(all.map((e) => [e.key, e]));
	if (entries.length === 0 && ![...removed].some((k) => byKey.has(k))) return content;
	// A mapping indented as a whole: new lines take the same indentation.
	const indent = blockIndent(yaml, all);
	const written = (value: Readonly<Record<string, unknown>>) => withEol(indented(obsidianYaml(value), indent), eol);
	const splices: Splice[] = [];
	const inserts: [string, unknown][] = [];
	let count = isMap(root) ? root.items.length : 0;
	for (const [key, value] of entries) {
		const entry = byKey.get(key);
		if (!entry) {
			inserts.push([key, value]);
			count++;
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(plain, key) && sameValue(plain[key], value)) continue;
		if (marked(entry)) throw unsafe(path);
		const raw = obsidianYaml({ [key]: value });
		const inline = inlineScalar(yaml, entry);
		const oneLine = !raw.slice(0, -1).includes('\n') && raw.startsWith(`${key}: `);
		if (inline && oneLine) splices.push({ start: inline[0], end: inline[1], text: raw.slice(key.length + 2, -1) });
		else splices.push({ start: entry.start, end: entry.end, text: written({ [key]: value }) });
	}
	for (const key of removed) {
		const entry = byKey.get(key);
		if (!entry) continue;
		if (marked(entry)) throw unsafe(path);
		splices.push({ start: entry.start, end: entry.end, text: '' });
		count--;
	}
	if (count === 0) return content.slice(span.contentStart);
	if (inserts.length > 0) {
		const at = all.filter((e) => e.key.startsWith('mtm-')).reduce((max, e) => Math.max(max, e.end), -1);
		const anchor = at < 0 ? yaml.length : at;
		const before = yaml.slice(0, anchor);
		const lead = before !== '' && !before.endsWith('\n') && !before.endsWith('\r') ? eol : '';
		splices.push({ start: anchor, end: anchor, text: lead + written(Object.fromEntries(inserts)) });
	}
	if (splices.length === 0) return content;
	return checked(content.slice(0, span.from) + applySplices(yaml, splices) + content.slice(span.to));
}

/** Whether an entry's key or value carries an anchor or a tag anywhere (an alias elsewhere may lean on it). */
function marked(entry: Entry): boolean {
	let found = false;
	for (const node of [entry.keyNode, entry.value]) {
		if (!node) continue;
		visit(node, (_, n) => {
			if (isNode(n) && (n.anchor || n.tag)) {
				found = true;
				return visit.BREAK;
			}
			return undefined;
		});
		if (found) return true;
	}
	return false;
}

/** The indentation every top-level key shares ('' when they start at the line's start or don't agree). */
function blockIndent(yaml: string, all: readonly Entry[]): string {
	const first = all[0];
	if (!first) return '';
	const indent = yaml.slice(first.start, first.keyAt);
	if (!/^[ \t]+$/.test(indent)) return '';
	return all.every((e) => yaml.slice(e.start, e.keyAt) === indent) ? indent : '';
}

/** Text (lines ending with `\n`) with each line indented. */
function indented(text: string, indent: string): string {
	if (indent === '') return text;
	return text
		.split('\n')
		.map((line) => (line === '' ? line : indent + line))
		.join('\n');
}

/** Whether properties read back as expected: the same keys and values, in any key order. */
function sameProperties(actual: unknown, expected: unknown): boolean {
	if (Object.is(actual, expected)) return true;
	if (Array.isArray(actual) || Array.isArray(expected)) {
		return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((v, i) => sameProperties(v, expected[i]));
	}
	if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return false;
	const a = actual as Record<string, unknown>;
	const b = expected as Record<string, unknown>;
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameProperties(a[k], b[k]));
}

/**
 * A property path: an array of keys (`["see", "1"]`: the second item of `see`), or the dotted name Obsidian gives
 * frontmatter links (`see.1`), whose keys may hold dots themselves (`see.also`).
 */
export type KeyPath = readonly string[] | string;

/**
 * The string scalar at a property path, with the keys that reach it, or null. With `current`, only a string holding
 * that value counts (so of `a.b: x` and `a: {b: y}`, the one meant is found).
 */
function stringNodeAt(doc: Document, keys: KeyPath, current?: string): { node: Node; keys: string[] } | null {
	const fits = (node: unknown): node is Node => isStringScalar(node) && (current === undefined || (node as { value: unknown }).value === current);
	if (typeof keys !== 'string') {
		const node = nodeAt(doc.contents, keys);
		return fits(node) ? { node, keys: [...keys] } : null;
	}
	const parts = keys.split('.');
	// Each key may take one dotted part or several; the first reading that reaches a string wins.
	const walk = (node: unknown, i: number, path: string[]): { node: Node; keys: string[] } | null => {
		if (i === parts.length) return fits(node) ? { node, keys: path } : null;
		if (isSeq(node)) {
			const part = parts[i] ?? '';
			const index = /^\d+$/.test(part) ? Number(part) : -1;
			return index >= 0 && index < node.items.length ? walk(node.items[index], i + 1, [...path, part]) : null;
		}
		if (!isMap(node)) return null;
		for (let j = parts.length; j > i; j--) {
			const key = parts.slice(i, j).join('.');
			const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === key);
			const found = pair ? walk(pair.value, j, [...path, key]) : null;
			if (found) return found;
		}
		return null;
	};
	return walk(doc.contents, 0, []);
}

function isStringScalar(node: unknown): node is Node {
	return isScalar(node) && typeof node.value === 'string' && node.range !== undefined && node.range !== null;
}

/** The node at a property path given as keys, or null. */
function nodeAt(root: unknown, keys: readonly string[]): Node | null {
	let node: unknown = root;
	for (const key of keys) {
		if (isMap(node)) {
			const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === key);
			node = pair ? pair.value : null;
		} else if (isSeq(node)) {
			const i = /^\d+$/.test(key) ? Number(key) : -1;
			node = i >= 0 && i < node.items.length ? node.items[i] : null;
		} else return null;
	}
	return (node as Node | null) ?? null;
}

/** A string value at a property path, with where it is and the keys that reach it. */
function stringAt(content: string, keys: KeyPath, path: string, current?: string): { span: FrontmatterSpan; doc: Document; node: Node & { range: [number, number, number] }; keys: string[]; line: number } | null {
	const span = frontmatterSpan(content);
	if (!span) return null;
	const doc = parseBlock(content.slice(span.from, span.to), path);
	const found = stringNodeAt(doc, keys, current);
	if (!found) return null;
	const node = found.node as Node & { range: [number, number, number] };
	const line = (content.slice(0, span.from + node.range[0]).match(/\r\n|\r|\n/g) ?? []).length;
	return { span, doc, node, keys: found.keys, line };
}

/** The line (0-based, in the note) of a string value at a property path (holding `current`, when given), or null. */
export function frontmatterValueLine(content: string, keys: KeyPath, current?: string): number | null {
	try {
		return stringAt(stripBom(content), keys, '', current)?.line ?? null;
	} catch {
		return null;
	}
}

/**
 * Replaces one string value at a property path (keys, or the dotted name Obsidian gives frontmatter links: `see.1`)
 * with another, written as Obsidian quotes it; every other byte stays. Null when the path names no string (nothing
 * to do). With `current`, only a string holding that value is replaced. Returns the line (0-based, in the note) the
 * value is on.
 */
export function setFrontmatterString(text: string, keys: KeyPath, value: string, path = '', current?: string): { content: string; line: number } | null {
	const content = stripBom(text);
	const bom = text.slice(0, text.length - content.length);
	const done = setString(content, keys, value, path, current);
	return done && { content: bom + done.content, line: done.line };
}

function setString(content: string, keyPath: KeyPath, value: string, path: string, current?: string): { content: string; line: number } | null {
	const found = stringAt(content, keyPath, path, current);
	if (!found) return null;
	const { span, doc, node, keys, line } = found;
	const at = span.from + node.range[0];
	const text = stringify(value, null, OBSIDIAN_YAML).replace(/\n$/, '');
	if (!/[\r\n]/.test(text)) return { content: content.slice(0, at) + text + content.slice(span.from + node.range[1]), line };
	// A value Obsidian would write over several lines: the block is written whole, as Obsidian does.
	const plain = (doc.toJS({ maxAliasCount: -1 }) ?? {}) as Record<string, unknown>;
	let target: unknown = plain;
	for (const key of keys.slice(0, -1)) target = (target as Record<string, unknown>)[key];
	(target as Record<string, unknown>)[keys[keys.length - 1] ?? ''] = value;
	return { content: content.slice(0, span.from) + withEol(obsidianYaml(plain), span.eol) + content.slice(span.to), line };
}

/** A new note's text as Obsidian writes it: the properties block in the given key order, then the body. */
export function newNoteContent(frontmatter: readonly (readonly [string, unknown])[], body: string): string {
	const entries = frontmatter.filter(([, v]) => v !== undefined);
	if (entries.length === 0) return body;
	return `---\n${obsidianYaml(Object.fromEntries(entries))}---\n${body}`;
}
