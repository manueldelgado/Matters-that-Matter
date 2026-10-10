// The `matters` embed: its one-line query (quick add's tokens plus a few words), the Actions it holds, and its head in
// words. Pure.

import { compareCards } from '../model/actions';
import { dateLabel, isOverdue, type Ymd } from '../model/dates';
import { backlogStatus } from '../model/workflow';
import type { Priority } from '../model/actions';
import type { StatusDef } from '../settings';
import { STRINGS } from '../strings';
import type { ActionItem } from './actionItems';
import { nextStepStatus } from './nextAction';
import { parseQuickAdd, type QuickAddContext } from './quickAddParser';

/** At most this many cards; the rest are "N more". */
export const EMBED_LIMIT = 12;

export type EmbedScope = 'open' | 'done' | 'all';

export interface EmbedQuery {
	scope: EmbedScope;
	waiting: boolean;
	late: boolean;
	next: boolean;
	someday: boolean;
	matters: string[];
	types: string[];
	people: string[];
	priorities: Priority[];
	/** Due on or by `end` (from `start`, for a range). */
	due: { start: Ymd | null; end: Ymd } | null;
	/** Tokens and words that match nothing: shown, never applied. */
	invalid: string[];
	/** The block's valid tokens, as quick add's starting text for "+". */
	prefill: string;
	/** An empty block reads its note: the Matter, the person, or neither (today and late). */
	context: 'matter' | 'person' | 'today' | null;
}

const WORDS = ['today', 'late', 'waiting', 'next', 'someday', 'done', 'all'] as const;
type Word = (typeof WORDS)[number];

const day = (value: string) => value.slice(0, 10);

function emptyQuery(): EmbedQuery {
	return { scope: 'open', waiting: false, late: false, next: false, someday: false, matters: [], types: [], people: [], priorities: [], due: null, invalid: [], prefill: '', context: null };
}

/** What the note an empty block sits in is. */
export interface EmbedNote {
	path: string;
	kind: 'matter' | 'person' | 'other';
}

export function parseEmbedQuery(source: string, ctx: QuickAddContext, note: EmbedNote, today: Ymd): EmbedQuery {
	const q = emptyQuery();
	const text = source.replace(/\s+/g, ' ').trim();
	if (!text) {
		if (note.kind === 'matter') {
			q.matters.push(note.path);
			q.context = 'matter';
		} else if (note.kind === 'person') {
			q.people.push(note.path);
			q.context = 'person';
		} else {
			q.due = { start: null, end: today };
			q.context = 'today';
		}
		return q;
	}

	const parsed = parseQuickAdd(text, ctx);
	const valid: string[] = [];
	// Pieces in the order they were written: chips, and the words between them.
	type Piece = { start: number; end: number; text: string; chip?: (typeof parsed.chips)[number] };
	const pieces: Piece[] = parsed.chips.map((chip) => ({ start: chip.start, end: chip.end, text: chip.text, chip }));
	let at = 0;
	for (const chip of [...parsed.chips].sort((a, b) => a.start - b.start).concat({ start: text.length, end: text.length } as never)) {
		for (const m of text.slice(at, chip.start).matchAll(/\S+/g)) pieces.push({ start: at + (m.index ?? 0), end: at + (m.index ?? 0) + m[0].length, text: m[0] });
		at = Math.max(at, chip.end);
	}
	pieces.sort((a, b) => a.start - b.start);
	// Words right after a token that matched nothing belong to it ("#Garden shed"), until the next token or word.
	let open: number | null = null;
	for (const piece of pieces) {
		const chip = piece.chip;
		if (chip) {
			open = null;
			if (chip.kind === 'matter') chip.path ? q.matters.push(chip.path) : (open = q.invalid.push(chip.text) - 1);
			else if (chip.kind === 'type') chip.id ? q.types.push(chip.id) : (open = q.invalid.push(chip.text) - 1);
			else if (chip.kind === 'person') chip.path ? q.people.push(chip.path) : (open = q.invalid.push(chip.text) - 1);
			else if (chip.kind === 'priority') q.priorities.push(chip.priority);
			else q.due = { start: chip.startDate ? day(chip.startDate) : null, end: day(chip.due) };
			if (open === null) valid.push(chip.text);
			continue;
		}
		const w = piece.text.toLowerCase() as Word;
		if (!WORDS.includes(w)) {
			if (open !== null) q.invalid[open] = `${q.invalid[open] ?? ''} ${piece.text}`;
			else q.invalid.push(piece.text);
			continue;
		}
		open = null;
		if (w === 'today') q.due = { start: null, end: today };
		else if (w === 'done' || w === 'all') q.scope = w;
		else q[w] = true;
	}
	// "Today" is quick add's date as well as a word: due on or by today either way.
	q.prefill = valid.filter((t) => !/^(today|hoy)$/i.test(t)).join(' ');
	return q;
}

/** An Action with the people it names, resolved: who it's with and who it's waiting on. */
export interface EmbedSubject {
	item: ActionItem;
	people: ReadonlySet<string>;
	waitingOn: string | null;
}

export interface EmbedResult {
	items: ActionItem[];
	total: number;
}

export function embedItems(subjects: readonly EmbedSubject[], q: EmbedQuery, statuses: readonly StatusDef[], now: Date): EmbedResult {
	const next = nextStepStatus(statuses)?.id;
	const backlog = backlogStatus(statuses)?.id;
	const any = <T>(list: readonly T[], test: (x: T) => boolean) => !list.length || list.some(test);
	const matched = subjects.filter(({ item, people, waitingOn }) => {
		const closed = item.category === 'closed';
		if (q.scope === 'open' && closed) return false;
		if (q.scope === 'done' && !closed) return false;
		if (q.waiting && (closed || !item.waitingOn)) return false;
		if (q.late && !isOverdue(item.due, now, closed)) return false;
		if (q.next && item.effective.status.id !== next) return false;
		if (q.someday && item.effective.status.id !== backlog) return false;
		if (q.due) {
			if (!item.due || closed || item.due.date > q.due.end) return false;
			if (q.due.start && item.due.date < q.due.start) return false;
		}
		if (!any(q.matters, (m) => item.effective.matterPath === m)) return false;
		if (!any(q.types, (t) => item.effective.type.id === t)) return false;
		if (!any(q.priorities, (p) => item.priority === p)) return false;
		// Waiting on someone: that person is the one waited on; otherwise anyone the Action names.
		if (!any(q.people, (p) => (q.waiting ? waitingOn === p : people.has(p)))) return false;
		return true;
	});
	const items = matched.map((s) => s.item);
	items.sort((a, b) => (q.context === 'person' ? Number(!a.waitingOn) - Number(!b.waitingOn) : 0) || compareCards(a, b));
	return { items: items.slice(0, EMBED_LIMIT), total: items.length };
}

/** Names for the head. */
export interface EmbedNames {
	matter(path: string): string;
	type(id: string): string;
	person(path: string): string;
	status(id: string | undefined): string;
}

/** The head in words: "Open Actions · Kitchen renovation", "Waiting on Charlie Carter", "Due today or late · Call". */
export function embedTitle(q: EmbedQuery, names: EmbedNames, statuses: readonly StatusDef[], today: Ymd): string {
	const e = STRINGS.embed;
	const list = (items: string[]) => items.join(', ');
	const people = q.people.map((p) => names.person(p));
	let main: string;
	let peopleInMain = false;
	if (q.waiting && people.length) {
		main = e.waitingOn(list(people));
		peopleInMain = true;
	} else if (q.due) {
		const end = dateLabel({ date: q.due.end }, today);
		main = q.due.start ? e.dueBetween(dateLabel({ date: q.due.start }, today), end) : q.due.end === today ? e.dueToday : e.dueBy(end);
	} else if (q.late) main = e.late;
	else if (q.waiting) main = e.waiting;
	else if (q.next) main = names.status(nextStepStatus(statuses)?.id);
	else if (q.someday) main = names.status(backlogStatus(statuses)?.id);
	else main = q.scope === 'done' ? e.done : q.scope === 'all' ? e.all : e.open;
	const parts = [main];
	if (q.matters.length) parts.push(list(q.matters.map((m) => names.matter(m))));
	if (q.types.length) parts.push(list(q.types.map((t) => names.type(t))));
	if (people.length && !peopleInMain) parts.push(e.with(list(people)));
	if (q.priorities.length) parts.push(list(q.priorities.map((p) => e.priority[p])));
	return parts.join(' · ');
}
