// Locks that hold a new name while a write takes it: held, let go of only by their owner, taken over once old (by
// their modification time, whatever they hold), and taken over by one run only.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nodeFs } from '../../cli/src/apply';
import { lockPath, releaseLock, STALE_LOCK, takeLock, type LockFs } from '../../cli/src/locks';
import { finishWritesOnSignal } from '../../cli/src/signals';
import { tempDir } from './helpers';

const made: string[] = [];
const dir = () => {
	const d = tempDir('mtm-locks-');
	made.push(d);
	return d;
};
afterEach(() => {
	for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const old = (path: string, ms: number) => {
	const t = new Date(Date.now() - ms);
	utimesSync(path, t, t);
};

describe('locks', () => {
	it('are hidden, next to the file, and one per name as the file system compares names', () => {
		const d = dir();
		expect(lockPath(join(d, 'Call Marco.md'))).toMatch(/\/\.mtm-[0-9a-f]{16}\.lock$/);
		expect(lockPath(join(d, 'Straße.md'))).toBe(lockPath(join(d, 'STRASSE.md')));
		expect(lockPath(join(d, 'ﬁle.md'))).toBe(lockPath(join(d, 'FILE.md')));
		expect(lockPath(join(d, 'A.md'))).not.toBe(lockPath(join(d, 'B.md')));
	});

	it('a held lock can’t be taken, and only its owner lets go of it', () => {
		const target = join(dir(), 'New.md');
		const mine = takeLock(nodeFs, target);
		if (!mine) throw new Error('expected the lock');
		expect(takeLock(nodeFs, target)).toBeNull();
		releaseLock(nodeFs, { path: mine.path, token: 'someone else' });
		expect(existsSync(mine.path)).toBe(true);
		releaseLock(nodeFs, mine);
		expect(existsSync(mine.path)).toBe(false);
	});

	it('a lock just made, still empty, is held', () => {
		const target = join(dir(), 'New.md');
		writeFileSync(lockPath(target), '');
		expect(takeLock(nodeFs, target)).toBeNull();
	});

	it.each([
		['a time', () => String(Date.now())],
		['nothing that reads as a time', () => 'garbage'],
		['a time far ahead', () => String(Date.now() + 1e9)],
	])('one older than %s says is taken over, by its modification time', (_, content) => {
		const target = join(dir(), 'New.md');
		writeFileSync(lockPath(target), content());
		old(lockPath(target), STALE_LOCK + 5_000);
		const lock = takeLock(nodeFs, target);
		expect(lock).not.toBeNull();
		expect(readFileSync(lockPath(target), 'utf8')).toBe(lock?.token);
		expect(readdirSync(join(target, '..')).filter((n) => n.endsWith('.stale'))).toEqual([]);
	});

	it('a modification time far ahead counts as old', () => {
		const target = join(dir(), 'New.md');
		writeFileSync(lockPath(target), 'x');
		const ahead = new Date(Date.now() + 3_600_000);
		utimesSync(lockPath(target), ahead, ahead);
		expect(takeLock(nodeFs, target)).not.toBeNull();
	});

	it('two runs taking over one old lock: only the first gets it', () => {
		const target = join(dir(), 'New.md');
		writeFileSync(lockPath(target), 'left behind');
		old(lockPath(target), STALE_LOCK + 5_000);
		// The second run saw the old lock, but the first took it over just before the second moved it aside.
		const seen = statSync(lockPath(target), { bigint: true });
		let first: ReturnType<typeof takeLock> = null;
		const second: LockFs = {
			...nodeFs,
			stat: (p) => {
				if (p !== lockPath(target) || first) return nodeFs.stat(p);
				first = takeLock(nodeFs, target);
				return { dev: seen.dev, ino: seen.ino, mtimeMs: Number(seen.mtimeMs) };
			},
		};
		expect(takeLock(second, target)).toBeNull();
		expect(first).not.toBeNull();
		// The first run's lock is back in place, and nothing else is left.
		expect(readFileSync(lockPath(target), 'utf8')).toBe(first?.['token']);
		expect(readdirSync(join(target, '..')).filter((n) => n.startsWith('.mtm'))).toHaveLength(1);
	});

	it('a folder that can’t be written is an error, not a lock held', () => {
		const target = join(dir(), 'No such folder', 'New.md');
		expect(() => takeLock(nodeFs, target)).toThrow();
	});
});

describe('signals', () => {
	it('end the process with the usual code, after what runs now', () => {
		const listeners = new Map<string, () => void>();
		const exits: number[] = [];
		finishWritesOnSignal({ on: (signal, listener) => listeners.set(signal, listener), exit: (code) => void exits.push(code) });
		listeners.get('SIGINT')?.();
		listeners.get('SIGTERM')?.();
		expect(exits).toEqual([130, 143]);
	});
});
