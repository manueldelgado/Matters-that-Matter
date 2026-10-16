// Holding a new name while a write takes it, so two runs of the command line (or two MCP servers) that planned the
// same new name never both take it: a rename into place replaces whatever is there, so the check that a name is free
// and the rename can't be one step. Each new name gets a hidden lock file next to it (`.mtm-<hash>.lock`), made only
// if it isn't there, holding a token that says whose it is. A lock older than any write was left by a run that
// stopped: it is taken over by moving it aside under a name of its own (only one run can move it), then made again.

import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { foldName } from '../../src/files/paths';

/** How old a lock is, by its modification time, when the run that made it must have stopped (a write takes milliseconds). */
export const STALE_LOCK = 10_000;

/** What locks need of the file system: `writeFile` must refuse a file that is there (O_EXCL). */
export interface LockFs {
	readFile(path: string): string | null;
	writeFile(path: string, text: string): void;
	rename(from: string, to: string): void;
	unlink(path: string): void;
	stat(path: string): { dev: bigint; ino: bigint; mtimeMs?: number } | null;
	/** A second name for a file, refusing one that is there; used to put back a lock moved aside by mistake. */
	link?(from: string, to: string): void;
}

/** A lock this run holds. */
export interface Lock {
	path: string;
	token: string;
}

/** The lock file for a new file's full path: hidden, next to it, named after its name as the file system compares names. */
export function lockPath(target: string): string {
	const hash = createHash('sha256').update(foldName(basename(target)), 'utf8').digest('hex').slice(0, 16);
	return join(dirname(target), `.mtm-${hash}.lock`);
}

const errorCode = (e: unknown): unknown => (typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined);

/**
 * Takes the lock for a new file's full path, or null when another run holds it. Throws when the lock can't be made
 * for another reason (a folder that can't be written).
 */
export function takeLock(fs: LockFs, target: string, now: () => number = Date.now): Lock | null {
	const path = lockPath(target);
	const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
	for (let tries = 0; tries < 3; tries++) {
		try {
			fs.writeFile(path, token);
			return { path, token };
		} catch (e) {
			if (errorCode(e) !== 'EEXIST') throw e;
		}
		const held = fs.stat(path);
		// Let go of meanwhile: try again.
		if (!held) continue;
		// Judged by its age, never its content: one just made is still empty.
		// A time far ahead (a clock that was wrong) counts as old too.
		if (held.mtimeMs === undefined || Math.abs(now() - held.mtimeMs) <= STALE_LOCK) return null;
		// Left by a run that stopped: move it aside under a name of this run's own; only one run can.
		const aside = join(dirname(path), `.mtm-${token}.stale`);
		try {
			fs.rename(path, aside);
		} catch {
			continue;
		}
		const moved = fs.stat(aside);
		// A fresh lock was moved, not the old one. The inode alone can't tell: Linux gives a new file the number of one
		// just deleted, so the other run's new lock may carry the old lock's number.
		const fresh = moved?.mtimeMs !== undefined && Math.abs(now() - moved.mtimeMs) <= STALE_LOCK;
		if (moved && (fresh || moved.ino !== held.ino || moved.dev !== held.dev)) {
			// Another run took the old lock over first and made its own, which was moved instead: put it back, unless a
			// third run holds the name by now.
			try {
				fs.link?.(aside, path);
			} catch {
				// Held again: this run will find it so.
			}
		}
		try {
			fs.unlink(aside);
		} catch {
			// A hidden file left behind; it holds no name.
		}
	}
	return null;
}

/** Lets go of a lock, only if it is still this run's (a lock taken over meanwhile is another run's). */
export function releaseLock(fs: LockFs, lock: Lock): void {
	try {
		if (fs.readFile(lock.path) === lock.token) fs.unlink(lock.path);
	} catch {
		// Gone already.
	}
}
