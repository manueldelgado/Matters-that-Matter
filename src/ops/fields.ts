// Reading the fields other tools pass: priorities, dates, links, and names matched against the workflow and the vault.

import type { Priority } from '../model/actions';
import { formatMtmDate, parseMtmDate, readFigureDate } from '../model/dates';
import { backlogStatus, checkFlags, defaultType } from '../model/workflow';
import { linkText } from '../services/effective';
import { matchDefined, matchNote, type Defined, type Match, type NamedNote } from '../services/match';
import type { MatterInfo } from '../services/boardModel';
import { noteId, type PersonCandidate } from '../services/notesModel';
import { parseDateText } from '../services/quickAddParser';
import { DEFAULT_SETTINGS, type SphereDef, type StatusDef, type TypeDef } from '../settings';
import { STRINGS } from '../strings';
import type { OpError, Snapshot, Warning } from './types';
import { publicField } from './fieldNames';
import { targetOf, vaultView } from './vaultView';

export type Read<T> = { ok: true; value: T } | { ok: false; error: OpError };

export const done = <T>(value: T): Read<T> => ({ ok: true, value });
export const fail = (error: OpError): { ok: false; error: OpError } => ({ ok: false, error });

const T = STRINGS.ops;

// ——— Is the vault ready? ———

/** Writes need setup done, settings this version understands and a workflow; reads need the workflow only. */
export function readiness(s: Snapshot, write: boolean): { error: OpError | null; warnings: Warning[] } {
	const problems = checkFlags(s.settings.statuses, s.settings.types);
	if (problems.includes('no-statuses') || problems.includes('no-types')) return { error: { code: 'not-ready', message: T.noWorkflow }, warnings: [] };
	const newer = s.settings.schemaVersion > DEFAULT_SETTINGS.schemaVersion;
	if (write && !s.settings.setupDone) return { error: { code: 'not-ready', message: T.notSetUp }, warnings: [] };
	if (write && newer) return { error: { code: 'not-ready', message: T.newerSettingsWrite }, warnings: [] };
	return { error: null, warnings: newer ? [{ code: 'newer-settings', message: T.newerSettings }] : [] };
}

/** The backlog status and the default type (readiness has checked there are statuses and types). */
export function fallbacks(s: Snapshot): { backlog: StatusDef; fallbackType: TypeDef } {
	const backlog = backlogStatus(s.settings.statuses) ?? s.settings.statuses[0];
	const fallbackType = defaultType(s.settings.types) ?? s.settings.types[0];
	if (!backlog || !fallbackType) throw new Error('The workflow has no statuses or no types');
	return { backlog, fallbackType };
}

// ——— Values ———

const PRIORITY_WORDS: Record<string, Priority> = { high: 1, medium: 2, low: 3 };

/** An empty value: refused where it would otherwise be read as removing the value (null does that). */
const empty = (field: string): { ok: false; error: OpError } => fail({ code: 'invalid', field, value: '', message: T.emptyValue(field) });

/** Whether a value is text with nothing but spaces in it. */
export const isBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() === '';

/** 1–3 or high, medium, low; null removes it. */
export function readPriority(value: number | string | null): Read<Priority | null> {
	if (value === null) return done(null);
	if (isBlank(value)) return empty('priority');
	const text = String(value).trim().toLowerCase();
	const word = PRIORITY_WORDS[text];
	if (word) return done(word);
	if (text === '1' || text === '2' || text === '3') return done(Number(text) as Priority);
	return fail({ code: 'invalid', field: 'priority', value: String(value), message: T.badPriority(String(value)) });
}

/** Starts like a calendar date in figures (2026-10-16, 2026/10/16): read only in a stored form, never as words. */
const LOOKS_STORED = /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

/**
 * A date in a stored form (seconds and a space allowed) or in words, as quick add reads them; null removes it.
 * Anything else that starts like a date in figures is refused rather than guessed: a time zone (`Z`, `+02:00`) or a
 * month or day out of range would otherwise be read as other words, and a different date would be stored. A time zone
 * in words ("fri 10am EST") is refused too: dates are local.
 */
export function readDate(key: string, value: string | null, s: Snapshot): Read<string | null> {
	const field = publicField(key);
	if (value === null) return done(null);
	if (isBlank(value)) return empty(field);
	const stored = parseMtmDate(value);
	if (stored) return done(formatMtmDate(stored));
	const figure = readFigureDate(value);
	if (figure && 'problem' in figure && figure.problem === 'time-zone') return fail({ code: 'invalid', field, value, message: T.zonedDate(value) });
	if (LOOKS_STORED.test(value)) return fail({ code: 'invalid', field, value, message: T.badStoredDate(value) });
	const words = parseDateText(value, s.now, s.settings.dateLanguages, s.timeZone);
	if (!words) return fail({ code: 'invalid', field, value, message: T.badDate(value) });
	if ('problem' in words) return fail({ code: 'invalid', field, value, message: words.problem === 'time-zone' ? T.zonedDate(value) : T.badDate(value) });
	if (words.start) return fail({ code: 'invalid', field, value, message: T.dateRange(value) });
	return done(words.due);
}

/**
 * The line a `link` adds to the body: an existing note as `[[link text]]` from the Action, or an http(s) address.
 * Anything else is refused.
 */
export function readLink(value: string, fromPath: string, s: Snapshot): Read<string> {
	const bad = fail({ code: 'invalid', field: 'link', value: String(value), message: T.badLink(String(value)) });
	if (typeof value !== 'string') return bad;
	const text = value.trim();
	if (!text || /[\r\n]/.test(text)) return bad;
	if (/^https?:\/\//i.test(text)) {
		// Spaces in an address are written as %20, so the line stays one link.
		const href = webAddress(text.replace(/\s/g, (ch) => (ch === ' ' ? '%20' : encodeURIComponent(ch))));
		return href ? done(`<${href}>`) : bad;
	}
	// A scheme other than http(s) is never a note.
	if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return bad;
	// A note: by its path (`.md` optional), else as a wikilink from the Action resolves.
	const target = linkText(text);
	if (!target) return bad;
	const lower = target.replace(/\.md$/i, '').toLowerCase();
	const byPath = s.notes.find((n) => n.path.replace(/\.md$/i, '').toLowerCase() === lower)?.path;
	const path = byPath ?? s.resolve(target, fromPath);
	if (!path || targetOf(path)?.extension !== 'md') return bad;
	return done(`[[${s.linkText(path, fromPath)}]]`);
}

/** Characters that could turn the rest of a line into Markdown, a query or a link of another kind. */
const MARKUP = /[[\]()`!|$<>]/g;

/**
 * An http(s) address as it is written in a note: parsed, with every character that Markdown or another plugin could
 * read as syntax percent-encoded, so the line stays one plain link. Null when it isn't an http(s) address.
 */
export function webAddress(text: string): string | null {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	return (
		url.href
			.replace(MARKUP, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
			// A `%` that starts no escape is encoded too, so `%%` (a comment marker) never reaches the note.
			.replace(/%(?![0-9a-f]{2})/gi, '%25')
	);
}

/** Lists from other tools must be lists of text. */
export function readList(field: string, value: unknown): Read<string[]> {
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return fail({ code: 'invalid', field, message: T.badList(field) });
	return done(value);
}

/** Text fields must be text. */
export function readText(field: string, value: unknown): Read<string> {
	return typeof value === 'string' ? done(value) : fail({ code: 'invalid', field, message: T.badText(field) });
}

/**
 * A line the plugin would read as a Details marker (`<!-- mtm-details…` or `<!-- /mtm-details…`): details holding one
 * would start or end somewhere else, and wouldn't read back as written. Spaces before it count too, to be safe.
 */
const DETAILS_MARKER = /^\s*<!--\s*\/?mtm-details(?![\w-])/m;

/** Details: text, without a line the plugin would read as a Details marker. */
export function readDetails(value: unknown): Read<string> {
	const text = readText('details', value);
	if (!text.ok) return text;
	if (DETAILS_MARKER.test(text.value)) return fail({ code: 'invalid', field: 'details', message: T.detailsMarker });
	return text;
}

// ——— Names ———

function ambiguous(field: string, value: string, message: string, candidates: string[]): OpError {
	return { code: 'ambiguous', field, value, message, candidates };
}

/** A match turned into an error when it isn't exactly one; `unmatched` gives the error for none. */
function strict<I, O>(m: Match<I>, field: string, value: string, several: string, candidate: (item: I) => string, unmatched: () => OpError, out: (item: I) => O): Read<O> {
	if (m.kind === 'match') return done(out(m.item));
	if (m.kind === 'ambiguous') return fail(ambiguous(field, value, several, m.items.map(candidate)));
	return fail(unmatched());
}

const labels = (items: readonly Defined[]) => items.map((i) => i.label);

export function findStatus(value: string, s: Snapshot): Read<StatusDef> {
	const list = s.settings.statuses;
	return strict(matchDefined(value, list), 'status', value, T.severalStatuses(value), (i) => i.label, () => ({
		code: 'unmatched', field: 'status', value, message: T.unmatchedStatus(value, labels(list)), candidates: labels(list),
	}), (i) => i);
}

export function findType(value: string, s: Snapshot): Read<TypeDef> {
	const list = s.settings.types;
	return strict(matchDefined(value, list), 'type', value, T.severalTypes(value), (i) => i.label, () => ({
		code: 'unmatched', field: 'type', value, message: T.unmatchedType(value, labels(list)), candidates: labels(list),
	}), (i) => i);
}

export function findSphere(value: string, s: Snapshot): Read<SphereDef> {
	const list = s.settings.spheres;
	return strict(matchDefined(value, list), 'sphere', value, T.severalSpheres(value), (i) => i.label, () => ({
		code: 'unmatched', field: 'sphere', value, message: T.unmatchedSphere(value, labels(list)), candidates: labels(list),
	}), (i) => i);
}

/** Matters as notes to match: every Matter, the Inbox included. */
const matterNotes = (s: Snapshot): (NamedNote & { matter: MatterInfo })[] => {
	const view = vaultView(s);
	return view.matters.map((m) => ({ path: m.path, name: m.name, id: noteId(view.byPath.get(m.path)?.frontmatter), matter: m }));
};

export function findMatter(value: string, s: Snapshot, fromPath = ''): Read<MatterInfo> {
	return strict(matchNote(value, matterNotes(s), (t) => s.resolve(t, fromPath)), 'matter', value, T.severalMatters(value), (i) => i.path, () => ({
		code: 'unmatched', field: 'matter', value, message: T.unmatchedMatter(value),
	}), (i) => i.matter);
}

/** The kind of the Matter or Action named exactly so, for saying why it isn't a person; null when none is. */
export function notAPerson(value: string, s: Snapshot, fromPath = ''): 'matter' | 'action' | null {
	const notes = s.notes
		.filter((n) => n.frontmatter?.['mtm-kind'] === 'matter' || n.frontmatter?.['mtm-kind'] === 'action')
		.map((n) => ({ path: n.path, name: n.basename, kind: n.frontmatter?.['mtm-kind'] as 'matter' | 'action' }));
	const m = matchNote(value, notes, (t) => s.resolve(t, fromPath), { exact: true });
	return m.kind === 'match' ? m.item.kind : m.kind === 'ambiguous' ? (m.items[0]?.kind ?? null) : null;
}

/**
 * People are notes without mtm-kind; those in the people folder win ties. Never created. `filter` when the person
 * only narrows what is read (nothing would be created there anyway).
 */
export function findPerson(key: string, value: string, s: Snapshot, fromPath = '', filter = false): Read<PersonCandidate> {
	const field = publicField(key);
	const unmatched = (): OpError => {
		const kind = notAPerson(value, s, fromPath);
		const message = kind ? T.notAPerson(value, kind) : filter ? T.noNote(value) : T.unmatchedPerson(value);
		return { code: 'unmatched', field, value, message };
	};
	return strict(matchNote(value, vaultView(s).people, (t) => s.resolve(t, fromPath)), field, value, T.severalPeople(value), (i) => i.path, unmatched, (i) => i);
}
