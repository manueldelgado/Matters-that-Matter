// The operations other tools use: what they read (a snapshot of the vault), what they return (a result and a plan
// of writes), and how they fail. Pure: no file access and no clock; the caller applies the plan.

import type { MattersSettings, StatusCategory } from '../settings';
import type { Priority } from '../model/actions';
import type { MatterState } from '../model/matters';
import type { NoteData } from '../services/notesModel';

// ——— What the operations read ———

/**
 * The vault as the operations see it. Implemented over Obsidian's metadata cache in the plugin and over plain files
 * elsewhere; both must answer the same way. A snapshot stands still: operations keep what they read from it, so take
 * a new one after applying a plan.
 */
export interface Snapshot {
	readonly settings: MattersSettings;
	/** The time every rule uses (today, overdue, completion dates). */
	readonly now: Date;
	/** Every Markdown note in the vault, with its frontmatter (undefined when it has none). */
	readonly notes: readonly NoteData[];
	/**
	 * A note's whole content, frontmatter included; null when there is no such note. Synchronous: a host must have the
	 * content of every Action note ready when it builds the snapshot (the plugin reads them ahead with `cachedRead`).
	 * Operations ask only for Action notes.
	 */
	content(path: string): string | null;
	/** A note's outgoing links in its body, as written (link text, headings kept; embeds left out). */
	links(path: string): readonly string[];
	/** Resolves link text from a note as a wikilink would: the target file's path, or null. */
	resolve(link: string, fromPath: string): string | null;
	/** The link text that reaches `path` from `fromPath`, as Obsidian writes links, in the vault's link format. */
	linkText(path: string, fromPath: string): string;
	/** Whether a file or folder uses this path, ignoring case (as macOS and Windows do). */
	exists(path: string): boolean;
}

// ——— What the operations plan ———

/** A frontmatter entry of a new note; entries are written in this order. */
export type FrontmatterEntry = [key: string, value: unknown];

/** A change to a note's body, applied with `applyBodyEdit`; only the lines it targets change. */
export type BodyEdit =
	/** Replaces the details (the text at the start of the body, or between the details markers). */
	| { kind: 'details'; text: string }
	/** Adds checklist items after the last one, or at the end of the body. */
	| { kind: 'checklist'; items: string[] }
	/** Adds a line at the end of the body: a link to a note (`[[link text]]`) or a web address. */
	| { kind: 'link'; line: string };

/**
 * The writes an operation needs. Apply creates, then edits, then bodies, then renames: paths in edits and bodies are
 * the paths before any rename. Edits name `mtm-` keys only; every other key and line stays as it is.
 */
export interface Plan {
	creates: { path: string; frontmatter: FrontmatterEntry[]; body: string }[];
	edits: { path: string; set: Record<string, unknown>; remove: string[] }[];
	bodies: { path: string; edit: BodyEdit }[];
	renames: { from: string; to: string }[];
}

/** What a write changes, one entry per property, body part or file; values are null when absent. */
export type Change =
	| { kind: 'create'; path: string }
	| { kind: 'rename'; from: string; to: string }
	| { kind: 'property'; path: string; key: string; from: unknown; to: unknown }
	| { kind: 'details'; path: string; from: string; to: string }
	| { kind: 'checklist'; path: string; added: string[] }
	| { kind: 'link'; path: string; line: string };

// ——— How the operations answer ———

export type WarningCode =
	| 'unmatched-type'
	| 'unmatched-matter'
	| 'unmatched-status'
	| 'unmatched-person'
	| 'unmatched-sphere'
	| 'start-after-due'
	| 'newer-settings';

/** Something the operation did differently from what was asked, in the plugin's words. */
export interface Warning {
	code: WarningCode;
	/** The input field it concerns, by its public name (`type`, `waiting-on`, `text`…), when there is one. */
	field?: string;
	/** The value that matched nothing. */
	value?: string;
	message: string;
}

export type OpErrorCode = 'not-found' | 'ambiguous' | 'unmatched' | 'invalid' | 'not-ready';

/** Why nothing was planned. */
export interface OpError {
	code: OpErrorCode;
	/** By its public name (`waiting-on`, `review-every`, `due-from`…; see `PUBLIC_FIELDS`). */
	field?: string;
	value?: string;
	message: string;
	/** For `ambiguous`: what matched (paths of notes, labels of statuses, types and Spheres). For `unmatched`: the valid labels. */
	candidates?: string[];
}

export type OpResult<T> =
	| { ok: true; value: T; plan: Plan; changes: Change[]; warnings: Warning[] }
	| { ok: false; error: OpError };

// ——— Inputs ———

/**
 * Fields an Action can be given (camelCase here; other tools use the public names in `PUBLIC_FIELDS`). Statuses,
 * types, Matters and people are named by ID, label, name, path or link text.
 */
export interface ActionFields {
	title?: string;
	matter?: string;
	status?: string;
	type?: string;
	/** 1–3, or high, medium, low; null removes it (updates). */
	priority?: number | string | null;
	/** 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm' or words such as "fri 10:00"; null removes it (updates). */
	start?: string | null;
	due?: string | null;
	/** A person note; null removes it (updates). Setting someone also adds them to the people. */
	waitingOn?: string | null;
	/** Person notes; on update they replace the list. */
	people?: readonly string[];
	details?: string;
	/** Checklist items; on update they are added after the existing ones. */
	checklist?: readonly string[];
	/** A note in the vault or an http(s) address, written as a line at the end of the body. */
	link?: string;
}

export interface AddActionInput extends ActionFields {
	/** Quick add text; fields given separately win over what it says. */
	text?: string;
}

export interface UpdateActionInput extends ActionFields {
	/** The Action: its path (`.md` optional) or its title. */
	action: string;
}

export interface ListActionsInput {
	matter?: string;
	status?: string;
	type?: string;
	sphere?: string;
	/** Named in mtm-people or mtm-waiting-on. */
	person?: string;
	/** Due on or after / on or before these days (stored forms or words); undated Actions are left out. */
	dueFrom?: string;
	dueTo?: string;
	/** Only Actions waiting on someone. */
	waiting?: boolean;
	/** Include closed Actions (always when `status` names a closed status). */
	done?: boolean;
}

export interface AddMatterInput {
	name: string;
	/** A Lucide icon name; circle-dot when absent. */
	icon?: string;
	sphere?: string;
	/** Active when absent. */
	state?: string;
	outcome?: string;
	/** `<n>d`, `<n>w` or `<n>m`. */
	reviewEvery?: string;
}

// ——— Values ———

export interface NoteRef {
	/** Null when a link points to no note. */
	path: string | null;
	name: string;
}

/** An Action as every operation returns it: effective values for reading, raw `mtm-` values for reference. */
export interface ActionSummary {
	path: string;
	title: string;
	matter: { path: string; name: string; isInbox: boolean };
	status: { id: string; label: string; category: StatusCategory };
	type: { id: string; label: string };
	priority: Priority | null;
	/** In the stored forms. */
	start: string | null;
	due: string | null;
	/** Due today or late, not closed. */
	today: boolean;
	overdue: boolean;
	/** Only while not closed. */
	waitingOn: NoteRef | null;
	waitingSince: string | null;
	completed: string | null;
	/** Values that name nothing in the workflow or the vault; the effective values above stand in for them. */
	orphans: { field: 'status' | 'type' | 'matter'; raw: string }[];
	/** The note's `mtm-` properties as written. */
	raw: Record<string, unknown>;
}

export interface ActionDetail extends ActionSummary {
	details: string;
	checklist: { text: string; checked: boolean }[];
	/** Notes the body links to (names only, never their content), without the Matter and the people. */
	linkedNotes: NoteRef[];
	people: NoteRef[];
	startsAfterDue: boolean;
}

/** The result of a write to one Action. */
export interface ActionWrite {
	action: ActionSummary;
	/** False when the Action already was as asked and nothing is planned. */
	changed: boolean;
}

export interface MatterSummary {
	path: string;
	name: string;
	icon: string;
	isInbox: boolean;
	state: MatterState;
	sphere: { id: string; label: string } | null;
	/** An mtm-sphere value that names no Sphere. */
	sphereOrphan: string | null;
	outcome: string | null;
	laneOrder: number | null;
	review: { every: string; lastReviewed: string | null; nextDue: string | null; due: boolean; daysSince: number | null } | null;
	counts: { open: number; today: number; waiting: number; closed: number; total: number };
	/** An active Matter (not the Inbox) with nothing in motion. */
	noNextAction: boolean;
}

export interface TodayValue {
	date: string;
	/** Due today or late, not closed, in card order. */
	due: ActionSummary[];
	dueToday: number;
	late: number;
	/** With nothing due: the first open status after the backlog, and its open Actions. */
	nextStatus: { id: string; label: string } | null;
	next: ActionSummary[];
	/** Open Actions in the Inbox. */
	inbox: number;
	/** Active Matters whose review is due, most overdue first. */
	reviews: MatterSummary[];
	/** Open Actions waiting on someone, longest wait first. */
	waiting: ActionSummary[];
	longWaits: number;
}

export interface WorkflowValue {
	statuses: { id: string; label: string; category: StatusCategory; tone: string; backlog: boolean; done: boolean }[];
	types: { id: string; label: string; icon: string; tone: string; default: boolean }[];
	spheres: { id: string; label: string; icon: string }[];
}

export interface ParsedQuickAdd {
	title: string;
	status: { id: string; label: string };
	type: { id: string; label: string; isDefault: boolean };
	matter: { path: string; name: string; isDefault: boolean };
	people: NoteRef[];
	priority: Priority | null;
	start: string | null;
	due: string | null;
	/** Every token read, in order; `valid` is false for names that matched nothing. */
	chips: { kind: 'type' | 'matter' | 'person' | 'priority' | 'date'; text: string; valid: boolean }[];
}
