// Reading a vault and writing an operation's plan, shared by the command line and the MCP server: a fresh snapshot for
// every read and every attempt at a write, and writes all or nothing through the safe writer (apply.ts).

import type { VaultReader } from '../../src/files/index';
import type { OpError, OpResult, Plan, Snapshot } from '../../src/ops/types';
import { applyOutcome, type ApplyFs, type ApplyResult } from './apply';
import { contentsAfter as defaultContentsAfter, snapshotOf, WriteError, type ContentsAfter, type FileOutcome } from './filesLayer';
import { cachingReader, fsVaultReader } from './fsVault';
import type { ErrorJson } from './json';
import { CLI } from './strings';
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
	/** The plan couldn't be applied, or the write failed: `changed` when the vault changed meanwhile or a write failed. */
	| { ok: false; kind: 'write'; error: ErrorJson['error']; changed: boolean };

export const planIsEmpty = (p: Plan) => !p.creates.length && !p.edits.length && !p.bodies.length && !p.renames.length;

/**
 * Plans on a fresh snapshot, then writes all or nothing. A file that changed after it was read stops the write
 * before anything is written; the whole write is planned again once, and a second change is a failure. A write that
 * fails is put back.
 */
export function planAndWrite<T>(src: WriteSource, op: (s: Snapshot) => OpResult<T>): WriteFlow<T> {
	const writer = src.contentsAfter ?? defaultContentsAfter;
	for (let attempt = 1; ; attempt++) {
		const { snap, reader } = takeSnapshot(src.vault, src.now, src.reader);
		const r = op(snap);
		if (!r.ok) return { ok: false, kind: 'op', error: r.error };
		const stop = src.onPlan?.(r.plan);
		if (stop) return { ok: false, kind: 'write', error: stop, changed: false };
		if (planIsEmpty(r.plan)) return { ok: true, r, snap, outcome: null, written: false };
		let outcome: FileOutcome;
		try {
			outcome = writer(r.plan, reader, { configDir: src.vault.configDir });
		} catch (e) {
			if (!(e instanceof WriteError)) throw e;
			// A file the snapshot saw is gone, or one it didn't see is there: the vault changed; plan again once.
			if (attempt === 1 && (e.code === 'exists' || e.code === 'missing')) continue;
			return { ok: false, kind: 'write', ...planFailure(e) };
		}
		if (src.dryRun) return { ok: true, r, snap, outcome, written: false };
		const applied = applyOutcome(src.vault.root, outcome, src.fs);
		if (applied.ok) return { ok: true, r, snap, outcome, written: true };
		if (attempt === 1 && applied.reason === 'changed') continue;
		return { ok: false, kind: 'write', error: writeFailure(applied), changed: true };
	}
}

/** A plan the files layer can't apply; nothing is written. The vault changed, or a note's properties can't be edited. */
function planFailure(e: WriteError): { error: ErrorJson['error']; changed: boolean } {
	const changed = e.code === 'exists' || e.code === 'missing';
	const message = e.code === 'exists' ? CLI.exists(e.path) : e.code === 'missing' ? CLI.missing(e.path) : e.code === 'invalid-properties' ? CLI.unreadableProperties(e.path) : CLI.notMtm(e.path);
	return { error: { code: e.code, message, path: e.path }, changed };
}

/** Why a write stopped, and whether anything was left changed. */
function writeFailure(failed: Exclude<ApplyResult, { ok: true }>): ErrorJson['error'] {
	let message: string;
	let left: string[] = [];
	if (failed.reason === 'changed') message = CLI.changedMeanwhile(failed.path);
	else if (failed.reason === 'unsafe') message = CLI.outsideVault(failed.path);
	else {
		left = failed.left;
		message = left.length ? CLI.writeFailedLeft(failed.path, failed.error, left) : CLI.writeFailed(failed.path, failed.error);
	}
	return { code: failed.reason, message, path: failed.path, left };
}
