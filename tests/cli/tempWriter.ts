// TEMPORARY, for these tests only: a minimal plan applier standing in for the files layer's writing code until it
// lands (then the tests use that one, and this file goes). It sets and removes keys through a YAML document, writes
// new notes from their entries, applies body edits with the operations' own function, and renames without
// rewriting links. It doesn't promise Obsidian's exact bytes.

import { parseDocument, stringify } from 'yaml';
import type { ContentsAfter, FileWrite } from '../../cli/src/filesLayer';
import { applyBodyEdit } from '../../src/ops/plan';

function newNote(frontmatter: [string, unknown][], body: string): string {
	return `---\n${stringify(Object.fromEntries(frontmatter), { lineWidth: 0 })}---\n${body}`;
}

function editFrontmatter(content: string, set: Record<string, unknown>, remove: readonly string[]): string {
	const m = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(content);
	const yaml = m ? (m[1] ?? '') : '';
	const doc = parseDocument(yaml);
	for (const [key, value] of Object.entries(set)) doc.set(key, value);
	for (const key of remove) doc.delete(key);
	const block = `---\n${doc.toString({ lineWidth: 0 })}---\n`;
	return m ? block + content.slice(m[0].length) : block + content;
}

export const tempContentsAfter: ContentsAfter = (plan, reader) => {
	const files = new Map<string, FileWrite>();
	const get = (path: string): FileWrite => {
		const known = files.get(path);
		if (known) return known;
		const before = reader.read(path);
		const write: FileWrite = { path, from: path, before, after: before ?? '' };
		files.set(path, write);
		return write;
	};
	for (const c of plan.creates) files.set(c.path, { path: c.path, from: null, before: null, after: newNote(c.frontmatter, c.body) });
	for (const e of plan.edits) {
		const w = get(e.path);
		w.after = editFrontmatter(w.after, e.set, e.remove);
	}
	for (const b of plan.bodies) {
		const w = get(b.path);
		w.after = applyBodyEdit(w.after, b.edit);
	}
	for (const r of plan.renames) get(r.from).path = r.to;
	return { files: [...files.values()], links: [], danglingLinks: 0 };
};
