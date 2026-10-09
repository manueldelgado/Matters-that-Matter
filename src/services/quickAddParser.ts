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
	// Punctuation after a name ("#Kitchen, tomorrow") goes with the token but not into the match.
	const bare = (q: string) => q.replace(/[,;:.!?)]+$/, '');
	for (let k = words.length; k >= run; k--) {
		const last = words[k - 1];
		if (!last) continue;
		const query = bare(text.slice(from, last[2]));
		const item = bestStrong(query, candidates);
		if (item) return { end: last[2], query, item };
	}
	const last = words[run - 1] ?? first;
	return { end: last[2], query: bare(text.slice(from, last[2])), item: null };
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
	from: MtmDate;
	to: MtmDate | null;
}

/**
 * Day-first English (12/10 is 12 October), but a month name followed by a day is still a day ("oct 12", "Oct 12 at 3pm"):
 * chrono's day-first mode reads a two-digit day after a month as a year (2012).
 */
const chronoEnDayFirst = (() => {
	const c = chronoEn.clone();
	c.parsers = c.parsers.map((p) => {
		if (!('shouldSkipYearLikeDate' in p)) return p;
		const Ctor = p.constructor as new (skip: boolean) => typeof p;
		return new Ctor(false);
	});
	return c;
})();

const RANGE_JOIN = /^\s*(?:-|–|—|to|until|till|through|al|a|hasta|y)\s*$/i;
const RANGE_LEAD = /(?:^|\s)(from|del|de|desde)\s+$/i;

/** Weekday names and abbreviations; a bare weekday as the end of a range means the next one after the start. */
const isBareWeekday = (c: ParsedComponents) => c.isCertain('weekday') && !c.isCertain('day') && !c.isCertain('month') && !c.isCertain('year');

/**
 * Words that chrono reads as dates but that are usually part of a title: a part of the day, the weekend,
 * a bare month name, and short weekday forms that are ordinary words ("sun", "sat", Spanish "mar", "dom").
 * They still count with a day or a time ("tomorrow morning", "this weekend", "12 March", "sat 10").
 */
const WEAK_DATES = new Set([
	...['morning', 'afternoon', 'evening', 'night', 'noon', 'midday', 'midnight', 'weekend', 'the weekend'],
	...['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
	...['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'],
	...['sun', 'sat'],
	...['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'],
	...['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'],
	...['mediodia', 'medianoche', 'tarde', 'noche', 'fin de semana'],
]);

/** Words left before a date that only introduce it ("on", "by", "before", Spanish "el", "para"); they leave the title with the date. */
const DATE_LEAD = /(?:^|\s)(on|by|before|el|para)\s+$/i;

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

/** Joins two results separated by a range word ("del lunes al miércoles"), and keeps a range's end after its start. */
function toSpans(text: string, results: readonly ParsedResult[], now: Date): DateSpan[] {
	const out: DateSpan[] = [];
	for (let i = 0; i < results.length; i++) {
		const a = results[i];
		const b = results[i + 1];
		if (!a) continue;
		let start = a.index;
		let end = a.index + a.text.length;
		const fromC = a.start;
		let toC = a.end ?? null;
		if (b && !a.end && !b.end && RANGE_JOIN.test(text.slice(end, b.index))) {
			end = b.index + b.text.length;
			toC = b.start;
			i++;
		}
		const from = toMtmDate(fromC, now);
		let to = toC ? toMtmDate(toC, now) : null;
		// "friday until monday": the end is the next Monday after the start.
		while (to && toC && isBareWeekday(toC) && to.date < from.date) to = { ...to, date: addDays(to.date, 7) };
		if (to) {
			const lead = RANGE_LEAD.exec(text.slice(0, start));
			if (lead) start -= lead[0].trimStart().length;
		}
		out.push({ text: text.slice(start, end), start, end, from, to });
	}
	return out;
}

const MONTHS_ES: Record<string, number> = {
	enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Spanish forms chrono misses: "pasado mañana" and "del 20 al 22 de octubre". */
function spanishSpans(text: string, now: Date): DateSpan[] {
	const out: DateSpan[] = [];
	const today = toYmd(now);
	for (const m of text.matchAll(/(?:^|\s)(pasado\s+ma[ñn]ana)(?=\s|$|[,.;])/gi)) {
		const start = (m.index ?? 0) + m[0].indexOf(m[1] ?? '');
		out.push({ text: m[1] ?? '', start, end: start + (m[1] ?? '').length, from: { date: addDays(today, 2) }, to: null });
	}
	const range = /(?:^|\s)((?:del?\s+|desde\s+el\s+)?(\d{1,2})\s+(?:al|a|hasta\s+el)\s+(\d{1,2})\s+de\s+(\p{L}+))(?=\s|$|[,.;])/giu;
	for (const m of text.matchAll(range)) {
		const month = MONTHS_ES[normalise(m[4] ?? '')];
		const d1 = Number(m[2]), d2 = Number(m[3]);
		if (!month || d1 < 1 || d2 < 1 || d1 > 31 || d2 > 31) continue;
		const year = now.getFullYear();
		const pad = (n: number) => String(n).padStart(2, '0');
		let fromYmd = `${year}-${pad(month)}-${pad(d1)}`;
		let toYmd2 = `${year}-${pad(month)}-${pad(d2)}`;
		// Like chrono's forward dates: a range already over means next year.
		if (toYmd2 < today) {
			fromYmd = `${year + 1}-${pad(month)}-${pad(d1)}`;
			toYmd2 = `${year + 1}-${pad(month)}-${pad(d2)}`;
		}
		const start = (m.index ?? 0) + m[0].indexOf(m[1] ?? '');
		out.push({ text: m[1] ?? '', start, end: start + (m[1] ?? '').length, from: { date: fromYmd }, to: { date: toYmd2 } });
	}
	return out;
}

/**
 * A day of the month with no month: "on the 1st", "by the 21st", Spanish "el día 5". It needs the lead word and must not run
 * into another word ("on the 2nd floor"), except a time ("on the 1st at 10am", "el día 5 a las 10").
 */
const DAY_OF_MONTH: Record<DateLanguage, RegExp> = {
	en: /(?:^|\s)(?:on|by|before)\s+(the\s+(\d{1,2})(?:st|nd|rd|th))(?=\s*$|\s*[,.;!?)]|\s+(?:at\s+)?\d)/gi,
	es: /(?:^|\s)el\s+(d[ií]a\s+(\d{1,2}))(?=\s*$|\s*[,.;!?)]|\s+(?:a\s+las?\s+)?\d)/giu,
};

/** The next date after today that falls on this day of the month, skipping months too short for it; null if no such day. */
export function nextDayOfMonth(now: Date, day: number): string | null {
	if (day < 1 || day > 31) return null;
	let month = now.getMonth() + (day <= now.getDate() ? 1 : 0);
	for (let i = 0; i < 13; i++, month++) {
		const d = new Date(now.getFullYear(), month, day);
		if (d.getDate() === day) return toYmd(d);
	}
	return null;
}

function dayOfMonthSpans(text: string, now: Date, lang: DateLanguage): DateSpan[] {
	const out: DateSpan[] = [];
	for (const m of text.matchAll(DAY_OF_MONTH[lang])) {
		const date = nextDayOfMonth(now, Number(m[2]));
		if (!date) continue;
		const start = (m.index ?? 0) + m[0].indexOf(m[1] ?? '');
		let end = start + (m[1] ?? '').length;
		// A time right after it joins the date.
		const parser = lang === 'en' ? chronoEnDayFirst : chronoEs;
		const tail = text.slice(end);
		const gap = /^\s+/.exec(tail)?.[0].length ?? 0;
		// chrono keeps "at" in an English time but starts a Spanish one after "a" ("a las 10" reads "las 10").
		const lead = /^\s+(?:(?:at|a)\s+)?/i.exec(tail)?.[0].length ?? 0;
		const next = gap ? parser.parse(tail, now)[0] : undefined;
		const joins = next && next.index >= gap && next.index <= lead && !next.end;
		const time = joins && next.start.isCertain('hour') && !next.start.isCertain('day') && !next.start.isCertain('weekday')
			? toMtmDate(next.start, now).time
			: undefined;
		if (next && time) end += next.index + next.text.length;
		out.push({ text: text.slice(start, end), start, end, from: time ? { date, time } : { date }, to: null });
	}
	return out;
}

const plainWords = (text: string) => normalise(text).replace(/\s+/g, ' ').trim();

/** A part of the day or "weekend" that chrono folds into a longer date ("Weekend 20-22 oct") stays in the title. */
const WEAK_LEAD = /^(?:the\s+)?(?:weekend|morning|afternoon|evening|night|fin\s+de\s+semana)\s+/i;

function trimWeakLead(span: DateSpan): DateSpan {
	const m = WEAK_LEAD.exec(span.text);
	if (!m || m[0].length >= span.text.length) return span;
	return { ...span, text: span.text.slice(m[0].length), start: span.start + m[0].length };
}

function findDate(text: string, ctx: QuickAddContext): DateSpan | null {
	const languages = ctx.languages ?? ['en', 'es'];
	const spans: DateSpan[] = [];
	for (const lang of languages) {
		const parser = lang === 'en' ? chronoEnDayFirst : chronoEs;
		spans.push(...toSpans(text, parser.parse(text, ctx.now, { forwardDate: true }), ctx.now));
		spans.push(...dayOfMonthSpans(text, ctx.now, lang));
	}
	if (languages.includes('es')) spans.push(...spanishSpans(text, ctx.now));
	// A removed chip ignores its text, and any smaller date inside it ("10am" inside "friday 10am").
	const ignoredRanges: [number, number][] = [];
	const lower = text.toLowerCase();
	for (const t of ctx.ignoredDates ?? []) {
		const needle = t.trim().toLowerCase();
		if (!needle) continue;
		for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) ignoredRanges.push([at, at + needle.length]);
	}
	const ignored = (s: DateSpan) => ignoredRanges.some(([a, b]) => s.start >= a && s.end <= b);
	return (
		spans
			.map(trimWeakLead)
			.filter((s) => !ignored(s) && !WEAK_DATES.has(plainWords(s.text)))
			// Longest match wins; on a tie, the earlier one.
			.sort((a, b) => b.text.length - a.text.length || a.start - b.start)[0] ?? null
	);
}

// ——— Parse ———

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
	const chips = findTokens(input, ctx);

	// Dates are read on the text without its tokens, so "tomorrow #Kitchen 5pm" is one date and no date runs into a token.
	// `at[i]` is the input index of character i of the compact text.
	let compact = '';
	const at: number[] = [];
	const inToken = (i: number) => chips.some((c) => i >= c.start && i < c.end);
	for (let i = 0; i < input.length; i++) {
		if (inToken(i)) continue;
		compact += input[i];
		at.push(i);
	}
	const removed = new Array<boolean>(input.length).fill(false);
	for (const c of chips) for (let i = c.start; i < c.end; i++) removed[i] = true;

	const date = findDate(compact, ctx);
	if (date) {
		let from = date.start;
		const lead = DATE_LEAD.exec(compact.slice(0, from));
		if (lead) from -= lead[0].trimStart().length;
		for (let i = from; i < date.end; i++) removed[at[i] ?? 0] = true;
		chips.push({
			kind: 'date',
			text: date.text,
			start: at[from] ?? 0,
			end: (at[date.end - 1] ?? 0) + 1,
			startDate: date.to ? formatMtmDate(date.from) : null,
			due: formatMtmDate(date.to ?? date.from),
		});
	}
	chips.sort((a, b) => a.start - b.start);

	let title = '';
	for (let i = 0; i < input.length; i++) title += removed[i] ? ' ' : input[i];
	title = title.replace(/\s+/g, ' ').trim();

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
