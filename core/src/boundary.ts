// What crosses the core bundle's boundary: one request in, one response out, both JSON. The JSON Schemas in
// core/schema/ are generated from these types (`npm run schema:core`), so their doc comments are the schemas'
// descriptions. The boundary is versioned: a change that a caller written for an earlier version could misread raises
// `BOUNDARY`; new optional fields, operations, warning codes and error codes don't.

import type { MergeDecision, MergeInput } from '../../src/files/merge';
import type { FileOutcome, WriteErrorCode } from '../../src/files/write';
import type {
	ActionDetail,
	ActionSummary,
	ActionWrite,
	AddActionInput,
	AddMatterInput,
	Change,
	ListActionsInput,
	MatterSummary,
	OpErrorCode,
	Plan,
	TodayValue,
	UpdateActionInput,
	Warning,
	WorkflowValue,
} from '../../src/ops/types';

/** The boundary's version, carried by every response. */
export const BOUNDARY = 1;

// ——— The vault, as the caller hands it over ———

/**
 * A UUID, as `mtm-id` holds it: the only form the core reads back as a note's ID.
 * @pattern ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$
 */
export type Uuid = string;

/** The vault's link settings (Obsidian's `app.json`); Obsidian's defaults where absent. */
export interface LinkSettings {
	/** "Automatically update internal links": renames rewrite links in other notes. Off when absent. */
	alwaysUpdateLinks?: boolean;
	/** "New link format". Shortest when absent. */
	newLinkFormat?: 'shortest' | 'relative' | 'absolute';
	/** "Use [[Wikilinks]]" off. Off when absent. */
	useMarkdownLinks?: boolean;
}

/**
 * The vault at one moment. The core reads it as Obsidian's metadata cache would: each note's properties, links and
 * embeds come from its content, and links resolve over `files` the way a wikilink does, so the caller passes files,
 * not a cache. Paths are vault paths: `/`-separated, relative to the vault root, with their extension.
 */
export interface SerialisedSnapshot {
	/**
	 * Every file in the vault, of any kind (attachments too: links resolve to them). Files Obsidian doesn't list are
	 * left out by the core: those in the configuration folder, and any file or folder whose name starts with a dot.
	 */
	files: string[];
	/** The text of every Markdown note in `files`, by path. A note missing here reads as empty. */
	contents: Record<string, string>;
	/** The plugin's settings as stored (its `data.json`), read and migrated as the plugin reads them. */
	settings: Record<string, unknown>;
	/** The vault's link settings. */
	linkSettings?: LinkSettings;
	/** The vault's configuration folder, which the core leaves out of `files`. `.obsidian` when absent. */
	configDir?: string;
	/** The moment every rule reads (today, overdue, completion dates): ISO 8601 with a zone (`2026-10-09T10:00:00Z`). */
	now: string;
	/** The IANA time zone `now` is read in (`Europe/Madrid`): "today", overdue and the dates written follow its wall clock. */
	timeZone: string;
	/**
	 * Each Markdown note's version as read: an opaque token that changes whenever its bytes do (a SHA-256 of the
	 * content, say). Given, every Markdown note needs one, and write plans record what they were computed from (`basis`).
	 */
	versions?: Record<string, string>;
	/** The settings' version as read, a token like `versions`'. */
	settingsVersion?: string;
	/**
	 * New IDs (UUIDs) for `mtm-id`, used in order: each Action and Matter gets one when it is created, or at its first
	 * write if it has none. Absent, no IDs are written. Too few, and the request fails with `not-enough-ids`.
	 */
	ids?: Uuid[];
}

// ——— Requests ———

/** An Action named by its path (`.md` optional) or its title. */
export interface ActionRef {
	action: string;
}

/** The input of an operation that takes none. */
export type NoInput = Record<string, never>;

interface Request<Op extends string, Input> {
	op: Op;
	input: Input;
	snapshot: SerialisedSnapshot;
	/** The boundary version the caller was written for; a different one is refused (`unsupported-boundary`). */
	boundary?: number;
}

interface WriteRequest<Op extends string, Input> extends Request<Op, Input> {
	/** Also apply the plan to the snapshot's files and return what every file would hold (`files`). */
	apply?: boolean;
}

export type AddActionRequest = WriteRequest<'addAction', AddActionInput>;
export type UpdateActionRequest = WriteRequest<'updateAction', UpdateActionInput>;
export type MarkAsDoneRequest = WriteRequest<'markAsDone', ActionRef>;
export type ReopenActionRequest = WriteRequest<'reopenAction', ActionRef>;
export type AddMatterRequest = WriteRequest<'addMatter', AddMatterInput>;
export type GetActionRequest = Request<'getAction', ActionRef>;
export type ListActionsRequest = Request<'listActions', ListActionsInput>;
export type GetTodayRequest = Request<'getToday', NoInput>;
export type ListMattersRequest = Request<'listMatters', NoInput>;
export type GetWorkflowRequest = Request<'getWorkflow', NoInput>;

/** Three versions of one note merged into one. Needs no snapshot. */
export interface MergeNoteRequest {
	op: 'mergeNote';
	input: MergeInput;
	boundary?: number;
}

/** One request to the core. */
export type CoreRequest =
	| AddActionRequest
	| UpdateActionRequest
	| MarkAsDoneRequest
	| ReopenActionRequest
	| GetActionRequest
	| ListActionsRequest
	| GetTodayRequest
	| AddMatterRequest
	| ListMattersRequest
	| GetWorkflowRequest
	| MergeNoteRequest;

export type CoreOp = CoreRequest['op'];

// ——— Responses ———

/** A merge's value: the merged content and what it chose where both sides changed the same thing. */
export interface MergeValue {
	content: string;
	decisions: MergeDecision[];
}

interface Answer<Op extends string, Value> {
	boundary: number;
	ok: true;
	op: Op;
	value: Value;
	/** Things done differently from what was asked. */
	warnings: Warning[];
	/** The writes to make; empty for reads. */
	plan: Plan;
	/** What the writes change, one entry per property, body part or file. */
	changes: Change[];
	/** How many of the snapshot's `ids` the plan used, from the first. */
	idsUsed: number;
	/** With `apply`: what every file holds after the plan. */
	files?: FileOutcome;
}

export type AddActionResponse = Answer<'addAction', ActionWrite>;
export type UpdateActionResponse = Answer<'updateAction', ActionWrite>;
export type MarkAsDoneResponse = Answer<'markAsDone', ActionWrite>;
export type ReopenActionResponse = Answer<'reopenAction', ActionWrite>;
export type AddMatterResponse = Answer<'addMatter', MatterSummary>;
export type GetActionResponse = Answer<'getAction', ActionDetail>;
export type ListActionsResponse = Answer<'listActions', ActionSummary[]>;
export type GetTodayResponse = Answer<'getToday', TodayValue>;
export type ListMattersResponse = Answer<'listMatters', MatterSummary[]>;
export type GetWorkflowResponse = Answer<'getWorkflow', WorkflowValue>;
export type MergeNoteResponse = Answer<'mergeNote', MergeValue>;

/**
 * Why a request failed. The operations' own codes (`not-found`, `ambiguous`, `unmatched`, `invalid`, `not-ready`)
 * and the boundary's: a request that isn't valid JSON or doesn't fit the schema (`bad-request`), a boundary version
 * the core doesn't speak (`unsupported-boundary`), a snapshot that contradicts itself (`bad-snapshot`), too few IDs
 * (`not-enough-ids`), a plan that can't be applied to the snapshot's files (`write-failed`), and anything unexpected
 * (`internal`, a bug).
 */
export type CoreErrorCode = OpErrorCode | 'bad-request' | 'unsupported-boundary' | 'bad-snapshot' | 'not-enough-ids' | 'write-failed' | 'internal';

export interface CoreError {
	code: CoreErrorCode;
	message: string;
	/**
	 * Where it went wrong. For the operations' own errors, the input field by its public name, as other tools name it
	 * (`waiting-on`, `due-from`); for the boundary's, a JSON Pointer into the request (`/input/title`, `/snapshot/now`).
	 */
	field?: string;
	value?: string;
	/** For `ambiguous`: what matched. For `unmatched`: the valid labels. */
	candidates?: string[];
	/** For `write-failed`: why the files layer refused the plan, and the file. */
	writeCode?: WriteErrorCode;
	path?: string;
}

export interface Failure {
	boundary: number;
	ok: false;
	/** The request's operation, when it could be read. */
	op?: CoreOp;
	error: CoreError;
}

/** One response from the core. */
export type CoreResponse =
	| AddActionResponse
	| UpdateActionResponse
	| MarkAsDoneResponse
	| ReopenActionResponse
	| GetActionResponse
	| ListActionsResponse
	| GetTodayResponse
	| AddMatterResponse
	| ListMattersResponse
	| GetWorkflowResponse
	| MergeNoteResponse
	| Failure;
