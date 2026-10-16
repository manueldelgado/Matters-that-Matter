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

// ——— Held snapshots ———

/**
 * A snapshot the core holds (from `openSnapshot`), with what changes from one request to the next. The answer is the
 * one the held files would get handed over whole with this clock, zone and IDs.
 */
export interface HeldRef {
	/** The handle `openSnapshot` answered. */
	handle: string;
	/** As the snapshot's `now`: ISO 8601 with a zone. */
	now: string;
	/** As the snapshot's `timeZone`. */
	timeZone: string;
	/** As the snapshot's `ids`: new IDs for this request, used in order. */
	ids?: Uuid[];
}

/** A note's properties as the core read them, for one version of the note (from `exportCache`). */
export interface CachedNote {
	version: string;
	/** The properties; null when the note has none the core can read. */
	frontmatter: Record<string, unknown> | null;
	/** Where the properties block ends: its closing line and the offset after it; null with no properties. */
	end: { line: number; offset: number } | null;
	/** The first line of the body. */
	bodyLine: number;
}

/**
 * Notes' properties as read, by path, to keep between launches (`exportCache`) and hand back to `openSnapshot`: a
 * note whose version is the same there is not read again. It is the core's own reading: hand it back unchanged.
 */
export interface SnapshotCache {
	format: 1;
	notes: Record<string, CachedNote>;
}

export interface OpenSnapshotInput {
	/** Properties read earlier, from `exportCache`. Used only with versions, for notes whose version is the same. */
	cache?: SnapshotCache;
}

/** A held snapshot, named by its handle. */
export interface HandleInput {
	handle: string;
}

/** A file that changed: added (with its text, for a note), its text changed, or removed. */
export interface FileChange {
	path: string;
	/** A note's new text. */
	content?: string;
	/** The note's new version; only for a snapshot opened with versions, and then needed for every new note. */
	version?: string;
	/** The file is gone. */
	removed?: boolean;
}

/** A file renamed or moved, keeping its text and version. */
export interface FileRename {
	from: string;
	to: string;
}

/**
 * What changed in a held snapshot since it was opened or last changed: renames first, then files, then the settings.
 * Only what changed: every other file stays as held.
 */
export interface SnapshotChange {
	handle: string;
	renames?: FileRename[];
	files?: FileChange[];
	/** The plugin's settings as stored, when they changed (all of them, not only what changed). */
	settings?: Record<string, unknown>;
	/** The settings' new version. */
	settingsVersion?: string;
	/** The vault's link settings, when they changed (all of them). */
	linkSettings?: LinkSettings;
}

// ——— Requests ———

/** An Action named by its path (`.md` optional), its title or its `mtm-id`. */
export interface ActionRef {
	action: string;
}

/** The input of an operation that takes none. */
export type NoInput = Record<string, never>;

interface Request<Op extends string, Input> {
	op: Op;
	input: Input;
	/** The vault, handed over whole. Give this or `held`, not both. */
	snapshot?: SerialisedSnapshot;
	/** A snapshot the core holds, with this request's clock, zone and IDs. Give this or `snapshot`, not both. */
	held?: HeldRef;
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

/** Holds the vault handed over, for later requests to name by its handle (`held`), until `closeSnapshot`. */
export interface OpenSnapshotRequest {
	op: 'openSnapshot';
	input: OpenSnapshotInput;
	snapshot: SerialisedSnapshot;
	boundary?: number;
}

/** Tells a held snapshot what changed. All or nothing. */
export interface ChangeSnapshotRequest {
	op: 'changeSnapshot';
	input: SnapshotChange;
	boundary?: number;
}

/** A held snapshot's notes' properties as read, to keep for the next `openSnapshot`. */
export interface ExportCacheRequest {
	op: 'exportCache';
	input: HandleInput;
	boundary?: number;
}

/** Lets a held snapshot go. */
export interface CloseSnapshotRequest {
	op: 'closeSnapshot';
	input: HandleInput;
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
	| MergeNoteRequest
	| OpenSnapshotRequest
	| ChangeSnapshotRequest
	| ExportCacheRequest
	| CloseSnapshotRequest;

/** The requests that run an operation on a vault: with `snapshot` or `held`. */
export type VaultRequest = Exclude<CoreRequest, MergeNoteRequest | OpenSnapshotRequest | ChangeSnapshotRequest | ExportCacheRequest | CloseSnapshotRequest>;

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

/** A held snapshot: its handle, and how many notes it holds. */
export interface HeldValue {
	handle: string;
	notes: number;
}

/** Whether the core held the snapshot it was asked to let go. */
export interface ClosedValue {
	closed: boolean;
}

export type OpenSnapshotResponse = Answer<'openSnapshot', HeldValue>;
export type ChangeSnapshotResponse = Answer<'changeSnapshot', HeldValue>;
export type ExportCacheResponse = Answer<'exportCache', SnapshotCache>;
export type CloseSnapshotResponse = Answer<'closeSnapshot', ClosedValue>;

/**
 * Why a request failed. The operations' own codes (`not-found`, `ambiguous`, `unmatched`, `invalid`, `not-ready`)
 * and the boundary's: a request that isn't valid JSON or doesn't fit the schema (`bad-request`), a boundary version
 * the core doesn't speak (`unsupported-boundary`), a snapshot that contradicts itself (`bad-snapshot`), too few IDs
 * (`not-enough-ids`), a plan that can't be applied to the snapshot's files (`write-failed`), and anything unexpected
 * (`internal`, a bug), and a held snapshot the core doesn't hold (`unknown-snapshot`: closed, or the core loaded again).
 */
export type CoreErrorCode = OpErrorCode | 'bad-request' | 'unsupported-boundary' | 'bad-snapshot' | 'not-enough-ids' | 'unknown-snapshot' | 'write-failed' | 'internal';

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
	| OpenSnapshotResponse
	| ChangeSnapshotResponse
	| ExportCacheResponse
	| CloseSnapshotResponse
	| Failure;
