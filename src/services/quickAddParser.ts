// Quick-add parsing: tokens (/type, #Matter, @person, !priority) and natural dates (English and Spanish).
// Recognised tokens are removed from the title and returned as chips.

import { GB as chronoEn } from 'chrono-node/en';
import { casual as chronoEs } from 'chrono-node/es';
import type { ParsedResult } from 'chrono-node/en';
import { addDays, daysBetween, daysInMonth, formatMtmDate, readFigureDate, toHm, toYmd, wallClock, type DateProblem, type MtmDate } from '../model/dates';
import type { Priority } from '../model/actions';
import { DATE_LANGUAGES, type DateLanguage } from '../settings';
import { bestStrong, normalise, type Candidate } from './fuzzy';

export type { DateLanguage, DateProblem };

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
	/** An IANA time zone whose "today" and "now" dates are read in; the host's own when absent. */
	timeZone?: string;
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
	| (Span & { kind: 'date'; startDate: string | null; due: string })
	/** A date as typed that isn't read: no date is set from it, and its text stays in the title. */
	| (Span & { kind: 'invalid-date'; problem: DateProblem });

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
	/** Set when the date carries a time zone: it isn't read. */
	problem?: DateProblem;
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
 * A range's end that is only a time ("12:00"): it is on the start's day. chrono gives the end of a range it reads
 * whole the start's weekday ("fri 10 to 2"); that weekday isn't the end's own.
 */
function endIsTimeOnly(a: ParsedResult, fromC: ParsedComponents, toC: ParsedComponents): boolean {
	if (!toC.isCertain('hour') || toC.isCertain('day') || toC.isCertain('month') || toC.isCertain('year')) return false;
	if (!toC.isCertain('weekday')) return true;
	return !!a.end && fromC.isCertain('weekday') && toC.get('weekday') === fromC.get('weekday');
}

/**
 * Days written as "28 to 2 November", "28-2 nov", "del 28 al 2 de noviembre": the month is written once, after the
 * last day, so it is the end's; a first day after the last is in the month before.
 */
const MONTH_AFTER_END = /^(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\s*(?:-|–|—|to|until|till|through|al|a|hasta|y)\s*(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+|de\s+)?\p{L}/iu;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The day `months` months later (or earlier), or null when that month doesn't have it. */
function shiftMonths(ymd: string, months: number): string | null {
	const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
	const total = y * 12 + (m - 1) + months;
	const year = Math.floor(total / 12), month = (total % 12) + 1;
	return d > daysInMonth(year, month) ? null : `${year}-${pad2(month)}-${pad2(d)}`;
}

const inMonthBefore = (ymd: string) => shiftMonths(ymd, -1);

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
/** Spanish "a" before a time ("a las 5", "a la 1"): chrono starts the time at "las", so the "a" is a lead word too. */
const TIME_LEAD_ES = /(?:^|\s)(a)\s+$/i;

/** Where a date starts once the words that only introduce it are taken with it. */
function withLead(text: string, start: number): number {
	const before = text.slice(0, start);
	const lead = DATE_LEAD.exec(before) ?? (/^las?\s/i.test(text.slice(start)) ? TIME_LEAD_ES.exec(before) : null);
	return lead ? start - lead[0].trimStart().length : start;
}

/**
 * Whether the hour (1 to 9) is written with two digits in the date's text ("06:30", "2026-10-16T06:00"): then it is
 * taken as written. Only an hour of one digit without am or pm ("at 3", "3:30", "a las 5") is ambiguous.
 */
const twoDigitHour = (written: string, hour: number) => new RegExp(`(?<![\\d:])0${hour}:\\d{2}`).test(written);

/** An hour written with one digit and without am or pm: morning or evening, as the rest of the text says. */
function ambiguousHour(c: ParsedComponents, written: string): boolean {
	const hour = c.get('hour') ?? 0;
	return c.isCertain('hour') && !c.isCertain('meridiem') && hour >= 1 && hour <= 9 && !twoDigitHour(written, hour);
}

/**
 * Applies the quick-add rules on top of chrono, `written` being the text chrono read it from:
 * a bare weekday means the next occurrence after today; an hour from 1 to 7 written with one digit and without am/pm
 * is afternoon, unless `evening` says which it is; a time without a day is today, or tomorrow if it has passed.
 */
function toMtmDate(c: ParsedComponents, now: Date, written: string, evening?: boolean): MtmDate {
	const today = toYmd(now);
	let date = ymdOf(c);
	const timed = c.isCertain('hour');
	let hour = c.get('hour') ?? 0;
	const minute = c.get('minute') ?? 0;
	if (timed && !c.isCertain('meridiem') && hour < 12 && (evening ?? (hour >= 1 && hour <= 7 && !twoDigitHour(written, hour)))) hour += 12;
	const time = timed ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : undefined;

	const hasDay = c.isCertain('day') || c.isCertain('month') || c.isCertain('year');
	if (c.isCertain('weekday') && !hasDay) {
		if (date === today) date = addDays(today, 7);
	} else if (timed && !hasDay && !c.isCertain('weekday')) {
		date = time && time <= toHm(now) ? addDays(today, 1) : today;
	}
	return time ? { date, time } : { date };
}

/** The day chrono read, from its components: the day as written, never shifted by a time zone or the host's. */
function ymdOf(c: ParsedComponents): string {
	const year = c.get('year'), month = c.get('month'), day = c.get('day');
	if (year === null || month === null || day === null) return toYmd(c.date());
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** What chrono read as a time zone at the end of a result: "EST", "(CET)", "GMT+2", "+02:00", "art". */
const ZONE_TAIL = /\s*,?\s*\(?((?:(?:gmt|utc)\s?)?[+-]\d{1,2}(?::?\d{2})?|[a-z]{2,5})\)?$/i;

/**
 * A time zone after a time. Written as one (capitals, or an offset with a sign) it is a time zone, and the date isn't
 * read; any other word chrono took for one ("5pm art class", "3pm cat") goes back to the title (`cut`, its length).
 */
function zoneOf(r: ParsedResult): { cut: number; zone: boolean } | null {
	if (!r.start.isCertain('timezoneOffset') && !r.end?.isCertain('timezoneOffset')) return null;
	const m = ZONE_TAIL.exec(r.text);
	const word = m?.[1];
	if (!m || !word) return { cut: 0, zone: true };
	return { cut: m[0].length, zone: /[+-]/.test(word) || /^[A-Z]+$/.test(word) };
}

interface RangeParts {
	fromC: ParsedComponents;
	toC: ParsedComponents;
	fromText: string;
	toText: string;
	timeOnly: boolean;
}

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Minutes from one timed date to another; null unless both have a time. */
function minutesBetween(from: MtmDate, to: MtmDate): number | null {
	if (!from.time || !to.time) return null;
	return daysBetween(from.date, to.date) * 1440 + minutesOf(to.time) - minutesOf(from.time);
}

/** A range's two ends, the hours read as `evening` says where it says. */
function readRange(r: RangeParts, now: Date, evening: readonly [boolean?, boolean?] = []): { from: MtmDate; to: MtmDate } {
	const from = toMtmDate(r.fromC, now, r.fromText, evening[0]);
	let to = toMtmDate(r.toC, now, r.toText, evening[1]);
	// "friday until monday": the end is the next Monday after the start.
	while (isBareWeekday(r.toC) && to.date < from.date) to = { ...to, date: addDays(to.date, 7) };
	// "20/10 10:00 hasta 12:00": the end is on the start's day, or the day after when it is earlier than the start.
	if (to.time && r.timeOnly) {
		const time = to.time;
		to = { date: from.time && time < from.time ? addDays(from.date, 1) : from.date, time };
	}
	return { from, to };
}

/**
 * A range's two ends. An ambiguous end hour is morning or evening, whichever makes the shortest range that ends
 * strictly after the start ("06:00 to 7:00", "18:00 hasta 6", "7 to 9"); the start follows the afternoon rule. An
 * ambiguous start with an end that isn't ("6:00 to 07:00") is read the same way against the end.
 */
function rangeEnds(r: RangeParts, now: Date): { from: MtmDate; to: MtmDate } {
	const plain = readRange(r, now);
	const fromAmbiguous = ambiguousHour(r.fromC, r.fromText), toAmbiguous = ambiguousHour(r.toC, r.toText);
	if ((!fromAmbiguous && !toAmbiguous) || minutesBetween(plain.from, plain.to) === null) return plain;
	let best: { from: MtmDate; to: MtmDate } | null = null;
	let shortest = Infinity;
	for (const evening of [false, true]) {
		const read = readRange(r, now, toAmbiguous ? [undefined, evening] : [evening]);
		const length = minutesBetween(read.from, read.to) ?? 0;
		if (length > 0 && length < shortest) {
			best = read;
			shortest = length;
		}
	}
	return best ?? plain;
}

/** Joins two results separated by a range word ("del lunes al miércoles"), and keeps a range's end after its start. */
function toSpans(text: string, results: readonly ParsedResult[], now: Date): DateSpan[] {
	const out: DateSpan[] = [];
	for (let i = 0; i < results.length; i++) {
		const a = results[i];
		const b = results[i + 1];
		if (!a) continue;
		let start = a.index;
		const zoneA = zoneOf(a);
		let end = a.index + a.text.length - (zoneA?.zone ? 0 : (zoneA?.cut ?? 0));
		let zone = !!zoneA?.zone;
		const fromC = a.start;
		let toC = a.end ?? null;
		let toText = a.text;
		if (b && !a.end && !b.end && !zoneA && RANGE_JOIN.test(text.slice(end, b.index))) {
			const zoneB = zoneOf(b);
			end = b.index + b.text.length - (zoneB?.zone ? 0 : (zoneB?.cut ?? 0));
			zone = !!zoneB?.zone;
			toC = b.start;
			toText = b.text;
			i++;
		}
		let from: MtmDate;
		let to: MtmDate | null = null;
		if (toC) ({ from, to } = rangeEnds({ fromC, toC, fromText: a.text, toText, timeOnly: endIsTimeOnly(a, fromC, toC) }, now));
		else from = toMtmDate(fromC, now, a.text);
		let problem: DateProblem | undefined = zone ? 'time-zone' : undefined;
		// "28 to 2 November": the month chrono gives both ends is written once, after the last day; a first day after
		// the last is in the month before. A range that is then already over is next year's, as a date on its own is.
		const monthOnce = a.end ? MONTH_AFTER_END.test(a.text) : !fromC.isCertain('month');
		if (to && toC && to.date < from.date && to.date.slice(0, 7) === from.date.slice(0, 7) && fromC.isCertain('day') && monthOnce) {
			const before = inMonthBefore(from.date);
			if (!before) problem ??= 'not-a-day';
			else if (to.date < toYmd(now) && !toC.isCertain('year')) {
				const fromNext = shiftMonths(before, 12), toNext = shiftMonths(to.date, 12);
				if (fromNext && toNext) {
					from = { ...from, date: fromNext };
					to = { ...to, date: toNext };
				} else problem ??= 'not-a-day';
			} else from = { ...from, date: before };
		}
		if (to) {
			const lead = RANGE_LEAD.exec(text.slice(0, start));
			if (lead) start -= lead[0].trimStart().length;
		}
		out.push({ text: text.slice(start, end), start, end, from, to, ...(problem ? { problem } : {}) });
	}
	return out;
}

const MONTHS_ES: Record<string, number> = {
	enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/**
 * Spanish forms chrono misses: "pasado mañana" and "del 20 al 22 de octubre". A first day after the last is in the
 * month before ("del 28 al 2 de noviembre"); a day the month doesn't have makes the range an invalid date.
 */
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
		const start = (m.index ?? 0) + m[0].indexOf(m[1] ?? '');
		const span = { text: m[1] ?? '', start, end: start + (m[1] ?? '').length };
		// Like chrono's forward dates: a range already over means next year.
		let year = now.getFullYear();
		if (`${year}-${pad2(month)}-${pad2(d2)}` < today) year++;
		const toYmd2 = d2 > daysInMonth(year, month) ? null : `${year}-${pad2(month)}-${pad2(d2)}`;
		const fromYmd = d1 > d2 ? toYmd2 && inMonthBefore(`${year}-${pad2(month)}-${pad2(d1)}`) : toYmd2 && `${year}-${pad2(month)}-${pad2(d1)}`;
		if (!toYmd2 || !fromYmd) out.push({ ...span, from: { date: today }, to: null, problem: 'not-a-day' });
		else out.push({ ...span, from: { date: fromYmd }, to: { date: toYmd2 } });
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
			? toMtmDate(next.start, now, next.text).time
			: undefined;
		const zone = next && time ? zoneOf(next) : null;
		if (next && time) end += next.index + next.text.length - (zone?.zone ? 0 : (zone?.cut ?? 0));
		out.push({ text: text.slice(start, end), start, end, from: time ? { date, time } : { date }, to: null, ...(zone?.zone ? { problem: 'time-zone' as const } : {}) });
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

/**
 * chrono's Spanish parser reads a lone "a" after a time as a.m. ("a las 5 a Juan"). Only "am" or "a.m." is: such a
 * result is read again without the "a", which goes back to the title.
 */
function parseSpanish(text: string, now: Date): ParsedResult[] {
	const read = (t: string) => chronoEs.parse(t, now, { forwardDate: true });
	const out: ParsedResult[] = [];
	for (const r of read(text)) {
		const lone = /\s+a$/i.exec(r.text);
		const end = r.index + r.text.length;
		if (!lone || /^\.?\s?m(?:\.|(?!\p{L}))/iu.test(text.slice(end))) {
			out.push(r);
			continue;
		}
		const again = read(text.slice(0, end - lone[0].length)).find((s) => s.index === r.index);
		if (again) out.push(again);
	}
	return out;
}

function findDate(text: string, ctx: QuickAddContext): DateSpan | null {
	const languages = ctx.languages ?? DATE_LANGUAGES;
	// Every date rule below reads "today" and "now" from this, never from the host's zone directly.
	const now = wallClock(ctx.now, ctx.timeZone);
	const spans: DateSpan[] = [];
	for (const lang of languages) {
		const results = lang === 'en' ? chronoEnDayFirst.parse(text, now, { forwardDate: true }) : parseSpanish(text, now);
		spans.push(...toSpans(text, results, now));
		spans.push(...dayOfMonthSpans(text, now, lang));
	}
	if (languages.includes('es')) spans.push(...spanishSpans(text, now));
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

/**
 * A date written on its own ("fri 10:00", "by the 21st", "del 20 al 22 de octubre"), as quick add reads dates:
 * a range gives a start and a due date. Null unless the whole text is one date (a lead word such as "by" allowed).
 */
export function parseDateText(
	text: string,
	now: Date,
	languages?: readonly DateLanguage[],
	timeZone?: string,
): { start: string | null; due: string } | { problem: DateProblem } | null {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (!clean) return null;
	const figure = readFigureDate(clean);
	if (figure && 'problem' in figure) return figure;
	const date = findDate(clean, { now, types: [], matters: [], people: [], languages, timeZone });
	if (!date) return null;
	const from = withLead(clean, date.start);
	if (from !== 0 || clean.slice(date.end).replace(/[,.;!?]+$/, '') !== '') return null;
	if (date.problem) return { problem: date.problem };
	return { start: date.to ? formatMtmDate(date.from) : null, due: formatMtmDate(date.to ?? date.from) };
}

/** A date in figures, year first, standing on its own in the text (not inside a word, a version or a path). */
const FIGURE_IN_TEXT = /(?<![\p{L}\p{N}_./:-])\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:z|[+-]\d{2}(?::?\d{2})?)?(?![\p{L}\p{N}_/:-])/giu;

/**
 * Dates in figures that can't be read: no such day or time ("2026-13-12"), or a time zone ("2026-10-16T10:00Z").
 * They become invalid chips before chrono runs, so chrono can't read them as another day or time.
 * Real days are left to chrono, which reads them with what follows ("2026-10-16 at 10am").
 */
function figureProblems(input: string, tokens: readonly Chip[]): Chip[] {
	const out: Chip[] = [];
	for (const m of input.matchAll(FIGURE_IN_TEXT)) {
		const start = m.index ?? 0;
		const end = start + m[0].length;
		if (tokens.some((c) => start < c.end && end > c.start)) continue;
		const figure = readFigureDate(m[0]);
		if (figure && 'problem' in figure) out.push({ kind: 'invalid-date', text: m[0], start, end, problem: figure.problem });
	}
	return out;
}

// ——— Parse ———

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
	const tokens = findTokens(input, ctx);
	const chips = [...tokens, ...figureProblems(input, tokens)];

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
	// A date that isn't read keeps its text in the title, so nothing typed is lost.
	const removed = new Array<boolean>(input.length).fill(false);
	for (const c of chips) if (c.kind !== 'invalid-date') for (let i = c.start; i < c.end; i++) removed[i] = true;

	const date = findDate(compact, ctx);
	if (date?.problem) {
		const start = at[date.start] ?? 0, end = (at[date.end - 1] ?? 0) + 1;
		chips.push({ kind: 'invalid-date', text: input.slice(start, end), start, end, problem: date.problem });
	} else if (date) {
		const from = withLead(compact, date.start);
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
