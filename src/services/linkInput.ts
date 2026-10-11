// What an obsidian:// link brings, made safe to write. Any web page, app or note can open such a link, so everything
// it carries is written as plain text: nothing in it may run, load or link anywhere other than a web address or a
// note when the note is shown. Pure. Obsidian has already decoded the parameters once; they are never decoded again.

import type { AddActionInput } from '../ops/types';

/** Details longer than this are cut (characters, counted before escaping). */
export const DETAILS_LIMIT = 3000;
/** Quick add text and titles: the title itself is capped later, as quick add caps it. */
export const TEXT_LIMIT = 1000;
/** Names, dates and priorities. */
export const NAME_LIMIT = 200;
/** The `link` parameter. */
export const LINK_LIMIT = 2000;
/** Checklist items: how many, and how long each. */
export const CHECKLIST_LIMIT = 50;
export const ITEM_LIMIT = 300;

/** The parameters a link handler receives (Obsidian gives "true" for a parameter without a value). */
export type LinkParams = Readonly<Record<string, string | undefined>>;

// ——— Characters ———

/**
 * Control characters (NUL included) and the marks that reorder or hide text: bidi overrides and isolates,
 * left-to-right and right-to-left marks, the byte order mark, zero-width and invisible spaces, the soft hyphen, the
 * Mongolian vowel separator, interlinear annotation marks, Hangul fillers and tag characters. Tabs and line breaks
 * are handled separately. The zero-width joiner and non-joiner (U+200D, U+200C) stay: emoji and several scripts need
 * them, and they can't hide or reorder anything on their own.
 */
// eslint-disable-next-line no-control-regex -- control characters are what this drops
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;

/** Drops control and direction characters; line breaks become `\n` (or spaces when `lines` is false). */
export function dropControls(text: string, lines: boolean): string {
	const clean = text.replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n').replace(INVISIBLE, '');
	return lines ? clean : clean.replace(/[\n\t]+/g, ' ');
}

/** The first `limit` characters (code points, so a pair of surrogates is never split). */
export function cap(text: string, limit: number): string {
	const chars = Array.from(text);
	return chars.length > limit ? chars.slice(0, limit).join('') : text;
}

// ——— Links in text ———

/** The one kind of destination a Markdown link from a link may keep besides a note: a web address. */
const WEB_LINK = /^https?:\/\//i;
/** Schemes that do something without `//`; any other scheme is inert unless followed by `//`. */
const BARE_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'file', 'obsidian', 'mailto', 'tel', 'blob', 'about']);

const isEscaped = (text: string, at: number): boolean => {
	let n = 0;
	for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) n++;
	return n % 2 === 1;
};

/**
 * The destination after a `](` or `]:` at `from`, as a renderer could read it: any spaces (Unicode ones too) and a
 * `<` skipped, up to a space, `)` or `>`; escapes dropped and percent-encoding decoded where it decodes.
 */
function destinationAt(text: string, from: number): string {
	let i = from;
	while (i < text.length && /\s/u.test(text[i] ?? '')) i++;
	if (text.startsWith('&lt;', i)) i += 4;
	else if (text[i] === '<') i++;
	let end = i;
	while (end < text.length && !/[\s)>]/u.test(text[end] ?? '')) end++;
	const raw = text.slice(i, end).replace(/\\/g, '');
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

/** A destination stays a link only when it is a web address or has no scheme at all (a note); anything else is defused. */
const keepsDestination = (dest: string): boolean => WEB_LINK.test(dest) || !dest.includes(':');

/** Where the `[` that `]` at `close` closes is (brackets balanced, escaped ones ignored), or -1. */
function openingBracket(text: string, close: number): number {
	let depth = 0;
	for (let i = close - 1; i >= 0; i--) {
		const ch = text[i];
		if ((ch !== '[' && ch !== ']') || isEscaped(text, i)) continue;
		if (ch === ']') depth++;
		else if (depth === 0) return i;
		else depth--;
	}
	return -1;
}

/**
 * Markdown links and link definitions lose their brackets (`[x](obsidian://…)` → `\[x\](obsidian://…)`), so they
 * are no longer links, unless their destination is a web address or a note. Anything unclear is defused.
 */
function defuseMarkdownLinks(text: string): string {
	const escapeAt = new Set<number>();
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== ']' || isEscaped(text, i)) continue;
		const next = text[i + 1];
		if (next !== '(' && next !== ':') continue;
		const dest = destinationAt(text, i + 2);
		if (keepsDestination(dest)) continue;
		escapeAt.add(i);
		const open = openingBracket(text, i);
		if (open >= 0) escapeAt.add(open);
	}
	if (!escapeAt.size) return text;
	let out = '';
	for (let i = 0; i < text.length; i++) out += escapeAt.has(i) ? `\\${text[i] ?? ''}` : (text[i] ?? '');
	return out;
}

/**
 * Bare addresses with a scheme other than http(s) (`obsidian://…`, `javascript:…`) get their colon escaped, so
 * nothing turns them into links, wherever they are: inside a web address too, since renderers end web addresses in
 * different places. A renderer may start the scheme anywhere in the run of scheme characters before the colon
 * (`1obsidian://`, `a1javascript:`, `x:obsidian://`), so the whole run is weighed: a colon followed by `//`, or by
 * text after a run that ends in an acting scheme, is escaped unless the run is just http or https.
 */
function defuseBareSchemes(text: string): string {
	// Runs of scheme characters are matched whole: a match can only start where a run starts.
	return text.replace(/([a-z0-9+.-]+):/gi, (whole, run: string, offset: number, all: string) => {
		const lower = run.toLowerCase();
		if (!/[a-z]/.test(lower) || lower === 'http' || lower === 'https') return whole;
		const after = all.slice(offset + whole.length);
		const acting = [...BARE_SCHEMES].some((scheme) => lower.endsWith(scheme));
		const live = after.startsWith('//') || (acting && /^\S/u.test(after));
		return live ? `${run}\\:` : whole;
	});
}

// ——— Text written into a note ———

/**
 * Text written into a note's body (details, checklist items), made inert: HTML and anything that looks like an
 * entity escaped (`<` → `&lt;`, so no tags, comments, autolinks or template tags), backslashes, backticks and dollar
 * signs escaped (no code or query that another plugin runs, no maths), every tilde in a run of
 * three escaped (no fences, in quotes and lists too), comment markers (`%%`) written as `%&#37;`, embeds turned into
 * plain links, lines of dashes escaped (they could pass for frontmatter), Markdown links and bare
 * addresses with a scheme other than http(s) defused. Links to notes and web addresses keep working.
 */
export function inertMarkdown(text: string): string {
	let t = text
		.replace(/\\/g, '\\\\')
		.replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/`/g, '\\`')
		.replace(/~{3,}/g, (run) => run.replace(/~/g, '\\~'))
		.replace(/\$/g, '\\$')
		.replace(/!(?=\[)/g, '\\!')
		.replace(/^([ \t]*)(-{3,}[ \t]*)$/gm, '$1\\$2')
		// A comment marker would hide the rest of the note; written so it shows as typed.
		.replace(/%%/g, '%&#37;');
	t = defuseMarkdownLinks(t);
	t = defuseBareSchemes(t);
	return t;
}

/** Details from a link: control characters dropped, capped, then made inert. */
export function linkDetails(text: string): string {
	return inertMarkdown(cap(dropControls(text, true), DETAILS_LIMIT));
}

/** Checklist items from a link: one per line, each made inert. */
export function linkChecklist(text: string): string[] {
	return dropControls(text, true)
		.split('\n')
		.map((line) => inertMarkdown(cap(line.trim(), ITEM_LIMIT)))
		.filter((line) => line !== '')
		.slice(0, CHECKLIST_LIMIT);
}

/**
 * Quick add text or a title from a link. It only ever becomes a file name (quick add removes its tokens, and file
 * names lose brackets, colons, `<` and `>`), so it keeps its words: control characters go, line breaks become
 * spaces, backticks become apostrophes (a file name can't hold an escape), and links are defused as in the body.
 */
export function linkText(text: string): string {
	const one = cap(dropControls(text, false), TEXT_LIMIT).replace(/`/g, "'");
	return defuseBareSchemes(defuseMarkdownLinks(one)).trim();
}

/** A name, date or priority: one line, no control characters, capped. Only ever matched, never written as given. */
export function linkName(text: string): string {
	return cap(dropControls(text, false), NAME_LIMIT).trim();
}

// ——— Parameters ———

/** A parameter's value; one given without a value ("true") or left empty counts as absent. */
function param(params: LinkParams, key: string): string | undefined {
	const value = params[key];
	return typeof value === 'string' && value !== '' && value !== 'true' ? value : undefined;
}

/**
 * The fields an `mtm-add` link gives, ready for `addAction`: `text`, `title`, `matter`, `status`, `type`,
 * `priority`, `start`, `due`, `waiting-on`, `people` (comma-separated), `details`, `checklist` (one item per line)
 * and `link`. Other parameters are ignored. The link must still name a note or a web address: `addAction` refuses
 * anything else.
 */
export function linkAddInput(params: LinkParams): AddActionInput {
	const input: AddActionInput = {};
	const text = param(params, 'text');
	if (text !== undefined) input.text = linkText(text);
	const title = param(params, 'title');
	if (title !== undefined) input.title = linkText(title);
	for (const key of ['matter', 'status', 'type', 'priority', 'start', 'due'] as const) {
		const value = param(params, key);
		if (value !== undefined) input[key] = linkName(value);
	}
	const waitingOn = param(params, 'waiting-on');
	if (waitingOn !== undefined) input.waitingOn = linkName(waitingOn);
	const people = param(params, 'people');
	if (people !== undefined) input.people = people.split(',').map(linkName).filter(Boolean).slice(0, CHECKLIST_LIMIT);
	const details = param(params, 'details');
	if (details !== undefined) input.details = linkDetails(details);
	const checklist = param(params, 'checklist');
	if (checklist !== undefined) input.checklist = linkChecklist(checklist);
	const link = param(params, 'link');
	if (link !== undefined) input.link = cap(dropControls(link, false), LINK_LIMIT).trim();
	return input;
}

/**
 * The text an `mtm-quick-add` link puts in the dialog (nothing is added until the user presses Enter). Quick add
 * turns it only into a file name, Matter and person names and dates, never into a note's body or a property as
 * written, so it is shown without escapes: control characters go, line breaks become spaces, backticks apostrophes.
 */
export function linkQuickAddText(params: LinkParams): string {
	const text = param(params, 'text');
	return text === undefined ? '' : cap(dropControls(text, false), TEXT_LIMIT).replace(/`/g, "'").trim();
}

// ——— Opening ———

export type OpenRequest =
	| { kind: 'action'; ref: string }
	| { kind: 'matter'; ref: string }
	| { kind: 'board'; ref: string | null };

/**
 * What an `mtm-open` link asks for: an Action note (`file`, a path or a title), a Matter's overview (`matter`) or a
 * board (`board`, a path or a name in the boards folder); with none of them, the board. Obsidian gives every link
 * an `action` parameter of its own (the link's name, `mtm-open`), which hides one of the same name in the link, so
 * an Action is named with `file`, as in Obsidian's own open links.
 */
export function openRequest(params: LinkParams): OpenRequest {
	const action = param(params, 'file') ?? (params.action !== 'mtm-open' ? param(params, 'action') : undefined);
	if (action !== undefined) return { kind: 'action', ref: linkName(action) };
	const matter = param(params, 'matter');
	if (matter !== undefined) return { kind: 'matter', ref: linkName(matter) };
	const board = param(params, 'board');
	return { kind: 'board', ref: board === undefined ? null : linkName(board) };
}

/**
 * A board named by a link: its path (`.base` optional) or its name, among the boards (paths of `.base` files),
 * ignoring case. Several with the same name come back as several.
 */
export function findBoard(ref: string, boards: readonly string[]): { kind: 'match'; path: string } | { kind: 'none' } | { kind: 'several'; paths: string[] } {
	const lower = ref.trim().replace(/^\/+/, '').toLowerCase();
	const withExt = lower.endsWith('.base') ? lower : `${lower}.base`;
	const byPath = boards.find((p) => p.toLowerCase() === withExt);
	if (byPath) return { kind: 'match', path: byPath };
	const byName = boards.filter((p) => (p.split('/').pop() ?? p).toLowerCase() === withExt);
	if (byName.length === 1 && byName[0]) return { kind: 'match', path: byName[0] };
	return byName.length ? { kind: 'several', paths: [...byName].sort() } : { kind: 'none' };
}

// ——— Notices ———

/** Values a notice repeats from a link are cut to about this many characters. */
export const NOTICE_VALUE_LIMIT = 80;

/** A value repeated in a notice: at most `limit` characters, with an ellipsis when cut. */
export function shorten(text: string, limit = NOTICE_VALUE_LIMIT): string {
	const chars = Array.from(text);
	return chars.length > limit ? `${chars.slice(0, limit - 1).join('').trimEnd()}…` : text;
}

/** A message that quotes a value from a link, with that value shortened. */
export function shortenIn(message: string, value: string | undefined): string {
	return value && Array.from(value).length > NOTICE_VALUE_LIMIT ? message.split(value).join(shorten(value)) : message;
}
