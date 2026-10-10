// Applies the operations' plans through Obsidian: Obsidian writes the YAML, bodies change line by line, and renames
// update links as the user's settings say.

import { normalizePath, type App, type TFile } from 'obsidian';
import { applyBodyEdit, applyFrontmatterEdit } from '../ops/plan';
import type { Plan } from '../ops/types';
import { withBody } from '../services/planContent';
import type { Frontmatter } from './notes';
import { ensureFolder } from './notes';

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function fileAt(app: App, path: string): TFile {
	const file = app.vault.getFileByPath(normalizePath(path));
	if (!file) throw new Error(`${path} does not exist`);
	return file;
}

/**
 * Applies a plan in its order: creates, edits, bodies, renames (edits and bodies name paths before any rename).
 * A new note is created empty, its frontmatter written in the plan's order, then its body added after it.
 */
export async function applyPlan(app: App, plan: Plan): Promise<void> {
	for (const create of plan.creates) {
		const path = normalizePath(create.path);
		const folder = folderOf(path);
		if (folder) await ensureFolder(app, folder);
		const file = await app.vault.create(path, '');
		if (create.frontmatter.length) {
			await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
				for (const [key, value] of create.frontmatter) fm[key] = value;
			});
		}
		if (create.body) await app.vault.process(file, (content) => withBody(content, create.body));
	}
	for (const edit of plan.edits) {
		await app.fileManager.processFrontMatter(fileAt(app, edit.path), (fm: Frontmatter) => applyFrontmatterEdit(fm, edit));
	}
	for (const body of plan.bodies) {
		await app.vault.process(fileAt(app, body.path), (content) => applyBodyEdit(content, body.edit));
	}
	for (const rename of plan.renames) {
		const to = normalizePath(rename.to);
		const folder = folderOf(to);
		if (folder) await ensureFolder(app, folder);
		await app.fileManager.renameFile(fileAt(app, rename.from), to);
	}
}
