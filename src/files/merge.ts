// Three versions of one note merged into one, for a note two writers changed apart (two devices offline, say): the
// last version both started from, and each writer's. Properties merge key by key, the body line by line, and what
// both changed differently keeps the later writer's value, or both texts, with a decision saying so. Pure.

import { DETAILS_CLOSE, DETAILS_OPEN, getDetails, repairDetailsMarkers } from '../model/body';
import { stripBom } from './fences';
import { editFrontmatter } from './frontmatterEdit';
import { parseYaml, splitFrontmatter, type Frontmatter } from './frontmatter';
import { readTask } from './tasks';

export interface MergeInput {
	/**
	 * The version both writers started from, or null when there is none to hand (a new device): then whatever is the
	 * same on both sides is kept, and whatever differs counts as changed on both.
	 */
	base: string | null;
	ours: string;
	theirs: string;
	/** The side written later: it wins where both changed the same thing differently. */
	later: 'ours' | 'theirs';
}

/** What the merge chose where both sides changed the same thing; nothing is lost without one of these. */
export type MergeDecision =
	/** A property both changed to different values: the later value was kept. */
	| { kind: 'property'; key: string; kept: unknown; lost: unknown }
	/** The details both changed: both texts were kept, the later first. */
	| { kind: 'details'; kept: string; also: string }
	/** Other lines both changed in the same place: both versions were kept, the later first. */
	| { kind: 'lines'; kept: string[]; also: string[] };

export interface MergeResult {
	content: string;
	decisions: MergeDecision[];
}

/** Derived keys follow the key (or keys) that decide them: the side whose value of those won gives theirs too. */
const DERIVED: Readonly<Record<string, readonly string[]>> = {
	'mtm-completed': ['mtm-status'],
	'mtm-waiting-since': ['mtm-waiting-on'],
	'mtm-order': ['mtm-status', 'mtm-matter'],
};

/** List properties merged as sets: what either side added, minus what either removed. */
const SETS = new Set(['mtm-people']);

/** Above this many line pairs the body isn't compared line by line: the later side's body is kept, and the other's lines too. */
const MAX_PAIRS = 4_000_000;

type Side = 'ours' | 'theirs';
/** Which side a merged value came from: one of them, or `both` where they agree or neither changed it. */
type Took = Side | 'both';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeNote(input: MergeInput): MergeResult {
	const { later } = input;
	const earlier: Side = later === 'ours' ? 'theirs' : 'ours';
	const reference = input.base ?? input.ours;
	// Line endings and a byte-order mark stay as the version both started from had them.
	const bom = reference.length !== stripBom(reference).length ? '\uFEFF' : '';
	const eol = /\r\n/.test(reference) ? '\r\n' : '\n';
	const plain = (text: string) => stripBom(text).replace(/\r\n?/g, '\n');
	const texts = { base: input.base === null ? null : plain(input.base), ours: plain(input.ours), theirs: plain(input.theirs) };

	const parts = { base: texts.base === null ? null : notePart(texts.base), ours: notePart(texts.ours), theirs: notePart(texts.theirs) };
	const decisions: MergeDecision[] = [];
	let content: string;
	if ([parts.base, parts.ours, parts.theirs].some((p) => p?.unreadable)) {
		// Properties no one can read: the whole note merges as lines.
		content = mergeLines(texts.base === null ? null : lines(texts.base), lines(texts.ours), lines(texts.theirs), later, decisions).join('\n');
	} else {
		// A base without properties is a base with none, not a missing base.
		const baseProperties = parts.base === null ? null : (parts.base.frontmatter ?? {});
		const properties = mergeProperties(baseProperties, parts.ours.frontmatter ?? {}, parts.theirs.frontmatter ?? {}, later, decisions);
		const laterPart = parts[later];
		const target = laterPart.frontmatter ?? {};
		const set: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(properties)) if (!same(target[key], value)) set[key] = value;
		const remove = Object.keys(target).filter((key) => !(key in properties));
		const head = Object.keys(set).length || remove.length ? editFrontmatter(laterPart.head, set, remove) : laterPart.head;

		const bodyBase = parts.base === null ? null : lines(parts.base.body);
		const body = mergeLines(bodyBase, lines(parts.ours.body), lines(parts.theirs.body), later, decisions);
		content = joinHead(head, body.join('\n'));
		// Both changed the details and both texts were kept: the decision says so in the details' own terms, in place of
		// the line decisions within them.
		const details = { base: input.base === null ? null : getDetails(texts.base ?? ''), ours: getDetails(texts.ours), theirs: getDetails(texts.theirs) };
		const merged = getDetails(content);
		const range = detailsRange(body, merged);
		const within = decisions.filter((d) => {
			const span = spans.get(d);
			return d.kind === 'lines' && span !== undefined && range !== null && span[0] >= range[0] && span[1] <= range[1];
		});
		if (within.length && details.ours !== details.base && details.theirs !== details.base) {
			const kept = later === 'ours' ? details.ours : details.theirs;
			const also = earlier === 'ours' ? details.ours : details.theirs;
			decisions.splice(0, decisions.length, ...decisions.filter((d) => !within.includes(d)), { kind: 'details', kept, also });
		}
	}
	// Two writers' details markers met: the extra ones go, their text stays.
	content = repairDetailsMarkers(content);
	return { content: bom + (eol === '\n' ? content : content.replace(/\n/g, eol)), decisions };
}

/** Where each line decision's lines are in the merged body: from, to (exclusive). */
const spans = new WeakMap<MergeDecision, [number, number]>();

/** The lines of the merged body that hold its details (`details`, as `getDetails` reads them), or null. */
function detailsRange(body: readonly string[], details: string): [number, number] | null {
	const open = body.indexOf(DETAILS_OPEN);
	const close = body.indexOf(DETAILS_CLOSE);
	if (open >= 0 && close > open) return [open + 1, close];
	const want = details.split('\n');
	for (let i = 0; i + want.length <= body.length; i++) if (want.every((l, k) => body[i + k] === l)) return [i, i + want.length];
	return null;
}

// ——— The parts of a note ———

interface NotePart {
	/** The properties block with its line break, or '' when there is none. */
	head: string;
	frontmatter: Frontmatter | null;
	body: string;
	/** A properties block whose YAML doesn't parse. */
	unreadable: boolean;
}

function notePart(text: string): NotePart {
	const block = splitFrontmatter(text);
	if (!block) return { head: '', frontmatter: null, body: text, unreadable: false };
	const frontmatter = block.yaml.trim() === '' ? {} : parseYaml(block.yaml);
	if (!frontmatter) return { head: '', frontmatter: null, body: text, unreadable: true };
	// The block with its closing line and that line's break.
	const nl = text.indexOf('\n', block.endOffset);
	const cut = nl < 0 ? text.length : nl + 1;
	return { head: text.slice(0, cut), frontmatter, body: text.slice(cut), unreadable: false };
}

const lines = (text: string) => text.split('\n');

/** The properties block and the body, the body on a line of its own. */
function joinHead(head: string, body: string): string {
	if (!head) return body;
	return head.endsWith('\n') || body === '' ? head + body : `${head}\n${body}`;
}

// ——— Properties ———

function mergeProperties(base: Frontmatter | null, ours: Frontmatter, theirs: Frontmatter, later: Side, decisions: MergeDecision[]): Frontmatter {
	const sides = { ours, theirs };
	const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base ?? {})])];
	const took: Record<string, Took> = {};
	const merged: Record<string, unknown> = {};

	const plainKey = (key: string): unknown => {
		const b = base?.[key];
		const o = ours[key];
		const t = theirs[key];
		if (same(o, t)) return (took[key] = 'both'), o;
		if (base !== null) {
			if (same(o, b)) return (took[key] = 'theirs'), t;
			if (same(t, b)) return (took[key] = 'ours'), o;
			if (SETS.has(key) && listOrAbsent(o) && listOrAbsent(t) && listOrAbsent(b)) return (took[key] = 'both'), mergeSet(b, o, t, later);
		}
		if (key === 'mtm-id' && typeof o === 'string' && typeof t === 'string' && (b === undefined || b === null)) {
			// Two writers gave one note an ID apart: both devices keep the same one (the lower), and the other is recorded.
			const [kept, lost] = o < t ? [o, t] : [t, o];
			took[key] = kept === o ? 'ours' : 'theirs';
			decisions.push({ kind: 'property', key, kept, lost });
			return kept;
		}
		took[key] = later;
		const kept = sides[later][key];
		decisions.push({ kind: 'property', key, kept: kept ?? null, lost: sides[later === 'ours' ? 'theirs' : 'ours'][key] ?? null });
		return kept;
	};

	for (const key of keys) if (!(key in DERIVED)) merged[key] = plainKey(key);
	for (const key of keys) {
		if (!(key in DERIVED)) continue;
		const from = (DERIVED[key] ?? []).map((k) => took[k] ?? 'both').filter((t) => t !== 'both');
		// The side whose status (or waiting on, or cell) won gives this key too; when both did, the later one.
		const side: Took = from.length === 0 ? 'both' : from.every((t) => t === from[0]) ? (from[0] ?? 'both') : later;
		merged[key] = side === 'both' ? plainKey(key) : sides[side][key];
	}
	const out: Frontmatter = {};
	for (const key of keys) if (merged[key] !== undefined) out[key] = merged[key];
	return out;
}

const listOrAbsent = (v: unknown) => v === undefined || Array.isArray(v);

/** A list merged as a set: the later side's order, then what only the other added; removals on either side stay removed. */
function mergeSet(base: unknown, ours: unknown, theirs: unknown, later: Side): unknown[] | undefined {
	const b = (base as unknown[] | undefined) ?? [];
	const o = (ours as unknown[] | undefined) ?? [];
	const t = (theirs as unknown[] | undefined) ?? [];
	const has = (list: unknown[], v: unknown) => list.some((x) => same(x, v));
	const removed = (v: unknown) => has(b, v) && (!has(o, v) || !has(t, v));
	const out: unknown[] = [];
	for (const v of later === 'ours' ? [...o, ...t] : [...t, ...o]) if (!removed(v) && !has(out, v)) out.push(v);
	return out.length || ours !== undefined || theirs !== undefined ? out : undefined;
}

// ——— Lines ———

/**
 * A three-way merge of lines. A change on one side only is taken; the same change on both, once. Where both changed
 * the same lines differently, task items merge by their text (added on either side, ticked on either side, removed
 * where one side removed them and the other left them alone) and any other lines keep both versions, the later first
 * and a blank line between. Without a base, what both sides share is taken as the base.
 */
function mergeLines(base: string[] | null, ours: string[], theirs: string[], later: Side, decisions: MergeDecision[]): string[] {
	if (ours.length * theirs.length > MAX_PAIRS || (base && base.length * Math.max(ours.length, theirs.length) > MAX_PAIRS)) {
		if (same(ours, theirs)) return ours;
		const [kept, also] = later === 'ours' ? [ours, theirs] : [theirs, ours];
		decisions.push({ kind: 'lines', kept, also });
		return [...kept, '', ...also];
	}
	const b = base ?? common(ours, theirs);
	const toOurs = matches(b, ours);
	const toTheirs = matches(b, theirs);
	const out: string[] = [];
	let i = 0;
	let o = 0;
	let t = 0;
	const hunk = (bEnd: number, oEnd: number, tEnd: number) => {
		const bl = b.slice(i, bEnd);
		const ol = ours.slice(o, oEnd);
		const tl = theirs.slice(t, tEnd);
		if (same(ol, bl)) out.push(...tl);
		else if (same(tl, bl)) out.push(...ol);
		else if (same(ol, tl)) out.push(...ol);
		else {
			const before = decisions.length;
			const start = out.length;
			out.push(...conflict(bl, ol, tl, later, decisions));
			for (const d of decisions.slice(before)) spans.set(d, [start, out.length]);
		}
	};
	for (let k = 0; k < b.length; k++) {
		const ok = toOurs[k];
		const tk = toTheirs[k];
		if (ok === undefined || tk === undefined) continue;
		hunk(k, ok, tk);
		out.push(b[k] ?? '');
		i = k + 1;
		o = ok + 1;
		t = tk + 1;
	}
	hunk(b.length, ours.length, theirs.length);
	return out;
}

/** Lines both sides changed differently. */
function conflict(base: string[], ours: string[], theirs: string[], later: Side, decisions: MergeDecision[]): string[] {
	const [kept, also] = later === 'ours' ? [ours, theirs] : [theirs, ours];
	const tasks = mergeTasks(base, kept, also);
	if (tasks) {
		// Something one side changed didn't survive as it was (an item renamed or removed against a change, a mark
		// changed differently on both): both versions are in the decision.
		if (tasks.lossy) decisions.push({ kind: 'lines', kept, also });
		return tasks.lines;
	}
	decisions.push({ kind: 'lines', kept, also });
	if (!kept.length) return also;
	if (!also.length) return kept;
	return [...kept, '', ...also];
}

/**
 * Task items merged by their text, or null when the lines aren't all task items at one level (nesting would move).
 * Every item either side has, the later side's order first, as many times as the side with most has it. An item in
 * the base that a side removed stays removed only where the other side left it exactly as it was. Marks merge three
 * ways: a mark only one side changed is that side's; where both changed it differently, a done mark wins over an
 * open one, and otherwise the later side's, with `lossy` set.
 */
function mergeTasks(base: string[], kept: string[], also: string[]): { lines: string[]; lossy: boolean } | null {
	const items = [...base, ...kept, ...also].filter((l) => l.trim() !== '');
	if (!items.every((l) => readTask(l) !== null)) return null;
	if (new Set(items.map((l) => readTask(l)?.prefix)).size > 1) return null;
	const textOf = (line: string) => readTask(line)?.text ?? '';
	const markOf = (line: string | undefined) => (line === undefined ? undefined : readTask(line)?.task);
	const lineOf = (list: string[], text: string) => list.find((l) => readTask(l) !== null && textOf(l) === text);
	const count = (list: string[], text: string) => list.filter((l) => readTask(l) !== null && textOf(l) === text).length;
	let lossy = false;

	const out: string[] = [];
	for (const line of [...kept, ...also]) {
		if (readTask(line) === null) continue;
		const text = textOf(line);
		if (count(out, text) >= Math.max(count(kept, text), count(also, text))) continue;
		const was = lineOf(base, text);
		const k = lineOf(kept, text);
		const a = lineOf(also, text);
		if (was !== undefined && ((k === undefined && (a === undefined || a === was)) || (a === undefined && k === was))) continue;
		// Kept against the other side's removal or rename, which only the decision now records.
		if (was !== undefined && (k === undefined || a === undefined)) lossy = true;
		const marks = { base: markOf(was), kept: markOf(k), also: markOf(a) };
		let mark = markOf(line) ?? ' ';
		if (marks.kept !== undefined && marks.also !== undefined && marks.kept !== marks.also) {
			if (marks.kept === marks.base) mark = marks.also;
			else if (marks.also === marks.base) mark = marks.kept;
			else {
				lossy = true;
				const done = (m: string) => m === 'x' || m === 'X';
				mark = done(marks.also) && !done(marks.kept) ? marks.also : marks.kept;
			}
		}
		const task = readTask(line);
		out.push(task ? `${line.slice(0, task.mark)}${mark}${line.slice(task.mark + 1)}` : line);
	}
	return { lines: out, lossy };
}

/** For each line of `a`, the index of the line of `b` it matches in a longest common subsequence, or undefined. */
function matches(a: readonly string[], b: readonly string[]): (number | undefined)[] {
	const n = a.length;
	const m = b.length;
	// lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
	const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		const row = lengths[i] as Uint32Array;
		const next = lengths[i + 1] as Uint32Array;
		for (let j = m - 1; j >= 0; j--) row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
	}
	const out: (number | undefined)[] = new Array<number | undefined>(n).fill(undefined);
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out[i] = j;
			i++;
			j++;
		} else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i++;
		else j++;
	}
	return out;
}

/** The lines two versions share, in order: the base of a merge without one. */
function common(a: readonly string[], b: readonly string[]): string[] {
	return matches(a, b).flatMap((j, i) => (j === undefined ? [] : [a[i] ?? '']));
}
