// The command line: arguments in, an operation on a snapshot of the vault, human or JSON output, an exit code.
// Exit codes: 0 done; 1 nothing matched, several did, or the input can't be read (nothing written); 2 the vault
// isn't ready; 3 the write didn't happen (a file changed meanwhile, a path would leave the vault, a note is read-only,
// or writing failed and was put back).

import { writeFileSync } from 'node:fs';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { resolve } from 'node:path';
import type { VaultReader } from '../../src/files/index';
import { toYmd } from '../../src/model/dates';
import { addAction, addMatter, getAction, getWorkflow, listActions, listMatters, markAsDone, parseQuickAdd, reopen, today, updateAction } from '../../src/ops';
import { readiness } from '../../src/ops/fields';
import { findActionOrMatter } from '../../src/ops/findAction';
import type { ActionFields, ActionWrite, ListActionsInput, MatterSummary, OpError, OpResult, Snapshot, Warning } from '../../src/ops/types';
import type { ApplyFs } from './apply';
import { boolFlag, listFlag, parseArgs, textFlag, type Command, type FlagValue } from './args';
import type { ContentsAfter } from './filesLayer';
import { errorJson, stringify, writeJson, type ErrorJson } from './json';
import { obsidianSettingsDir, openUrl, systemOpener, vaultRef, type Opener, type OpenTarget } from './open';
import {
	colourFor,
	formatActionWrite,
	formatError,
	formatList,
	formatMatterAdded,
	formatMatters,
	formatParse,
	formatShow,
	formatToday,
	formatWorkflow,
	markup,
	shownPath,
	style,
	typeTones,
	type Style,
} from './output';
import { STRINGS } from '../../src/strings';
import { CLI, COMMAND_HELP, HELP, type WriteVerb } from './strings';
import { inVault, openVault, type Vault } from './vault';
import { planAndWrite, takeSnapshot, type WriteFlow } from './writeFlow';

export const EXIT = { done: 0, unmatched: 1, notReady: 2, changed: 3 } as const;

interface Stream {
	write(text: string): unknown;
	isTTY?: boolean;
	/** The terminal's width, when it is one. */
	columns?: number;
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
	/** Where `matters-that-matter mcp` serves; standard input and output when absent. */
	mcpTransport?: Transport;
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
	// `help` and `help <command>` are `--help`.
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
	let fixedNow: Date | null = null;
	const nowFlag = textFlag(flags, 'now');
	if (nowFlag) {
		fixedNow = parseNow(nowFlag);
		if (!fixedNow) return usage(CLI.badNow(nowFlag));
	}
	const now = fixedNow ?? io.clock?.() ?? new Date();

	const vaultGiven = textFlag(flags, 'vault') ?? io.env.MTM_VAULT;
	const configDir = textFlag(flags, 'config-dir') ?? undefined;
	const opened = openVault(vaultGiven, configDir, io.cwd, io.home);
	if (!opened.ok) {
		if (json && command !== 'mcp') print(io.stdout, stringify(errorJson({ code: 'not-ready', message: opened.message })));
		else print(io.stderr, err.r(opened.message));
		return EXIT.notReady;
	}

	if (command === 'mcp') {
		// Loaded only here, so other commands never load the MCP library. Standard output is the protocol's: anything
		// to say before serving goes to standard error.
		const { chooseTools, serveMcp } = await import('./mcp');
		const chosen = chooseTools(boolFlag(flags, 'read-only'), textFlag(flags, 'tools'));
		if (!chosen.ok) {
			print(io.stderr, err.r(chosen.message));
			return EXIT.notReady;
		}
		if (words.length) {
			print(io.stderr, err.r(CLI.noWords(command, words.join(' '))));
			return EXIT.unmatched;
		}
		if (!opened.vault.settings.setupDone) print(io.stderr, err.y(STRINGS.ops.notSetUp));
		return serveMcp(
			{
				vault: vaultGiven ?? '',
				configDir,
				cwd: io.cwd,
				home: io.home,
				tools: chosen.tools,
				dryRun: boolFlag(flags, 'dry-run'),
				now: fixedNow,
				clock: io.clock,
				reader: io.reader,
				contentsAfter: io.contentsAfter,
				fs: io.fs,
			},
			io.mcpTransport,
		);
	}

	const ctx: Context = { io, vault: opened.vault, flags, words, json, dryRun: boolFlag(flags, 'dry-run'), now, out, err };
	return dispatch(command, ctx);
}

// ——— Commands ———

/** Commands that take no words: words given are a mistake (`list Kitchen` for `list --matter Kitchen`), never ignored. */
const NO_WORDS: readonly Command[] = ['today', 'workflow', 'matters', 'list'];

async function dispatch(command: Exclude<Command, 'mcp'>, ctx: Context): Promise<number> {
	const words = ctx.words.join(' ').trim();
	// A note named by its full path is named by its path in the vault.
	const ref = inVault(words, ctx.vault.root);
	if (NO_WORDS.includes(command) && words) return usageError(ctx, command === 'list' ? CLI.noWordsList(words) : CLI.noWords(command, words));
	// The terminal's width, so long titles don't wrap tables; none when the output goes to a file or another program.
	const width = ctx.io.stdout.isTTY ? ctx.io.stdout.columns : undefined;
	switch (command) {
		case 'today':
			return read(ctx, today, (v, s) => formatToday(v, shownPath(ctx.vault.root, ctx.io.home), typeTones(s), ctx.out, width));
		case 'workflow':
			return read(ctx, getWorkflow, (v) => formatWorkflow(v, ctx.out));
		case 'matters':
			return read(ctx, listMatters, (v) => formatMatters(v, ctx.out));
		case 'list':
			return read(ctx, (s) => listActions(listInput(ctx.flags, ctx.vault.root), s), (v, s) => formatList(v, toYmd(s.now), typeTones(s), ctx.out, width));
		case 'show':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return read(ctx, (s) => getAction(ref, s), (v, s) => formatShow(v, toYmd(s.now), ctx.out));
		case 'parse':
			if (!words) return usageError(ctx, CLI.noParseText);
			return read(ctx, (s) => parseQuickAdd(words, s), (v, s, w) => formatParse(v, w, toYmd(s.now), ctx.out), true);
		case 'add':
			return writeAction(ctx, (s) => addAction({ ...(words ? { text: words } : {}), ...fieldInput(ctx.flags, ctx.vault.root) }, s), null);
		case 'update': {
			if (!ref) return usageError(ctx, CLI.nameAction);
			// An empty value never removes one (an unset variable in a script would): --no-<field> does.
			const blank = BLANK_REFUSED.find((flag) => {
				const v = ctx.flags[flag];
				return typeof v === 'string' && !v.trim();
			});
			if (blank) return usageError(ctx, CLI.emptyFlag(blank));
			return writeAction(ctx, (s) => updateAction({ action: ref, ...fieldInput(ctx.flags, ctx.vault.root) }, s), CLI.changed);
		}
		case 'done':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return writeAction(ctx, (s) => markAsDone(ref, s), CLI.markedDone);
		case 'reopen':
			if (!ref) return usageError(ctx, CLI.nameAction);
			return writeAction(ctx, (s) => reopen(ref, s), CLI.reopened);
		case 'add-matter':
			if (!words) return usageError(ctx, CLI.nameNew);
			return writeMatter(ctx, words);
		case 'open':
			if (!ref) return usageError(ctx, CLI.nameTarget);
			return open(ctx, ref);
	}
}

/** Flags whose empty value, on update, is refused rather than read as removing the value. */
const BLANK_REFUSED = ['priority', 'start', 'due', 'waiting-on', 'details'] as const;

/** The fields an Action command was given, by their public names; a Matter given by its full path, by its path in the vault. */
function fieldInput(flags: Record<string, FlagValue>, root: string): ActionFields {
	const input: ActionFields = {};
	for (const name of ['title', 'matter', 'status', 'type', 'details', 'link'] as const) {
		const v = textFlag(flags, name);
		if (typeof v === 'string') input[name] = name === 'matter' ? inVault(v, root) : v;
	}
	// --no-details removes them.
	if (flags.details === null) input.details = null;
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

function listInput(flags: Record<string, FlagValue>, root: string): ListActionsInput {
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
		if (typeof v === 'string') input[key] = key === 'matter' ? inVault(v, root) : v;
	}
	if (boolFlag(flags, 'waiting')) input.waiting = true;
	if (boolFlag(flags, 'done')) input.done = true;
	return input;
}

// ——— Reading ———

function snapshot(ctx: Context): { snap: Snapshot; reader: VaultReader } {
	return takeSnapshot(ctx.vault, ctx.now, ctx.io.reader);
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

/** Reads work before setup, but say so: what they show may not be what the plugin will show. */
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

type Written<T> = Extract<WriteFlow<T>, { ok: true }>;

/** Plans and writes all or nothing (see `planAndWrite`); a failure is printed and gives its exit code. */
function write<T>(ctx: Context, op: (s: Snapshot) => OpResult<T>): Written<T> | number {
	const planOut = textFlag(ctx.flags, 'plan-out');
	const w = planAndWrite(
		{
			vault: ctx.vault,
			now: ctx.now,
			dryRun: ctx.dryRun,
			reader: ctx.io.reader,
			contentsAfter: ctx.io.contentsAfter,
			fs: ctx.io.fs,
			onPlan: planOut
				? (plan) => {
						try {
							writeFileSync(resolve(ctx.io.cwd, planOut), `${stringify(plan)}\n`, 'utf8');
							return null;
						} catch {
							return { code: 'usage', message: CLI.planOutFailed(planOut) };
						}
					}
				: undefined,
		},
		op,
	);
	if (w.ok) return w;
	if (w.kind === 'op') return opError(ctx, w.error, true);
	if (ctx.json) print(ctx.io.stdout, stringify(errorJson(w.error)));
	else print(ctx.io.stderr, ctx.err.r(w.error.message));
	return w.changed ? EXIT.changed : EXIT.unmatched;
}

/** Add, update, done, reopen: `verb` is null for add. */
function writeAction(ctx: Context, op: (s: Snapshot) => OpResult<ActionWrite>, verb: WriteVerb | null): number {
	const w = write(ctx, op);
	if (typeof w === 'number') return w;
	const { r, snap, outcome, written } = w;
	vaultWarnings(ctx, r.warnings);
	if (ctx.json) {
		print(ctx.io.stdout, stringify(writeJson({ action: r.value.action }, r, outcome, ctx.dryRun, written)));
		return EXIT.done;
	}
	print(ctx.io.stdout, formatActionWrite(verb, r, outcome, toYmd(snap.now), ctx.dryRun, ctx.out));
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
	const ready = readiness(snap, false);
	if (ready.error) return opError(ctx, ready.error, false);
	setupHint(ctx);
	// An Action or a Matter named exactly wins over a loose match of either.
	const found = findActionOrMatter(ref, snap);
	if (!found.ok) {
		if (found.error.code === 'ambiguous') return opError(ctx, found.error, false);
		return opError(ctx, { code: 'not-found', value: ref, message: CLI.nothingToOpen(ref) }, false);
	}
	const t = found.value;
	const target: OpenTarget = t.kind === 'action' ? { file: t.action.note.path } : { matter: t.matter.path };
	const name = t.kind === 'action' ? t.action.note.basename : t.matter.name;
	const obsidianDir = ctx.io.obsidianDir === undefined ? obsidianSettingsDir(process.platform, ctx.io.env, ctx.io.home) : ctx.io.obsidianDir;
	const url = openUrl(vaultRef(ctx.vault.root, obsidianDir), target);
	// A dry run only says which link it would open.
	if (ctx.dryRun) {
		if (ctx.json) print(ctx.io.stdout, stringify({ url, opened: false, ...target }));
		else print(ctx.io.stdout, [CLI.wouldOpen(name), `  ${ctx.out.d(url)}`]);
		return EXIT.done;
	}
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
