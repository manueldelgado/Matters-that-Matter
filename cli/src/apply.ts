// Writing a plan's files safely: each file is checked against the content the plan was made from (a hash), written
// to a temporary file in the same folder and renamed over the old one, so a reader never sees half a file. Line
// endings (CRLF stays CRLF) and the presence of a final newline are kept as the file had them.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { FileOutcome, FileWrite } from './filesLayer';

export type ApplyResult =
	| { ok: true; written: string[] }
	/** `conflict` changed (or appeared) after the plan was made; files in `written` were written before it was found. */
	| { ok: false; conflict: string; written: string[] };

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

const full = (root: string, path: string) => join(root, ...path.split('/'));

function current(root: string, path: string): string | null {
	try {
		return readFileSync(full(root, path), 'utf8');
	} catch {
		return null;
	}
}

/** Whether the file is still as the plan saw it (a new file's path must still be free). */
function unchanged(root: string, file: FileWrite): boolean {
	if (file.from === null) return !existsSync(full(root, file.path));
	const now = current(root, file.from);
	if (now === null || file.before === null || hash(now) !== hash(file.before)) return false;
	// A rename to a free path (a change of case only renames the same file).
	if (file.path !== file.from && file.path.toLowerCase() !== file.from.toLowerCase()) return !existsSync(full(root, file.path));
	return true;
}

/** Writes text to a temporary file next to the target, then renames it over the target. */
export function atomicWrite(target: string, text: string): void {
	const dir = dirname(target);
	mkdirSync(dir, { recursive: true });
	const temp = join(dir, `.${basename(target)}.mtm-${process.pid}-${Date.now().toString(36)}.tmp`);
	try {
		writeFileSync(temp, text, 'utf8');
		renameSync(temp, target);
	} catch (e) {
		rmSync(temp, { force: true });
		throw e;
	}
}

/**
 * Applies an outcome under `root`. Every file is checked before anything is written, and again just before it is
 * written; the first one that changed stops the write.
 */
export function applyOutcome(root: string, outcome: FileOutcome): ApplyResult {
	const written: string[] = [];
	for (const file of outcome.files) {
		if (!unchanged(root, file)) return { ok: false, conflict: file.from ?? file.path, written };
	}
	for (const file of outcome.files) {
		if (!unchanged(root, file)) return { ok: false, conflict: file.from ?? file.path, written };
		const target = full(root, file.path);
		if (file.from !== null && file.from !== file.path) {
			mkdirSync(dirname(target), { recursive: true });
			renameSync(full(root, file.from), target);
		}
		atomicWrite(target, keepStyle(file.before, file.after));
		written.push(file.path);
	}
	return { ok: true, written };
}
