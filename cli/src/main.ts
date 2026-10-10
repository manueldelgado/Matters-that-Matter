// The command line: arguments in, an operation on a snapshot of the vault, human or JSON output, an exit code.
// Exit codes: 0 done; 1 nothing matched, several did, or the input can't be read (nothing written); 2 the vault
// isn't ready; 3 a file changed while writing.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VaultReader } from '../../src/files/index';
import { toYmd } from '../../src/model/dates';
import { addAction, addMatter, getAction, getWorkflow, listActions, listMatters, markAsDone, parseQuickAdd, reopen, today, updateAction } from '../../src/ops';
import { findMatter } from '../../src/ops/fields';
import type { ActionFields, ActionWrite, ListActionsInput, MatterSummary, OpError, OpResult, Plan, Snapshot, Warning } from '../../src/ops/types';
import { applyOutcome, type ApplyFs, type ApplyResult } from './apply';
import { boolFlag, listFlag, parseArgs, textFlag, type Command, type FlagValue } from './args';
import { contentsAfter as defaultContentsAfter, snapshotOf, WriteError, type ContentsAfter, type FileOutcome } from './filesLayer';
import { cachingReader, fsVaultReader } from './fsVault';
import { errorJson, stringify, writeJson, type ErrorJson } from './json';
import { obsidianSettingsDir, openUrl, systemOpener, vaultRef, type Opener, type OpenTarget } from './open';
import {
	colourFor,
	formatAdded,
	formatChanged,
	formatError,
	formatList,
	formatMatterAdded,
	formatMatters,
	formatParse,
	formatShow,
	formatToday,
	formatWorkflow,
	markup,
	style,
	type Style,
} from './output';
import { STRINGS } from '../../src/strings';
import { CLI, COMMAND_HELP, HELP } from './strings';
import { openVault, type Vault } from './vault';

export const EXIT = { done: 0, unmatched: 1, notReady: 2, changed: 3 } as const;

interface Stream {
	write(text: string): unknown;
	isTTY?: boolean;
}

/** Everything the command line reaches outside itself, so tests can run it in-process. */
export interface CliIo {
	stdout: Stream;
	stderr: Stream;
	env: Readonly<Record<string, string | undefined>>;
	cwd: string;
	/** The home folder, for `~` in paths. */
	home: string;
	/** The clock when `--now` isn't given. */
	clock?: () => Date;
	opener?: Opener;
	/** The plan applier; the files layer's when absent. */
	contentsAfter?: ContentsAfter;
	/** The vault's files; on disk when absent. */
	reader?: (root: string, configDir: string) => VaultReader;
	/** The file operations writes use; Node's when absent. */
	fs?: ApplyFs;
	/** Obsidian's own settings folder (where `obsidian.json` lists the vaults); the system's when absent, none when null. */
	obsidianDir?: string | null;
}

interface Context {
	io: CliIo;
	vault: Vault;
	flags: Record<string, FlagValue>;
	words: string[];
	json: boolean;
	dryRun: boolean;
	now: Date;
	out: Style;
	err: Style;
}

const print = (stream: Stream, lines: string | readonly string[]) => stream.write(`${typeof lines === 'string' ? lines : lines.join('\n')}\n`);

/** `--now 2026-10-09T12:00`: a day or a local time. */
export function parseNow(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
	if (!m) return null;
	const [y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
	const date = new Date(y, mo - 1, d, h, mi, s);
	return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
	const out = style(colourFor(io.stdout.isTTY, io.env));
	const err = style(colourFor(io.stderr.isTTY, io.env));
	// `mtm help` and `mtm help <command>` are `--help`.
	const args = argv[0] === 'help' ? [...argv.slice(1), '--help'] : argv;
	const parsed = parseArgs(args);
	// Arguments that can't be parsed still answer in JSON when they ask for it.
	const json = parsed.ok ? boolFlag(parsed.args.flags, 'json') : args.includes('--json');
	const usage = (message: string) => {
		if (json) print(io.stdout, stringify(errorJson({ code: 'usage', message })));
		else print(io.stderr, err.r(message));
		return EXIT.unmatched;
	};
	if (!parsed.ok) return usage(parsed.message);
	const { command, words, flags } = parsed.args;

	if (boolFlag(flags, 'version')) {
		print(io.stdout, CLI.version);
		return EXIT.done;
	}
	if (boolFlag(flags, 'help') || command === null) {
		print(io.stdout, markup(command ? (COMMAND_HELP[command] ?? HELP) : HELP, out));
		return EXIT.done;
	}
	if (command === 'mcp') {
		// The MCP server comes with its own module; until then the command says so.
		print(io.stderr, CLI.mcpLater);
		return EXIT.unmatched;
	}

	let now = io.clock?.() ?? new Date();
	const nowFlag = textFlag(flags, 'now');
	if (nowFlag) {
		const fixed = parseNow(nowFlag);
		if (!fixed) return usage(CLI.badNow(nowFlag));
		now = fixed;
	}

	const opened = openVault(textFlag(flags, 'vault') ?? io.env.MTM_VAULT, textFlag(flags, 'config-dir') ?? undefined, io.cwd, io.home);
	if (!opened.ok) {
		if (json) print(io.stdout, stringify(errorJson({ code: 'not-ready', message: opened.message })));
		else print(io.stderr, err.r(opened.message));
		return EXIT.notReady;
	}

	const ctx: Context = { io, vault: opened.vault, flags, words, json, dryRun: boolFlag(flags, 'dry-run'), now, out, err };
	return dispatch(command, ctx);
}

// ——— Commands ———

async function dispatch(command: Exclude<Command, 'mcp'>, ctx: Context): Promise<number> {
	const ref = ctx.words.join(' ').trim();
	switch (command) {
		case 'today':
			return read(ctx, today, (v, s) => formatToday(v, shownPath(ctx), typeTones(s), ctx.out));
		case 'workflow':
			return read(ctx, getWorkflow, (v) => formatWorkflow(v, ctx.out));
		case 'matters':
			return read(ctx, listMatters, (v) => formatMatters(v, ctx.out));
		case 'list':
			return read(ctx, (s) => listActions(listInput(ctx.flags), s), (v, s) => formatList(v, toYmd(s.now), typeTones(s), ctx.out));
		case 'show':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return read(ctx, (s) => getAction(ref, s), (v, s) => formatShow(v, toYmd(s.now), ctx.out));
		case 'parse':
			if (!ref) return usageError(ctx, CLI.noParseText);
			return read(ctx, (s) => parseQuickAdd(ref, s), (v, s, w) => formatParse(v, w, toYmd(s.now), ctx.out), true);
		case 'add':
			return writeAction(ctx, (s) => addAction({ ...(ref ? { text: ref } : {}), ...fieldInput(ctx.flags) }, s), null);
		case 'update':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return writeAction(ctx, (s) => updateAction({ action: ref, ...fieldInput(ctx.flags) }, s), CLI.changed);
		case 'done':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return writeAction(ctx, (s) => markAsDone(ref, s), CLI.markedDone);
		case 'reopen':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return writeAction(ctx, (s) => reopen(ref, s), CLI.reopened);
		case 'add-matter':
			if (!ref) return usageError(ctx, CLI.nameNew);
			return writeMatter(ctx, ref);
		case 'open':
			if (!ref) return usageError(ctx, CLI.nameMatter);
			return open(ctx, ref);
	}
}

/** The fields an Action command was given, by their public names. */
function fieldInput(flags: Record<string, FlagValue>): ActionFields {
	const input: ActionFields = {};
	for (const name of ['title', 'matter', 'status', 'type', 'details', 'link'] as const) {
		const v = textFlag(flags, name);
		if (typeof v === 'string') input[name] = v;
	}
	for (const [flag, key] of [
		['priority', 'priority'],
		['start', 'start'],
		['due', 'due'],
		['waiting-on', 'waitingOn'],
	] as const) {
		const v = textFlag(flags, flag);
		if (v !== undefined) input[key] = v;
	}
	const people = listFlag(flags, 'people');
	if (people !== undefined) input.people = people ?? [];
	const checklist = listFlag(flags, 'checklist');
	if (checklist) input.checklist = checklist;
	return input;
}

function listInput(flags: Record<string, FlagValue>): ListActionsInput {
	const input: ListActionsInput = {};
	for (const [flag, key] of [
		['matter', 'matter'],
		['status', 'status'],
		['type', 'type'],
		['sphere', 'sphere'],
		['person', 'person'],
		['due-from', 'dueFrom'],
		['due-to', 'dueTo'],
	] as const) {
		const v = textFlag(flags, flag);
		if (typeof v === 'string') input[key] = v;
	}
	if (boolFlag(flags, 'waiting')) input.waiting = true;
	if (boolFlag(flags, 'done')) input.done = true;
	return input;
}

// ——— Reading ———

function snapshot(ctx: Context): { snap: Snapshot; reader: VaultReader } {
	const { root, configDir, settings } = ctx.vault;
	// One read per file per attempt, so a plan's `before` is exactly what the snapshot saw.
	const reader = cachingReader((ctx.io.reader ?? fsVaultReader)(root, configDir));
	return { snap: snapshotOf(reader, configDir, settings, ctx.now), reader };
}

const typeTones = (s: Snapshot) => new Map(s.settings.types.map((t) => [t.id, t.tone]));

/** The vault as the today header shows it: `~/Notes`. */
function shownPath(ctx: Context): string {
	const { root } = ctx.vault;
	const home = ctx.io.home.replace(/[\\/]+$/, '');
	return home && (root === home || root.startsWith(`${home}/`)) ? `~${root.slice(home.length)}` : root;
}

/** Warnings about the vault as a whole go to stderr, so stdout stays the answer. */
function vaultWarnings(ctx: Context, warnings: readonly Warning[]): void {
	for (const w of warnings) if (w.code === 'newer-settings') print(ctx.io.stderr, ctx.err.y(w.message));
}

const exitFor = (e: OpError) => (e.code === 'not-ready' ? EXIT.notReady : EXIT.unmatched);

function opError(ctx: Context, e: OpError, write: boolean): number {
	if (ctx.json) print(ctx.io.stdout, stringify(errorJson(e)));
	else print(ctx.io.stderr, formatError(e, write, ctx.err));
	return exitFor(e);
}

function usageError(ctx: Context, message: string): number {
	if (ctx.json) print(ctx.io.stdout, stringify(errorJson({ code: 'usage', message })));
	else print(ctx.io.stderr, ctx.err.r(message));
	return EXIT.unmatched;
}

/** Reads work before setup, but say so: what they show may not be what Matters will show. */
function setupHint(ctx: Context): void {
	if (!ctx.vault.settings.setupDone) print(ctx.io.stderr, ctx.err.y(STRINGS.ops.notSetUp));
}

/**
 * A read: the value on stdout, warnings about the vault on stderr. With `keepWarnings` (parse), the warnings about
 * the input belong to the answer: in the human output, and in the JSON as `warnings`.
 */
function read<T>(ctx: Context, op: (s: Snapshot) => OpResult<T>, human: (value: T, s: Snapshot, warnings: Warning[]) => string[], keepWarnings = false): number {
	const { snap } = snapshot(ctx);
	const r = op(snap);
	if (!r.ok) return opError(ctx, r.error, false);
	setupHint(ctx);
	vaultWarnings(ctx, r.warnings);
	const warnings = keepWarnings ? r.warnings.filter((w) => w.code !== 'newer-settings') : [];
	if (ctx.json) print(ctx.io.stdout, stringify(keepWarnings ? { ...r.value, warnings } : r.value));
	else print(ctx.io.stdout, human(r.value, snap, warnings));
	return EXIT.done;
}

// ——— Writing ———

const planIsEmpty = (p: Plan) => !p.creates.length && !p.edits.length && !p.bodies.length && !p.renames.length;

type Written<T> = { r: Extract<OpResult<T>, { ok: true }>; snap: Snapshot; outcome: FileOutcome | null; written: boolean };

/**
 * Plans on a fresh snapshot, then writes all or nothing. A file that changed after it was read stops the write
 * before anything is written; the whole write is planned again once, and a second change gives exit code 3. A write
 * that fails is put back and gives exit code 3 too.
 */
function write<T>(ctx: Context, op: (s: Snapshot) => OpResult<T>): Written<T> | number {
	const writer = ctx.io.contentsAfter ?? defaultContentsAfter;
	for (let attempt = 1; ; attempt++) {
		const { snap, reader } = snapshot(ctx);
		const r = op(snap);
		if (!r.ok) return opError(ctx, r.error, true);
		const planOut = textFlag(ctx.flags, 'plan-out');
		if (planOut) {
			try {
				writeFileSync(resolve(ctx.io.cwd, planOut), `${stringify(r.plan)}\n`, 'utf8');
			} catch {
				return usageError(ctx, CLI.planOutFailed(planOut));
			}
		}
		if (planIsEmpty(r.plan)) return { r, snap, outcome: null, written: false };
		let outcome: FileOutcome;
		try {
			outcome = writer(r.plan, reader, { configDir: ctx.vault.configDir });
		} catch (e) {
			if (!(e instanceof WriteError)) throw e;
			// A file the snapshot saw is gone, or one it didn't see is there: the vault changed; plan again once.
			if (attempt === 1 && (e.code === 'exists' || e.code === 'missing')) continue;
			return planFailure(ctx, e);
		}
		if (ctx.dryRun) return { r, snap, outcome, written: false };
		const applied = applyOutcome(ctx.vault.root, outcome, ctx.io.fs);
		if (applied.ok) return { r, snap, outcome, written: true };
		if (attempt === 1 && applied.reason === 'changed') continue;
		return writeFailure(ctx, applied);
	}
}

/**
 * A plan the files layer can't apply; nothing is written. The vault changed (exit 3), or a note's properties can't
 * be edited (exit 1).
 */
function planFailure(ctx: Context, e: WriteError): number {
	const changed = e.code === 'exists' || e.code === 'missing';
	const message = e.code === 'exists' ? CLI.exists(e.path) : e.code === 'missing' ? CLI.missing(e.path) : e.code === 'invalid-properties' ? CLI.unreadableProperties(e.path) : CLI.notMtm(e.path);
	if (ctx.json) print(ctx.io.stdout, stringify(errorJson({ code: e.code, message, path: e.path })));
	else print(ctx.io.stderr, ctx.err.r(message));
	return changed ? EXIT.changed : EXIT.unmatched;
}

/** Why a write stopped, and whether anything was left changed. Exit code 3. */
function writeFailure(ctx: Context, failed: Exclude<ApplyResult, { ok: true }>): number {
	let message: string;
	let left: string[] = [];
	if (failed.reason === 'changed') message = CLI.changedMeanwhile(failed.path);
	else if (failed.reason === 'unsafe') message = CLI.outsideVault(failed.path);
	else {
		left = failed.left;
		message = left.length ? CLI.writeFailedLeft(failed.path, failed.error, left) : CLI.writeFailed(failed.path, failed.error);
	}
	if (ctx.json) print(ctx.io.stdout, stringify(errorJson({ code: failed.reason, message, path: failed.path, left })));
	else print(ctx.io.stderr, ctx.err.r(message));
	return EXIT.changed;
}

/** Add, update, done, reopen: `verb` is null for add. */
function writeAction(ctx: Context, op: (s: Snapshot) => OpResult<ActionWrite>, verb: string | null): number {
	const w = write(ctx, op);
	if (typeof w === 'number') return w;
	const { r, snap, outcome, written } = w;
	vaultWarnings(ctx, r.warnings);
	if (ctx.json) {
		print(ctx.io.stdout, stringify(writeJson({ action: r.value.action }, r, outcome, ctx.dryRun, written)));
		return EXIT.done;
	}
	const today = toYmd(snap.now);
	if (verb === null) {
		print(ctx.io.stdout, formatAdded(r.value.action, r.warnings, today, ctx.dryRun, ctx.out));
		return EXIT.done;
	}
	const beforePath = r.plan.edits[0]?.path ?? r.plan.bodies[0]?.path ?? r.plan.renames[0]?.from ?? r.value.action.path;
	const before = { path: beforePath, title: (beforePath.split('/').pop() ?? beforePath).replace(/\.md$/i, '') };
	print(ctx.io.stdout, formatChanged(verb, before, r.value.action, r.changes, r.warnings, outcome, ctx.dryRun, ctx.out));
	return EXIT.done;
}

function writeMatter(ctx: Context, name: string): number {
	const f = ctx.flags;
	const input = { name } as Parameters<typeof addMatter>[0];
	for (const [flag, key] of [
		['icon', 'icon'],
		['sphere', 'sphere'],
		['state', 'state'],
		['outcome', 'outcome'],
		['review-every', 'reviewEvery'],
	] as const) {
		const v = textFlag(f, flag);
		if (typeof v === 'string') input[key] = v;
	}
	const w = write<MatterSummary>(ctx, (s) => addMatter(input, s));
	if (typeof w === 'number') return w;
	const { r, outcome, written } = w;
	vaultWarnings(ctx, r.warnings);
	if (ctx.json) print(ctx.io.stdout, stringify(writeJson({ matter: r.value }, r, outcome, ctx.dryRun, written)));
	else print(ctx.io.stdout, formatMatterAdded(r.value, r.warnings, ctx.dryRun, ctx.out));
	return EXIT.done;
}

// ——— Opening ———

async function open(ctx: Context, ref: string): Promise<number> {
	const { snap } = snapshot(ctx);
	setupHint(ctx);
	let target: OpenTarget;
	let name: string;
	const action = getAction(ref, snap);
	if (action.ok) {
		target = { file: action.value.path };
		name = action.value.title;
	} else if (action.error.code !== 'not-found') {
		return opError(ctx, action.error, false);
	} else {
		const matter = findMatter(ref, snap);
		if (!matter.ok) {
			if (matter.error.code === 'ambiguous') return opError(ctx, matter.error, false);
			return opError(ctx, { code: 'not-found', value: ref, message: CLI.nothingToOpen(ref) }, false);
		}
		target = { matter: matter.value.path };
		name = matter.value.name;
	}
	const obsidianDir = ctx.io.obsidianDir === undefined ? obsidianSettingsDir(process.platform, ctx.io.env, ctx.io.home) : ctx.io.obsidianDir;
	const url = openUrl(vaultRef(ctx.vault.root, obsidianDir), target);
	try {
		await (ctx.io.opener ?? systemOpener())(url);
	} catch {
		const e: ErrorJson['error'] = { code: 'open-failed', message: CLI.openFailed(url), url };
		if (ctx.json) print(ctx.io.stdout, stringify(errorJson(e)));
		else print(ctx.io.stderr, ctx.err.r(e.message));
		return EXIT.unmatched;
	}
	if (ctx.json) print(ctx.io.stdout, stringify({ url, opened: true, ...target }));
	else print(ctx.io.stdout, [CLI.opening(name), `  ${ctx.out.d(url)}`]);
	return EXIT.done;
}
