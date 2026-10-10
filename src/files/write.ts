// A plan applied to file contents: what every file holds after the operations' writes, as Obsidian would leave it.
// Pure: files are read through the reader passed in, and nothing is written; the caller writes the result (checking
// that each file still holds `before`) and moves renamed files.

import { applyBodyEdit } from '../ops/plan';
import type { Plan } from '../ops/types';
import { editFrontmatter, FrontmatterError, keepingBom, newNoteContent } from './frontmatterEdit';
import { isVaultFile, readLinkConfig, type LinkConfig, type VaultReader } from './index';
import { changedLines, type LineChange } from './lineDiff';
import { byCodeUnit } from './paths';
import { renameLinks, type LinkChange } from './rename';

export type { LineChange } from './lineDiff';
export type { LinkChange } from './rename';

/** One file a plan writes. */
export interface FileWrite {
	/** Where the file goes. */
	path: string;
	/** Where it is now: the same path, the old path of a renamed note, or null for a new file. */
	from: string | null;
	/** Its content when the plan was applied (null for a new file); a writer refuses to write if the file differs by then. */
	before: string | null;
	/** Its whole new content. */
	after: string;
	/** The lines that differ between `before` and `after`. */
	changes: LineChange[];
}

/** Links a rename rewrote in one note: the note's path after the plan and the lines (1-based). */
export interface LinkUpdate {
	path: string;
	lines: number[];
}

/** Everything a plan does to the files. */
export interface FileOutcome {
	/** In the order they were first touched: new notes, then edited notes, then notes whose links a rename rewrote. */
	files: FileWrite[];
	/** Notes whose links a rename rewrote ("Automatically update internal links" on). */
	links: LinkUpdate[];
	/** How many links point nowhere after the plan (renames with that setting off). */
	danglingLinks: number;
	/** Each link a rename rewrote or left pointing nowhere, paths as before the rename. */
	linkChanges: { rewritten: LinkChange[]; dangling: LinkChange[] };
}

export interface WriteOptions {
	/** The vault's configuration folder. */
	configDir: string;
	/** The link settings; read from the configuration folder's `app.json` when absent. */
	links?: LinkConfig;
}

export type WriteErrorCode = 'exists' | 'missing' | 'invalid-properties' | 'not-mtm';

/** Why a plan can't be applied; nothing is written. */
export class WriteError extends Error {
	constructor(
		readonly code: WriteErrorCode,
		readonly path: string,
		message: string,
	) {
		super(message);
		this.name = 'WriteError';
	}
}

interface Touched {
	from: string | null;
	before: string | null;
	content: string;
}

/**
 * Applies a plan to the vault's files as text: creates, then frontmatter edits (`mtm-` keys only), then body edits,
 * then renames (with links rewritten when the vault's "Automatically update internal links" is on). Paths in edits
 * and bodies are paths before any rename. Throws a `WriteError` when a file to create exists, a file to change is
 * missing, properties to edit aren't valid YAML, or an edit names a key without the `mtm-` prefix.
 */
export function contentsAfter(plan: Plan, reader: VaultReader, options: WriteOptions): FileOutcome {
	const links = options.links ?? readLinkConfig(reader, options.configDir);
	const files = new Set([...reader.list()].filter((p) => isVaultFile(p, options.configDir)));
	const touched = new Map<string, Touched>();
	const linkLines = new Map<string, Set<number>>();
	const rewritten: LinkChange[] = [];
	const dangling: LinkChange[] = [];

	const read = (path: string): string | null => {
		const t = touched.get(path);
		if (t) return t.content;
		if (!files.has(path)) return null;
		try {
			return reader.read(path);
		} catch {
			return null;
		}
	};
	const update = (path: string, content: string) => {
		const t = touched.get(path);
		if (t) t.content = content;
		else {
			const before = read(path);
			touched.set(path, { from: path, before, content });
		}
	};
	const existing = (path: string): string => {
		const content = read(path);
		if (content === null) throw new WriteError('missing', path, `${path} doesn't exist`);
		return content;
	};
	const taken = (path: string) => [...files].some((p) => p.toLowerCase() === path.toLowerCase());

	for (const create of plan.creates) {
		if (taken(create.path)) throw new WriteError('exists', create.path, `${create.path} already exists`);
		touched.set(create.path, { from: null, before: null, content: newNoteContent(create.frontmatter, create.body) });
		files.add(create.path);
	}
	for (const edit of plan.edits) {
		const wrong = [...Object.keys(edit.set), ...edit.remove].find((k) => !k.startsWith('mtm-'));
		if (wrong !== undefined) throw new WriteError('not-mtm', edit.path, `Only mtm- properties are written; ${wrong} was asked for in ${edit.path}`);
		try {
			update(edit.path, editFrontmatter(existing(edit.path), edit.set, edit.remove, edit.path));
		} catch (e) {
			if (e instanceof FrontmatterError) throw new WriteError('invalid-properties', edit.path, e.message);
			throw e;
		}
	}
	for (const body of plan.bodies) update(body.path, keepingBom(existing(body.path), (content) => applyBodyEdit(content, body.edit)));
	for (const { from, to } of plan.renames) {
		existing(from);
		if (from.toLowerCase() !== to.toLowerCase() && taken(to)) throw new WriteError('exists', to, `${to} already exists`);
		const result = renameLinks({ files: [...files], content: read }, from, to, { updateLinks: links.alwaysUpdateLinks, format: links.newLinkFormat });
		for (const [path, content] of result.contents) update(path, content);
		const moved = (path: string) => (path === from ? to : path);
		for (const change of result.rewritten) {
			const set = linkLines.get(moved(change.path)) ?? new Set<number>();
			set.add(change.line + 1);
			linkLines.set(moved(change.path), set);
		}
		rewritten.push(...result.rewritten);
		dangling.push(...result.dangling);
		// The file moves; whatever it holds goes with it.
		const entry = touched.get(from) ?? { from, before: read(from), content: existing(from) };
		touched.delete(from);
		touched.set(to, entry);
		files.delete(from);
		files.add(to);
	}

	const out: FileWrite[] = [];
	for (const [path, t] of touched) {
		if (t.from === path && t.before === t.content) continue;
		out.push({ path, from: t.from, before: t.before, after: t.content, changes: changedLines(t.before ?? '', t.content) });
	}
	return {
		files: out,
		links: [...linkLines].map(([path, lines]) => ({ path, lines: [...lines].sort((a, b) => a - b) })),
		danglingLinks: dangling.length,
		linkChanges: { rewritten, dangling },
	};
}

/** The files after a plan, as a map from path to content: every file the plan wrote, and none it moved away. */
export function treeAfter(outcome: FileOutcome): { written: Map<string, string>; removed: string[] } {
	const written = new Map(outcome.files.map((f) => [f.path, f.after]));
	const removed = outcome.files.filter((f) => f.from !== null && f.from !== f.path && !written.has(f.from)).map((f) => f.from as string);
	return { written, removed: removed.sort(byCodeUnit) };
}
