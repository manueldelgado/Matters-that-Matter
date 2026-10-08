// Quick add around the parser: the token being typed, accepting a suggestion, rewriting the type token,
// date chip labels and the Action a capture creates. Pure.

import { dayLabel, daysBetween, parseMtmDate, weekday, type MtmDate, type Ymd } from '../model/dates';
import type { Priority } from '../model/actions';
import { STRINGS } from '../strings';
import { continuesName, type Chip, type QuickAddResult } from './quickAddParser';

const MAX_TOKEN_WORDS = 6;

// ——— Matters and people created on add ———

/** Suggestions for a new Matter or person stand in as candidates with this path prefix until the Action is added. */
const NEW_PREFIX = 'mtm-new:';
export const newPath = (name: string): string => NEW_PREFIX + name;
export const isNewPath = (path: string): boolean => path.startsWith(NEW_PREFIX);
export const newName = (path: string): string => path.slice(NEW_PREFIX.length);

// ——— The token being typed ———

export interface ActiveToken {
	sigil: '#' | '@';
	/** Index of the sigil. */
	start: number;
	/** End of the word at the caret (or the closing quote). */
	end: number;
	/** Text after the sigil up to the caret, without the opening quote. */
	query: string;
	quoted: boolean;
}

const isTokenStart = (text: string, i: number) => i === 0 || /\s/.test(text[i - 1] ?? '');

/** The `#` or `@` token the caret is in, for suggestions. */
export function activeToken(input: string, caret: number): ActiveToken | null {
	for (let i = caret - 1; i >= 0; i--) {
		const ch = input[i];
		if ((ch !== '#' && ch !== '@') || !isTokenStart(input, i)) continue;
		const typed = input.slice(i + 1, caret);
		if (typed.startsWith('"')) {
			const inner = typed.slice(1);
			if (inner.includes('"')) return null;
			const close = input.indexOf('"', caret);
			const end = close < 0 ? wordEnd(input, caret) : close + 1;
			return { sigil: ch, start: i, end, query: inner.trim(), quoted: true };
		}
		if (typed.includes('"') || /\s[/#@!]/.test(typed)) return null;
		if (typed.split(/\s+/).filter(Boolean).length > MAX_TOKEN_WORDS) return null;
		return { sigil: ch, start: i, end: wordEnd(input, caret), query: typed.trim(), quoted: false };
	}
	return null;
}

function wordEnd(input: string, from: number): number {
	let end = from;
	while (end < input.length && !/\s/.test(input[end] ?? '')) end++;
	return end;
}

/** Whether the words after the first continue a name ("Ana García", "Juan de la"), as the parser reads unmatched names. */
export function isNameLike(query: string): boolean {
	const words = query.split(/\s+/).filter(Boolean);
	return words.slice(1).every((w, i) => continuesName(w, words[i + 2], true));
}

/** A name as written after a sigil: quoted when it has spaces. */
export function tokenName(name: string): string {
	return /\s/.test(name) ? `"${name}"` : name;
}

/** Replaces input[start, end) and leaves one space after it; returns the new input and the caret after the space. */
export function replaceSpan(input: string, start: number, end: number, replacement: string): { input: string; caret: number } {
	const after = input.slice(end);
	const spaced = /^\s/.test(after) ? replacement : `${replacement} `;
	const next = input.slice(0, start) + spaced + after;
	return { input: next, caret: start + spaced.length + (/^\s/.test(after) ? 1 : 0) };
}

/** Rewrites the last `/type` token (valid or not) to the given label; null when there is none. */
export function rewriteTypeToken(input: string, chips: readonly Chip[], label: string): string | null {
	const last = [...chips].reverse().find((c) => c.kind === 'type');
	if (!last) return null;
	return input.slice(0, last.start) + '/' + tokenName(label) + input.slice(last.end);
}

// ——— Date chips ———

function shortDay(ymd: Ymd, today: Ymd): string {
	const { dates } = STRINGS;
	const [y, m = 1, d = 1] = ymd.split('-').map(Number);
	const label = `${dates.weekdaysShort[weekday(ymd)] ?? ''} ${d} ${dates.monthsShort[m - 1] ?? ''}`;
	return ymd.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${y}`;
}

function withTime(label: string, d: MtmDate): string {
	return d.time ? `${label}${STRINGS.quickAdd.dateSep}${d.time}` : label;
}

/** "Tomorrow · Fri 9 Oct · 10:00", "Friday · 9 Oct", "Tue 20 Oct", or a range "Mon 12 Oct → Wed 14 Oct". */
export function dateChipLabel(startDate: string | null, due: string, today: Ymd): string {
	const end = parseMtmDate(due);
	if (!end) return due;
	const start = startDate ? parseMtmDate(startDate) : null;
	if (start) return `${withTime(shortDay(start.date, today), start)}${STRINGS.quickAdd.rangeSep}${withTime(shortDay(end.date, today), end)}`;

	const diff = daysBetween(today, end.date);
	const relative = dayLabel(end.date, today);
	let label: string;
	if (Math.abs(diff) <= 1) label = `${relative}${STRINGS.quickAdd.dateSep}${shortDay(end.date, today)}`;
	else if (diff > 1 && diff <= 6) {
		const [, m = 1, d = 1] = end.date.split('-').map(Number);
		label = `${relative}${STRINGS.quickAdd.dateSep}${d} ${STRINGS.dates.monthsShort[m - 1] ?? ''}`;
	} else label = shortDay(end.date, today);
	return withTime(label, end);
}

// ——— The Action a capture creates ———

export interface QuickAddDefaults {
	/** Matter from the lane the modal was opened in; null after the user removes it. */
	contextMatter: string | null;
	/** Status from the column the modal was opened in. */
	contextStatus: string | null;
	/** Type chosen in the picker when the input has no `/type` token. */
	pickedType: string | null;
	inboxPath: string;
	backlogId: string;
	defaultTypeId: string;
}

export interface Draft {
	title: string;
	typeId: string;
	/** May be a new Matter (see isNewPath). */
	matterPath: string;
	/** Whether the Matter is only the Inbox fallback. */
	matterIsDefault: boolean;
	statusId: string;
	statusIsDefault: boolean;
	/** Paths, or new people (see isNewPath). */
	people: string[];
	priority: Priority | null;
	start: string | null;
	due: string | null;
	canAdd: boolean;
}

export function draftOf(result: QuickAddResult, d: QuickAddDefaults): Draft {
	const matter = result.matterPath ?? d.contextMatter;
	return {
		title: result.title,
		typeId: result.typeId ?? d.pickedType ?? d.defaultTypeId,
		matterPath: matter ?? d.inboxPath,
		matterIsDefault: matter === null,
		statusId: d.contextStatus ?? d.backlogId,
		statusIsDefault: d.contextStatus === null,
		people: result.people,
		priority: result.priority,
		start: result.start,
		due: result.due,
		canAdd: result.title.trim().length > 0,
	};
}
