// Writing a plan's files safely, all or nothing:
//
// 1. Check: every path stays inside the vault, every file is still what the plan saw (a hash of its content), every
//    new path is still free, and no note to be changed or renamed is read-only (its owner can't write it).
// 2. Stage: each file's new content goes to a temporary file in the same folder (with the old file's mode). Its name
//    is short and doesn't repeat the note's (`.mtm-<process>-<n>-<random>.tmp`), so a note whose name is near the
//    file system's limit can still be written; it starts with a dot, so Obsidian and the vault's reader skip it.
// 3. Check again, then commit with renames only: an edited file's new content is renamed over it; a new file is
//    renamed into place; a renamed note is moved to its new name, then its new content renamed over it. Obsidian's
//    file watcher sees each of these as the move or change it is.
//
//    A rename replaces whatever is at its target, so before a new file or a renamed note takes a path, the path is
//    checked again: free, or (a case-only rename) the same file. Between that check and the rename there is a window
//    of microseconds in which another program could create a file there and lose it; it is accepted, as no portable
//    "rename unless it exists" exists, and linking instead (which refuses to replace) leaves Obsidian believing the
//    old name is still there.
// 4. If anything fails while committing, what was committed is put back, in reverse order, from the content the plan
//    saw.
//
// The bytes written are exactly what the files layer computed (line endings and all).

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { FileWrite as LayerWrite } from './filesLayer';

/** What the writer needs of each file the files layer computed. */
export type FileWrite = Pick<LayerWrite, 'path' | 'from' | 'before' | 'after'>;

export type ApplyResult =
	| { ok: true; written: string[] }
	/** A file changed (or a new path was taken) after the plan was made. Nothing was written. */
	| { ok: false; reason: 'changed'; path: string }
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
	stat(path: string): { dev: bigint; ino: bigint; mode: number } | null;
	realpath(path: string): string;
	mkdir(path: string): void;
	rmdir(path: string): void;
	chmod(path: string, mode: number): void;
}

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
			return { dev: s.dev, ino: s.ino, mode: Number(s.mode & 0o7777n) };
		} catch {
			return null;
		}
	},
	realpath: (p) => realpathSync(p),
	mkdir: (p) => mkdirSync(p),
	rmdir: (p) => rmdirSync(p),
	chmod: (p, mode) => chmodSync(p, mode),
};

export const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A vault path the writer accepts: relative, `/`-separated, without `.`, `..` or empty parts. */
export function isVaultPath(path: string): boolean {
	if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false;
	return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

const caseOnly = (file: FileWrite) => file.from !== null && file.from !== file.path && file.from.toLowerCase() === file.path.toLowerCase();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let counter = 0;
/** A temporary file in the target's folder; the random part keeps it clear of one a crashed run left behind. */
const tempName = (target: string) => join(dirname(target), `.mtm-${process.pid}-${(counter++).toString(36)}-${randomBytes(3).toString('hex')}.tmp`);

/** Whether the file's owner may write it (a note made read-only, say with `chmod 444`, may not). */
const writable = (mode: number) => (mode & 0o200) !== 0;

interface Staged {
	file: FileWrite;
	target: string;
	from: string | null;
	temp: string;
	mode: number | null;
}

/** The first note to be changed or renamed that is read-only, or null. A dry run asks too, so it says what a write would. */
export function readOnlyNote(root: string, outcome: { files: readonly FileWrite[] }, fs: ApplyFs = nodeFs): string | null {
	for (const file of outcome.files) {
		if (file.from === null) continue;
		const mode = fs.stat(join(root, ...file.from.split('/')))?.mode;
		if (mode !== undefined && !writable(mode)) return file.from;
	}
	return null;
}

export function applyOutcome(root: string, outcome: { files: readonly FileWrite[] }, fs: ApplyFs = nodeFs): ApplyResult {
	const full = (path: string) => join(root, ...path.split('/'));
	let realRoot: string;
	try {
		realRoot = fs.realpath(root);
	} catch (e) {
		return { ok: false, reason: 'failed', path: '', error: message(e), left: [] };
	}

	/** Whether a folder (or the nearest one of its parents that exists) really is inside the vault. */
	const inside = (dir: string): boolean => {
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

	for (const file of outcome.files) {
		const paths = file.from === null ? [file.path] : [file.path, file.from];
		const bad = paths.find((p) => !isVaultPath(p) || !inside(dirname(full(p))));
		if (bad !== undefined) return { ok: false, reason: 'unsafe', path: bad };
	}

	/** The first file that isn't as the plan saw it, or whose new path was taken. */
	const stale = (): string | null => {
		for (const file of outcome.files) {
			const target = full(file.path);
			if (file.from === null) {
				if (fs.stat(target)) return file.path;
				continue;
			}
			const now = fs.readFile(full(file.from));
			if (now === null || file.before === null || hash(now) !== hash(file.before)) return file.from;
			if (file.from === file.path) continue;
			const there = fs.stat(target);
			if (!there) continue;
			// Only the same file under another case may be there (a case-insensitive file system).
			const self = fs.stat(full(file.from));
			if (!caseOnly(file) || !self || self.ino !== there.ino || self.dev !== there.dev) return file.path;
		}
		return null;
	};

	const changed = stale();
	if (changed !== null) return { ok: false, reason: 'changed', path: changed };

	// A read-only note is left alone: a rename would replace it all the same, so nothing is written.
	const readOnly = readOnlyNote(root, outcome, fs);
	if (readOnly !== null) return { ok: false, reason: 'read-only', path: readOnly };

	// Stage.
	const staged: Staged[] = [];
	const madeDirs: string[] = [];
	const cleanUp = () => {
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
			const s: Staged = { file, target, from, temp: tempName(target), mode: from ? (fs.stat(from)?.mode ?? null) : null };
			staged.push(s);
			fs.writeFile(s.temp, file.after);
			if (s.mode !== null) fs.chmod(s.temp, s.mode);
		}
	} catch (e) {
		cleanUp();
		return { ok: false, reason: 'failed', path: current, error: message(e), left: [] };
	}

	const again = stale();
	if (again !== null) {
		cleanUp();
		return { ok: false, reason: 'changed', path: again };
	}

	// Commit; every step that changes the vault leaves a way back.
	const undo: { path: string; run: () => void }[] = [];
	/** Throws unless `target` is free, or is `from` itself under another case (a case-insensitive file system). */
	const claim = (target: string, from: string | null, path: string) => {
		const there = fs.stat(target);
		if (!there) return;
		const self = from === null ? null : fs.stat(from);
		if (!self || self.ino !== there.ino || self.dev !== there.dev) throw new Error(`${path} appeared meanwhile`);
	};
	/** Puts content back over a path. */
	const restore = (target: string, content: string, mode: number | null) => {
		const temp = tempName(target);
		try {
			fs.writeFile(temp, content);
			if (mode !== null) fs.chmod(temp, mode);
			fs.rename(temp, target);
		} catch (e) {
			if (fs.stat(temp)) fs.unlink(temp);
			throw e;
		}
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
				undo.push({ path: s.file.path, run: () => restore(s.target, before, s.mode) });
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
		return { ok: false, reason: 'failed', path: current, error: message(e), left };
	}
	cleanUp();
	return { ok: true, written };
}
