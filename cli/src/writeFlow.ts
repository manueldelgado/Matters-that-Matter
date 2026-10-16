// Reading a vault and writing an operation's plan, shared by the command line and the MCP server: a fresh snapshot for
// every read and every attempt at a write, and writes all or nothing through the safe writer (apply.ts).

import type { VaultReader } from '../../src/files/index';
import type { OpError, OpResult, Plan, Snapshot, Warning } from '../../src/ops/types';
import { applyOutcome, refusal, type ApplyFs, type ApplyResult } from './apply';
import { contentsAfter as defaultContentsAfter, snapshotOf, WriteError, type ContentsAfter, type FileOutcome } from './filesLayer';
import { cachingReader, fsVaultReader } from './fsVault';
import type { ErrorJson } from './json';
import { CLI, dryRunWording } from './strings';
import type { Vault } from './vault';

export type ReaderFactory = (root: string, configDir: string) => VaultReader;

/** The vault as the operations see it now, and the reader that saw it. */
export function takeSnapshot(vault: Vault, now: Date, readerFactory: ReaderFactory = fsVaultReader): { snap: Snapshot; reader: VaultReader } {
	// One read per file per attempt, so a plan's `before` is exactly what the snapshot saw.
	const reader = cachingReader(readerFactory(vault.root, vault.configDir));
	return { snap: snapshotOf(reader, vault.configDir, vault.settings, now), reader };
}

export interface WriteSource {
	vault: Vault;
	now: Date;
	dryRun: boolean;
	reader?: ReaderFactory;
	/** The plan applier; the files layer's when absent. */
	contentsAfter?: ContentsAfter;
	/** The file operations writes use; Node's when absent. */
	fs?: ApplyFs;
	/** Sees each plan before it is applied; returning a failure stops the write. */
	onPlan?: (plan: Plan) => ErrorJson['error'] | null;
}

export type WriteFlow<T> =
	| { ok: true; r: Extract<OpResult<T>, { ok: true }>; snap: Snapshot; outcome: FileOutcome | null; written: boolean }
	/** The operation refused: nothing was planned. */
	| { ok: false; kind: 'op'; error: OpError }
	/**
	 * The plan couldn't be applied, or the write failed: `changed` when the vault changed meanwhile, a write failed or
	 * was refused (outside the vault, a read-only note).
	 */
	| { ok: false; kind: 'write'; error: ErrorJson['error']; changed: boolean };

/**
 * Warnings as the command line and the MCP server report them: each said once (the same unknown person given as
 * waiting on and among the people warns once, the first kept), and in a dry run, worded as what would happen.
 */
export function reportedWarnings(warnings: readonly Warning[], dryRun: boolean): Warning[] {
	const seen = new Set<string>();
	const out: Warning[] = [];
	for (const w of warnings) {
		const key = `${w.code}\u0000${w.value ?? ''}\u0000${w.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(dryRun ? { ...w, message: dryRunWording(w.message) } : w);
	}
	return out;
}

export const planIsEmpty = (p: Plan) => !p.creates.length && !p.edits.length && !p.bodies.length && !p.renames.length;

/**
 * How many times a write is planned in all when the vault changes meanwhile: more for new notes only, which each time
 * take a name still free (several programs adding notes of the same name at once each get one).
 */
const ATTEMPTS = { change: 2, createOnly: 8 };

/** A short random pause before planning new notes again, so writers that collided don't collide again in step. */
function pause(): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 + Math.floor(Math.random() * 25));
}

/**
 * Plans on a fresh snapshot, then writes all or nothing. A file that changed after it was read stops the write
 * before anything is written; the whole write is planned again (once, or a few times when it only creates notes),
 * and a change on the last attempt is a failure. A write that fails is put back.
 */
export function planAndWrite<T>(src: WriteSource, op: (s: Snapshot) => OpResult<T>): WriteFlow<T> {
	const writer = src.contentsAfter ?? defaultContentsAfter;
	/** A new note's path found taken by the last attempt, though the snapshot saw it free. */
	let appeared: string | null = null;
	for (let attempt = 1; ; attempt++) {
		const { snap, reader } = takeSnapshot(src.vault, src.now, src.reader);
		const result = op(snap);
		if (!result.ok) return { ok: false, kind: 'op', error: result.error };
		const r = { ...result, warnings: reportedWarnings(result.warnings, src.dryRun) };
		const stop = src.onPlan?.(r.plan);
		if (stop) return { ok: false, kind: 'write', error: stop, changed: false };
		if (planIsEmpty(r.plan)) return { ok: true, r, snap, outcome: null, written: false };
		const p = r.plan;
		const again = attempt < (p.edits.length || p.bodies.length || p.renames.length ? ATTEMPTS.change : ATTEMPTS.createOnly);
		let outcome: FileOutcome;
		try {
			outcome = writer(r.plan, reader, { configDir: src.vault.configDir });
		} catch (e) {
			if (!(e instanceof WriteError)) throw e;
			// A file the snapshot saw is gone, or one it didn't see is there: the vault changed; plan again.
			if (again && (e.code === 'exists' || e.code === 'missing')) {
				if (e.code === 'exists') pause();
				continue;
			}
			return { ok: false, kind: 'write', ...planFailure(e, p) };
		}
		if (src.dryRun) {
			// What the writer would refuse, a dry run says too.
			const refused = refusal(src.vault.root, outcome, src.fs);
			if (refused !== null) return { ok: false, kind: 'write', error: writeFailure(refused), changed: true };
			return { ok: true, r, snap, outcome, written: false };
		}
		const applied = applyOutcome(src.vault.root, outcome, src.fs);
		if (applied.ok) return { ok: true, r, snap, outcome, written: true };
		if (applied.reason === 'changed' && applied.appeared) {
			// Taken twice running though the vault, read afresh, has it free: the file system counts a file there as
			// the same name, and trying again can't help.
			if (applied.path === appeared) return { ok: false, kind: 'write', error: { code: 'exists', message: CLI.sameName(applied.path), path: applied.path }, changed: true };
			appeared = applied.path;
		}
		if (again && applied.reason === 'changed') {
			if (applied.appeared || applied.held) pause();
			continue;
		}
		return { ok: false, kind: 'write', error: writeFailure(applied), changed: true };
	}
}

/**
 * A plan the files layer can't apply; nothing is written. The vault changed, or a path would leave the vault (exit
 * code 3, as the writer's own refusals), or a note's properties can't be edited (exit code 1).
 */
function planFailure(e: WriteError, plan: Plan): { error: ErrorJson['error']; changed: boolean } {
	switch (e.code) {
		case 'exists':
			// A new note's name taken meanwhile, or a rename's.
			return { error: { code: e.code, message: (plan.creates.some((c) => c.path === e.path) ? CLI.appeared : CLI.exists)(e.path), path: e.path }, changed: true };
		case 'missing':
			return { error: { code: e.code, message: CLI.missing(e.path), path: e.path }, changed: true };
		case 'bad-path':
			return { error: { code: 'unsafe', message: CLI.outsideVault(e.path), path: e.path }, changed: true };
		case 'invalid-properties':
			return { error: { code: e.code, message: (e.reason === 'unsafe' ? CLI.unsafeProperties : CLI.unreadableProperties)(e.path), path: e.path }, changed: false };
		case 'not-mtm':
			return { error: { code: e.code, message: CLI.notMtm(e.path), path: e.path }, changed: false };
	}
}

/** Why a write stopped, and whether anything was left changed. */
function writeFailure(failed: Exclude<ApplyResult, { ok: true }>): ErrorJson['error'] {
	let message: string;
	let left: string[] = [];
	if (failed.reason === 'changed') message = failed.held ? CLI.held(failed.path) : failed.appeared ? CLI.appeared(failed.path) : CLI.changedMeanwhile(failed.path);
	else if (failed.reason === 'unsafe') message = CLI.outsideVault(failed.path);
	else if (failed.reason === 'read-only') message = CLI.readOnly(failed.path);
	else {
		left = failed.left;
		message = left.length ? CLI.writeFailedLeft(failed.path, failed.error, left) : CLI.writeFailed(failed.path, failed.error);
	}
	return { code: failed.reason, message, path: failed.path, left };
}
