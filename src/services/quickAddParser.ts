// Quick-add parsing: tokens (/type, #Matter, @person, !priority) and natural dates (English and Spanish).
// Recognised tokens are removed from the title and returned as chips.

import { GB as chronoEn } from 'chrono-node/en';
import { casual as chronoEs } from 'chrono-node/es';
import type { ParsedResult } from 'chrono-node/en';
import { addDays, formatMtmDate, toHm, toYmd, type MtmDate } from '../model/dates';
import type { Priority } from '../model/actions';
import { bestStrong, normalise, type Candidate } from './fuzzy';

export type DateLanguage = 'en' | 'es';

export interface TypeCandidate extends Candidate {
	id: string;
}

export interface NoteCandidate extends Candidate {
	path: string;
}

export interface QuickAddContext {
	now: Date;
	types: readonly TypeCandidate[];
	matters: readonly NoteCandidate[];
	/** People-folder notes should carry a lower rank than other notes. */
	people: readonly NoteCandidate[];
	languages?: readonly DateLanguage[];
	/** Texts of date chips the user removed; they stay in the title. */
	ignoredDates?: readonly string[];
}

interface Span {
	/** Source text, as typed. */
	text: string;
	start: number;
	end: number;
}

export type Chip =
	| (Span & { kind: 'type'; query: string; id: string | null })
	| (Span & { kind: 'matter'; query: string; path: string | null })
	| (Span & { kind: 'person'; query: string; path: string | null })
	| (Span & { kind: 'priority'; priority: Priority })
	| (Span & { kind: 'date'; startDate: string | null; due: string });

export interface QuickAddResult {
	title: string;
	chips: Chip[];
	/** null: use the default type. */
	typeId: string | null;
	/** null: use the Inbox. */
	matterPath: string | null;
	people: string[];
	priority: Priority | null;
	start: string | null;
	due: string | null;
}

const SIGILS = '/#@';
const MAX_NAME_WORDS = 6;

// ——— Tokens ———

function isTokenStart(text: string, i: number): boolean {
	return i === 0 || /\s/.test(text[i - 1] ?? '');
}

/** Words after a sigil: [text, start, end] for each, stopping at the next token. */
function followingWords(text: string, from: number): [string, number, number][] {
	const out: [string, number, number][] = [];
	const re = /\S+/g;
	re.lastIndex = from;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) && out.length < MAX_NAME_WORDS) {
		if (out.length === 0 && m.index !== from) break;
		if (out.length > 0 && (SIGILS.includes(m[0][0] ?? '') || /^![123]$/.test(m[0]))) break;
		out.push([m[0], m.index, m.index + m[0].length]);
	}
	return out;
}

// Unmatched names (people and Matters still to be created) run on over the words that continue a name.
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do', 'dos', 'di', 'du', 'van', 'von', 'der', 'den', 'le', 'bin', 'al']);
const DATE_WORDS = new Set([
	...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun'],
	...['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
	...['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'],
	...['today', 'tomorrow', 'tonight', 'yesterday', 'next', 'this', 'noon', 'midnight'],
	...['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'hoy', 'manana', 'pasado', 'ayer', 'proximo', 'proxima', 'este', 'esta'],
	...['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'],
]);
const isCapitalised = (word: string) => /^\p{Lu}/u.test(word);
const endsClause = (word: string) => /[,;:.!?)]$/.test(word);

/**
 * Whether `word` continues a name: a capitalised word that is not a date word ("García", but not "Monday"),
 * or a particle followed by one ("de la Cruz"). While typing (`next` undefined and `typing`), a particle may end the text.
 */
export function continuesName(word: string, next: string | undefined, typing = false): boolean {
	const plain = normalise(word.replace(/[,;:.!?)]+$/, ''));
	if (DATE_WORDS.has(plain)) return false;
	if (isCapitalised(word)) return true;
	if (!NAME_PARTICLES.has(word)) return false;
	return next === undefined ? typing : isCapitalised(next) || NAME_PARTICLES.has(next);
}

/** Longest run of words with a strong match; quotes force the span. Unmatched names keep the words that continue them. */
function matchName<T extends Candidate>(
	text: string,
	at: number,
	candidates: readonly T[],
	/** Whether an unmatched name runs on over the words that continue it (Matters and people, not types). */
	extend: boolean,
): { end: number; query: string; item: T | null } | null {
	const from = at + 1;
	if (text[from] === '"') {
		const close = text.indexOf('"', from + 1);
		const end = close < 0 ? text.length : close + 1;
		const query = text.slice(from + 1, close < 0 ? text.length : close).trim();
		if (!query) return null;
		return { end, query, item: bestStrong(query, candidates) };
	}
	const words = followingWords(text, from);
	const first = words[0];
	if (!first) return null;
	// The run of words that read as one name ("Ana García"); a match on fewer words ("Ana Gil") is someone else.
	let run = 1;
	while (extend && run < words.length && !endsClause(words[run - 1]?.[0] ?? '') && continuesName(words[run]?.[0] ?? '', words[run + 1]?.[0])) run++;
	// A run that ends on a particle ("Ana de") gives the particle back to the title.
	while (run > 1 && !isCapitalised(words[run - 1]?.[0] ?? '')) run--;
	for (let k = words.length; k >= run; k--) {
		const last = words[k - 1];
		if (!last) continue;
		const query = text.slice(from, last[2]);
		const item = bestStrong(query, candidates);
		if (item) return { end: last[2], query, item };
	}
	const last = words[run - 1] ?? first;
	return { end: last[2], query: text.slice(from, last[2]), item: null };
}

function findTokens(text: string, ctx: QuickAddContext): Chip[] {
	const chips: Chip[] = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i] ?? '';
		if (!isTokenStart(text, i)) {
			i++;
			continue;
		}
		if (ch === '!' && /^![123](?=\s|$)/.test(text.slice(i))) {
			chips.push({ kind: 'priority', text: text.slice(i, i + 2), start: i, end: i + 2, priority: Number(text[i + 1]) as Priority });
			i += 2;
			continue;
		}
		if (ch === '/' || ch === '#' || ch === '@') {
			const list = ch === '/' ? ctx.types : ch === '#' ? ctx.matters : ctx.people;
			const m = matchName<Candidate>(text, i, list, ch !== '/');
			if (m) {
				const span = { text: text.slice(i, m.end), start: i, end: m.end, query: m.query };
				if (ch === '/') chips.push({ ...span, kind: 'type', id: (m.item as TypeCandidate | null)?.id ?? null });
				else if (ch === '#') chips.push({ ...span, kind: 'matter', path: (m.item as NoteCandidate | null)?.path ?? null });
				else chips.push({ ...span, kind: 'person', path: (m.item as NoteCandidate | null)?.path ?? null });
				i = m.end;
				continue;
			}
		}
		i++;
	}
	return chips;
}

// ——— Dates ———

type ParsedComponents = ParsedResult['start'];

interface DateSpan {
	text: string;
	start: number;
	end: number;
	from: ParsedComponents;
	to: ParsedComponents | null;
}

const RANGE_JOIN = /^\s*(?:-|–|—|to|until|till|through|al|a|hasta|y)\s*$/i;
const RANGE_LEAD = /(?:^|\s)(from|del|de|desde)\s+$/i;

/** Spanish ranges ("del lunes al miércoles") come back as two results; joins them. */
function joinRanges(text: string, results: readonly ParsedResult[]): DateSpan[] {
	const spans: DateSpan[] = results.map((r) => ({
		text: r.text,
		start: r.index,
		end: r.index + r.text.length,
		from: r.start,
		to: r.end ?? null,
	}));
	const out: DateSpan[] = [];
	for (let i = 0; i < spans.length; i++) {
		const a = spans[i];
		const b = spans[i + 1];
		if (!a) continue;
		if (b && !a.to && !b.to && RANGE_JOIN.test(text.slice(a.end, b.start))) {
			out.push({ text: text.slice(a.start, b.end), start: a.start, end: b.end, from: a.from, to: b.from });
			i++;
		} else out.push(a);
	}
	for (const span of out) {
		if (!span.to) continue;
		const lead = RANGE_LEAD.exec(text.slice(0, span.start));
		if (lead) {
			span.start -= lead[0].trimStart().length;
			span.text = text.slice(span.start, span.end);
		}
	}
	return out;
}

/**
 * Applies the quick-add rules on top of chrono:
 * a bare weekday means the next occurrence after today; a time without am/pm from 1 to 7 is afternoon;
 * a time without a day is today, or tomorrow if it has passed.
 */
function toMtmDate(c: ParsedComponents, now: Date): MtmDate {
	const today = toYmd(now);
	let date = toYmd(c.date());
	const timed = c.isCertain('hour');
	let hour = c.get('hour') ?? 0;
	const minute = c.get('minute') ?? 0;
	if (timed && !c.isCertain('meridiem') && hour >= 1 && hour <= 7) hour += 12;
	const time = timed ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : undefined;

	const hasDay = c.isCertain('day') || c.isCertain('month') || c.isCertain('year');
	if (c.isCertain('weekday') && !hasDay) {
		if (date === today) date = addDays(today, 7);
	} else if (timed && !hasDay && !c.isCertain('weekday')) {
		date = time && time <= toHm(now) ? addDays(today, 1) : today;
	}
	return time ? { date, time } : { date };
}

function findDate(masked: string, ctx: QuickAddContext): DateSpan | null {
	const languages = ctx.languages ?? ['en', 'es'];
	const ignored = new Set((ctx.ignoredDates ?? []).map((t) => t.trim().toLowerCase()));
	const spans: DateSpan[] = [];
	for (const lang of languages) {
		const parser = lang === 'en' ? chronoEn : chronoEs;
		spans.push(...joinRanges(masked, parser.parse(masked, ctx.now, { forwardDate: true })));
	}
	// Longest match wins; on a tie, the earlier one.
	return (
		spans
			.filter((s) => !ignored.has(s.text.trim().toLowerCase()))
			.sort((a, b) => b.text.length - a.text.length || a.start - b.start)[0] ?? null
	);
}

// ——— Parse ———

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
	const chips = findTokens(input, ctx);

	let masked = input;
	for (const c of chips) masked = masked.slice(0, c.start) + ' '.repeat(c.end - c.start) + masked.slice(c.end);
	const date = findDate(masked, ctx);
	if (date) {
		const from = toMtmDate(date.from, ctx.now);
		const to = date.to ? toMtmDate(date.to, ctx.now) : null;
		chips.push({
			kind: 'date',
			text: input.slice(date.start, date.end),
			start: date.start,
			end: date.end,
			startDate: to ? formatMtmDate(from) : null,
			due: formatMtmDate(to ?? from),
		});
	}
	chips.sort((a, b) => a.start - b.start);

	let title = '';
	let pos = 0;
	for (const c of chips) {
		title += input.slice(pos, c.start) + ' ';
		pos = c.end;
	}
	title = (title + input.slice(pos)).replace(/\s+/g, ' ').trim();

	const result: QuickAddResult = { title, chips, typeId: null, matterPath: null, people: [], priority: null, start: null, due: null };
	for (const c of chips) {
		// A later valid token replaces an earlier one; people accumulate.
		if (c.kind === 'type' && c.id) result.typeId = c.id;
		else if (c.kind === 'matter' && c.path) result.matterPath = c.path;
		else if (c.kind === 'person' && c.path && !result.people.includes(c.path)) result.people.push(c.path);
		else if (c.kind === 'priority') result.priority = c.priority;
		else if (c.kind === 'date') {
			result.start = c.startDate;
			result.due = c.due;
		}
	}
	return result;
}
