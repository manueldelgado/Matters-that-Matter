// Writing a plan's files safely, all or nothing:
//
// 1. Check: every path stays inside the vault, every file is still what the plan saw (a hash of its content), every
//    new path is still free, and no note to be changed or renamed is read-only (its owner can't write it, or the
//    system refuses writing it, as for a note locked in the Finder).
// 2. Stage: each file's new content goes to a temporary file in the same folder (with the old file's mode). Its name
//    is short and doesn't repeat the note's (`.mtm-<process>-<n>-<random>.tmp`), so a note whose name is near the
//    file system's limit can still be written; it starts with a dot, so Obsidian and the vault's reader skip it.
// 3. Check again, then commit with renames only: an edited file's new content is renamed over it; a new file is
//    renamed into place; a renamed note is moved to its new name, then its new content renamed over it. Obsidian's
//    file watcher sees each of these as the move or change it is.
//
//    A rename replaces whatever is at its target, so before a new file or a renamed note takes a path, the path is
//    checked again: free, or (a case-only rename) the same file. Between that check and the rename there is a short
//    window in which another program could create a file there and lose it; it is accepted, as no portable "rename
//    unless it exists" exists, and linking instead (which refuses to replace) leaves Obsidian believing the old name
//    is still there. Other runs of this command line can't: once staged, and before anything is committed, each holds
//    every new name with a hidden lock file next to it (locks.ts), so two that planned the same new name never both
//    take it, and a name another run holds stops the write before anything changes.
// 4. If anything fails while committing, what was committed is put back, in reverse order, from the content the plan
//    saw.
//
// The bytes written are exactly what the files layer computed (line endings and all). A rename gives the note a new
// file: on macOS its creation date (which Obsidian shows as the note's created time) is set back to the old one.
// Extended attributes (Finder tags) and hard links aren't kept.

import { createHash, randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { foldName, parentOf } from '../../src/files/paths';
import type { FileWrite as LayerWrite } from './filesLayer';
import { releaseLock, takeLock, type Lock } from './locks';

/** What the writer needs of each file the files layer computed. */
export type FileWrite = Pick<LayerWrite, 'path' | 'from' | 'before' | 'after'>;

export type ApplyResult =
	| { ok: true; written: string[] }
	/**
	 * A file changed after the plan was made, or (`appeared`) a path the plan creates was taken meanwhile. Nothing
	 * was written.
	 */
	| { ok: false; reason: 'changed'; path: string; appeared?: boolean; held?: boolean }
	/** A path would leave the vault. Nothing was written. */
	| { ok: false; reason: 'unsafe'; path: string }
	/** A note to be changed or renamed is read-only. Nothing was written. */
	| { ok: false; reason: 'read-only'; path: string }
	/** Writing failed; everything committed was put back except the files in `left`. */
	| { ok: false; reason: 'failed'; path: string; error: string; left: string[] };

/** The file operations the writer uses (synchronous), so tests can make one fail. */
export interface ApplyFs {
	readFile(path: string): string | null;
	writeFile(path: string, text: string): void;
	rename(from: string, to: string): void;
	unlink(path: string): void;
	stat(path: string): { dev: bigint; ino: bigint; mode: number; mtimeMs?: number } | null;
	realpath(path: string): string;
	mkdir(path: string): void;
	rmdir(path: string): void;
	chmod(path: string, mode: number): void;
	/** Whether the system lets this process write the file (false for a locked note); writable when absent. */
	canWrite?(path: string): boolean;
	/** The file's creation time and last access, in milliseconds, where the system keeps a creation time. */
	times?(path: string): { birth: number; access: number; modified: number } | null;
	/** Sets a file's access and modification times (milliseconds). */
	setTimes?(path: string, access: number, modified: number): void;
	/** A second name for a file, refusing one that is there (for locks; see locks.ts). */
	link?(from: string, to: string): void;
}

/** A system error's code (EPERM, EACCES…), or undefined. */
const errorCode = (e: unknown): unknown => (typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined);

export const nodeFs: ApplyFs = {
	readFile: (p) => {
		try {
			return readFileSync(p, 'utf8');
		} catch {
			return null;
		}
	},
	writeFile: (p, text) => writeFileSync(p, text, { encoding: 'utf8', flag: 'wx' }),
	rename: (a, b) => renameSync(a, b),
	unlink: (p) => rmSync(p),
	stat: (p) => {
		try {
			const s = statSync(p, { bigint: true });
			return { dev: s.dev, ino: s.ino, mode: Number(s.mode & 0o7777n), mtimeMs: Number(s.mtimeMs) };
		} catch {
			return null;
		}
	},
	realpath: (p) => realpathSync(p),
	mkdir: (p) => mkdirSync(p),
	rmdir: (p) => rmdirSync(p),
	chmod: (p, mode) => chmodSync(p, mode),
	link: (a, b) => linkSync(a, b),
	canWrite: (p) => {
		try {
			accessSync(p, constants.W_OK);
			return true;
		} catch (e) {
			// Only a refusal counts; a file that is gone is for the other checks.
			const code = errorCode(e);
			return code !== 'EPERM' && code !== 'EACCES' && code !== 'EROFS';
		}
	},
	// Only macOS keeps a creation time that setting an earlier modification time moves back (see `keepCreated`).
	...(process.platform === 'darwin'
		? {
				times: (p: string) => {
					try {
						const s = statSync(p);
						return { birth: s.birthtimeMs, access: s.atimeMs, modified: s.mtimeMs };
					} catch {
						return null;
					}
				},
				setTimes: (p: string, access: number, modified: number) => utimesSync(p, access / 1000, modified / 1000),
			}
		: {}),
};

export const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A vault path the writer accepts: relative, `/`-separated, without `.`, `..` or empty parts. */
export function isVaultPath(path: string): boolean {
	if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false;
	return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** A name as macOS and Windows compare them: case and Unicode form ignored. */
const fold = foldName;

const caseOnly = (file: FileWrite) => file.from !== null && file.from !== file.path && fold(file.from) === fold(file.path);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let counter = 0;
/** A temporary file in the target's folder; the random part keeps it clear of one a crashed run left behind. */
const tempName = (target: string) => join(dirname(target), `.mtm-${process.pid}-${(counter++).toString(36)}-${randomBytes(3).toString('hex')}.tmp`);

/** Whether the file's owner may write it (a note made read-only, say with `chmod 444`, may not). */
const writable = (mode: number) => (mode & 0o200) !== 0;

/** A system refusal to write a file (a locked note, missing permissions). */
const isRefusal = (e: unknown) => {
	const code = errorCode(e);
	return code === 'EPERM' || code === 'EACCES';
};

/**
 * Gives a rewritten note its old creation time back. On macOS, setting a modification time earlier than the creation
 * time moves the creation time back to it; the modification time is then set to what it was. Never fails a write.
 */
function keepCreated(fs: ApplyFs, path: string, birth: number | null): void {
	if (birth === null || !fs.times || !fs.setTimes) return;
	try {
		const now = fs.times(path);
		if (!now || now.birth <= birth) return;
		fs.setTimes(path, now.access, birth);
		fs.setTimes(path, now.access, now.modified);
	} catch {
		// The note is written; only its creation date is new.
	}
}

interface Staged {
	file: FileWrite;
	target: string;
	from: string | null;
	temp: string;
	mode: number | null;
	/** The note's creation time before the write, where the system keeps one. */
	birth: number | null;
}

/** The first note to be changed or renamed that is read-only, or null. A dry run asks too, so it says what a write would. */
export function readOnlyNote(root: string, outcome: { files: readonly FileWrite[] }, fs: ApplyFs = nodeFs): string | null {
	for (const file of outcome.files) {
		if (file.from === null) continue;
		const full = join(root, ...file.from.split('/'));
		const mode = fs.stat(full)?.mode;
		if (mode === undefined) continue;
		if (!writable(mode) || fs.canWrite?.(full) === false) return file.from;
	}
	return null;
}

type Refusal = Extract<ApplyResult, { reason: 'unsafe' | 'read-only' | 'failed' }>;

/** Whether a folder (or the nearest one of its parents that exists) really is inside the vault; a refusal when the vault can't be found. */
function insideVault(root: string, fs: ApplyFs): ((dir: string) => boolean) | Refusal {
	let realRoot: string;
	try {
		realRoot = fs.realpath(root);
	} catch (e) {
		return { ok: false, reason: 'failed', path: '', error: message(e), left: [] };
	}
	return (dir: string): boolean => {
		let d = dir;
		while (!fs.stat(d)) {
			const up = dirname(d);
			if (up === d) return false;
			d = up;
		}
		try {
			const real = fs.realpath(d);
			return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
		} catch {
			return false;
		}
	};
}

/**
 * What the writer would refuse before writing anything: a path outside the vault (also through a folder linked to
 * somewhere else), or a read-only note. A dry run asks too, so it says what a write would.
 */
export function refusal(root: string, outcome: { files: readonly FileWrite[] }, fs: ApplyFs = nodeFs): Refusal | null {
	const inside = insideVault(root, fs);
	if (typeof inside !== 'function') return inside;
	const full = (path: string) => join(root, ...path.split('/'));
	for (const file of outcome.files) {
		const paths = file.from === null ? [file.path] : [file.path, file.from];
		const bad = paths.find((p) => !isVaultPath(p) || !inside(dirname(full(p))));
		if (bad !== undefined) return { ok: false, reason: 'unsafe', path: bad };
	}
	// A read-only note is left alone: a rename would replace it all the same, so nothing is written.
	const readOnly = readOnlyNote(root, outcome, fs);
	if (readOnly !== null) return { ok: false, reason: 'read-only', path: readOnly };
	// Every write puts a file in a folder (and a rename takes one out of another): those must be writable. A folder
	// still to be made goes in the nearest one there is.
	for (const file of outcome.files) {
		for (const path of file.from === null || file.from === file.path ? [file.path] : [file.path, file.from]) {
			let folder = parentOf(path);
			while (folder !== '' && !fs.stat(full(folder))) folder = parentOf(folder);
			if (fs.canWrite?.(folder === '' ? root : full(folder)) === false) return { ok: false, reason: 'read-only', path: folder === '' ? '/' : folder };
		}
	}
	return null;
}

/**
 * Writes an outcome all or nothing. `basis` lists files the plan was computed from beyond those it writes (by their
 * SHA-256, or null for a path that must not exist): any that changed stops the write as a file written would.
 */
export function applyOutcome(root: string, outcome: { files: readonly FileWrite[]; basis?: readonly { path: string; version: string | null }[] }, fs: ApplyFs = nodeFs): ApplyResult {
	const full = (path: string) => join(root, ...path.split('/'));
	const inside = insideVault(root, fs);
	if (typeof inside !== 'function') return inside;
	const refused = refusal(root, outcome, fs);
	if (refused?.reason === 'unsafe' || refused?.reason === 'failed') return refused;

	/** The first file that isn't as the plan saw it, or whose new path was taken (`appeared`, for a new note). */
	const stale = (): { path: string; appeared: boolean } | null => {
		for (const file of outcome.files) {
			const target = full(file.path);
			if (file.from === null) {
				if (fs.stat(target)) return { path: file.path, appeared: true };
				continue;
			}
			const now = fs.readFile(full(file.from));
			if (now === null || file.before === null || hash(now) !== hash(file.before)) return { path: file.from, appeared: false };
			if (file.from === file.path) continue;
			const there = fs.stat(target);
			if (!there) continue;
			// Only the same file under another case or Unicode form may be there (a case-insensitive file system).
			const self = fs.stat(full(file.from));
			if (!caseOnly(file) || !self || self.ino !== there.ino || self.dev !== there.dev) return { path: file.path, appeared: false };
		}
		for (const entry of outcome.basis ?? []) {
			const now = fs.readFile(full(entry.path));
			if (entry.version === null ? now !== null : now === null || hash(now) !== entry.version) return { path: entry.path, appeared: entry.version === null };
		}
		return null;
	};
	const changedResult = (c: { path: string; appeared: boolean }): ApplyResult => ({ ok: false, reason: 'changed', path: c.path, ...(c.appeared ? { appeared: true } : {}) });

	const changed = stale();
	if (changed !== null) return changedResult(changed);
	if (refused) return refused;

	// Stage.
	const staged: Staged[] = [];
	const madeDirs: string[] = [];
	const locks: Lock[] = [];
	const cleanUp = () => {
		for (const lock of locks) releaseLock(fs, lock);
		for (const s of staged) {
			try {
				if (fs.stat(s.temp)) fs.unlink(s.temp);
			} catch {
				// A temporary file left behind (`.mtm-….tmp`) is hidden from Obsidian: its name starts with a dot.
			}
		}
		for (const d of [...madeDirs].reverse()) {
			try {
				fs.rmdir(d);
			} catch {
				// Not empty: something else uses it now.
			}
		}
	};
	const mkdirs = (dir: string) => {
		const missing: string[] = [];
		for (let d = dir; !fs.stat(d); d = dirname(d)) missing.unshift(d);
		for (const d of missing) {
			fs.mkdir(d);
			madeDirs.push(d);
		}
	};
	let current = '';
	try {
		for (const file of outcome.files) {
			current = file.path;
			const target = full(file.path);
			mkdirs(dirname(target));
			if (!inside(dirname(target))) {
				cleanUp();
				return { ok: false, reason: 'unsafe', path: file.path };
			}
			const from = file.from === null ? null : full(file.from);
			const s: Staged = { file, target, from, temp: tempName(target), mode: from ? (fs.stat(from)?.mode ?? null) : null, birth: from ? (fs.times?.(from)?.birth ?? null) : null };
			staged.push(s);
			fs.writeFile(s.temp, file.after);
			if (s.mode !== null) fs.chmod(s.temp, s.mode);
		}
	} catch (e) {
		cleanUp();
		return { ok: false, reason: 'failed', path: current, error: message(e), left: [] };
	}

	// Hold every new name before anything is committed: a name another run is taking stops the write here.
	try {
		for (const s of staged) {
			if (s.from === s.target) continue;
			const lock = takeLock(fs, s.target);
			if (!lock) {
				cleanUp();
				return { ok: false, reason: 'changed', path: s.file.path, held: true };
			}
			locks.push(lock);
		}
	} catch (e) {
		cleanUp();
		return { ok: false, reason: 'failed', path: current, error: message(e), left: [] };
	}

	const again = stale();
	if (again !== null) {
		cleanUp();
		return changedResult(again);
	}

	// Commit; every step that changes the vault leaves a way back.
	const undo: { path: string; run: () => void }[] = [];
	/** Throws unless `target` is free, or is `from` itself under another case (a case-insensitive file system). */
	const claim = (target: string, from: string | null, path: string) => {
		const there = fs.stat(target);
		if (!there) return;
		const self = from === null ? null : fs.stat(from);
		if (!self || self.ino !== there.ino || self.dev !== there.dev) throw new Taken(path);
	};
	/** Puts content back over a path. */
	const restore = (target: string, content: string, mode: number | null, birth: number | null) => {
		const temp = tempName(target);
		try {
			fs.writeFile(temp, content);
			if (mode !== null) fs.chmod(temp, mode);
			fs.rename(temp, target);
		} catch (e) {
			if (fs.stat(temp)) fs.unlink(temp);
			throw e;
		}
		keepCreated(fs, target, birth);
	};
	const written: string[] = [];
	try {
		for (const s of staged) {
			current = s.file.path;
			const before = s.file.before ?? '';
			if (s.from === null) {
				claim(s.target, null, s.file.path);
				fs.rename(s.temp, s.target);
				undo.push({ path: s.file.path, run: () => fs.unlink(s.target) });
			} else {
				if (s.from !== s.target) {
					const from = s.from;
					claim(s.target, from, s.file.path);
					fs.rename(from, s.target);
					undo.push({ path: s.file.from ?? s.file.path, run: () => fs.rename(s.target, from) });
				}
				fs.rename(s.temp, s.target);
				keepCreated(fs, s.target, s.birth);
				undo.push({ path: s.file.path, run: () => restore(s.target, before, s.mode, s.birth) });
			}
			written.push(s.file.path);
		}
	} catch (e) {
		const left: string[] = [];
		for (const step of [...undo].reverse()) {
			try {
				step.run();
			} catch {
				if (!left.includes(step.path)) left.push(step.path);
			}
		}
		cleanUp();
		if (!left.length) {
			// Put back as it was: a new path taken meanwhile is a change like any other, and a note the system refuses
			// to replace is read-only.
			if (e instanceof Taken) return changedResult({ path: e.path, appeared: true });
			const step = staged.find((x) => x.file.path === current);
			if (isRefusal(e) && step?.file.from) return { ok: false, reason: 'read-only', path: step.file.from };
		}
		return { ok: false, reason: 'failed', path: current, error: message(e), left };
	}
	cleanUp();
	return { ok: true, written };
}

/** A path a new note or a renamed one was to take, taken by another file meanwhile. */
class Taken extends Error {
	constructor(readonly path: string) {
		super(`${path} appeared meanwhile`);
	}
}
