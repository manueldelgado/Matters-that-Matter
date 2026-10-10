// Writing a plan's files safely, all or nothing:
//
// 1. Check: every path stays inside the vault, every file is still what the plan saw (a hash of its content), and
//    every new path is still free.
// 2. Stage: each file's new content goes to a temporary file next to it (with the old file's mode).
// 3. Check again, then commit with renames and links only: an edited file is renamed over, a new file is linked
//    into place (which fails if something appeared there meanwhile), a renamed note is linked to its new name.
// 4. If anything fails while committing, what was committed is put back, in reverse order, from the content the plan
//    saw.
//
// Line endings (CRLF stays CRLF) and the presence of a final newline are kept as the file had them.

import { createHash } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import type { FileOutcome, FileWrite } from './filesLayer';

export type ApplyResult =
	| { ok: true; written: string[] }
	/** A file changed (or a new path was taken) after the plan was made. Nothing was written. */
	| { ok: false; reason: 'changed'; path: string }
	/** A path would leave the vault. Nothing was written. */
	| { ok: false; reason: 'unsafe'; path: string }
	/** Writing failed; everything committed was put back except the files in `left`. */
	| { ok: false; reason: 'failed'; path: string; error: string; left: string[] };

/** The file operations the writer uses (synchronous), so tests can make one fail. */
export interface ApplyFs {
	readFile(path: string): string | null;
	writeFile(path: string, text: string): void;
	rename(from: string, to: string): void;
	/** Fails when `to` exists. */
	link(from: string, to: string): void;
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
	link: (a, b) => linkSync(a, b),
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

/** The new content in the old content's style: its line endings and whether it ends with a newline. */
export function keepStyle(before: string | null, after: string): string {
	if (before === null) return after;
	let out = after;
	const crlf = before.includes('\r\n');
	if (crlf) out = out.replace(/\r?\n/g, '\r\n');
	const eol = crlf ? '\r\n' : '\n';
	const endsBefore = /\r?\n$/.test(before);
	const endsAfter = /\r?\n$/.test(out);
	if (endsBefore && !endsAfter && out !== '') out += eol;
	else if (!endsBefore && endsAfter) out = out.replace(/\r?\n$/, '');
	return out;
}

/** A vault path the writer accepts: relative, `/`-separated, without `.`, `..` or empty parts. */
export function isVaultPath(path: string): boolean {
	if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false;
	return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

const caseOnly = (file: FileWrite) => file.from !== null && file.from !== file.path && file.from.toLowerCase() === file.path.toLowerCase();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let counter = 0;
const tempName = (target: string) => join(dirname(target), `.${basename(target)}.mtm-${process.pid}-${(counter++).toString(36)}.tmp`);

interface Staged {
	file: FileWrite;
	target: string;
	from: string | null;
	temp: string;
	mode: number | null;
}

export function applyOutcome(root: string, outcome: FileOutcome, fs: ApplyFs = nodeFs): ApplyResult {
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

	// Stage.
	const staged: Staged[] = [];
	const madeDirs: string[] = [];
	const cleanUp = () => {
		for (const s of staged) {
			try {
				if (fs.stat(s.temp)) fs.unlink(s.temp);
			} catch {
				// A temporary file left behind is hidden from Obsidian (its name starts with a dot).
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
			fs.writeFile(s.temp, keepStyle(file.before, file.after));
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
	/** Puts content back at a path, replacing what is there (`replace`) or only if the path is free. */
	const restore = (target: string, content: string, mode: number | null, replace: boolean) => {
		const temp = tempName(target);
		try {
			fs.writeFile(temp, content);
			if (mode !== null) fs.chmod(temp, mode);
			if (replace) fs.rename(temp, target);
			else {
				fs.link(temp, target);
				fs.unlink(temp);
			}
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
				fs.link(s.temp, s.target);
				undo.push({ path: s.file.path, run: () => fs.unlink(s.target) });
				fs.unlink(s.temp);
			} else if (s.from === s.target) {
				fs.rename(s.temp, s.target);
				undo.push({ path: s.file.path, run: () => restore(s.target, before, s.mode, true) });
			} else if (caseOnly(s.file)) {
				const from = s.from;
				fs.rename(from, s.target);
				undo.push({ path: s.file.from ?? s.file.path, run: () => fs.rename(s.target, from) });
				fs.rename(s.temp, s.target);
				undo.push({ path: s.file.path, run: () => restore(s.target, before, s.mode, true) });
			} else {
				const from = s.from;
				fs.link(s.temp, s.target);
				undo.push({ path: s.file.path, run: () => fs.unlink(s.target) });
				fs.unlink(s.temp);
				fs.unlink(from);
				undo.push({ path: s.file.from ?? s.file.path, run: () => restore(from, before, s.mode, false) });
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
