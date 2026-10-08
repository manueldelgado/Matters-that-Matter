// Process Inbox writes that quick add and the inspector don't already make: trash with undo, and keep as a note.

import { normalizePath, type App, type TFile } from 'obsidian';
import { uniqueTitle } from '../model/titles';
import { stripMtmProperties } from '../services/processInbox';
import { ensureFolder, type Frontmatter } from './notes';

/** What Undo needs to bring a trashed note back. */
export interface TrashedNote {
	path: string;
	content: string;
}

/** Trashes through the file manager (the user's trash setting); the content is kept for Undo. */
export async function trashForUndo(app: App, file: TFile): Promise<TrashedNote> {
	const content = await app.vault.read(file);
	const path = file.path;
	await app.fileManager.trashFile(file);
	return { path, content };
}

/** Writes the note back where it was (with a number if the name was taken meanwhile). */
export async function restoreTrashed(app: App, note: TrashedNote): Promise<TFile> {
	const slash = note.path.lastIndexOf('/');
	const folder = slash > 0 ? note.path.slice(0, slash) : '';
	const base = note.path.slice(slash + 1).replace(/\.md$/i, '');
	if (folder) await ensureFolder(app, folder);
	const pathFor = (t: string) => normalizePath(folder ? `${folder}/${t}.md` : `${t}.md`);
	const title = uniqueTitle(base, (t) => app.vault.getAbstractFileByPath(pathFor(t)) !== null);
	return app.vault.create(pathFor(title), note.content);
}

/** Obsidian's folder for new notes, as the user set it. */
export function defaultNoteFolder(app: App, file: TFile): string {
	const parent = app.fileManager.getNewFileParent(file.path);
	return parent.path === '/' ? '' : parent.path;
}

/** Removes every mtm- property (the body stays) and moves the note, so links update. */
export async function keepAsNote(app: App, file: TFile, folder: string): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => stripMtmProperties(fm));
	const target = normalizePath(folder.trim()) === '/' ? '' : normalizePath(folder.trim());
	if (target) await ensureFolder(app, target);
	const current = file.parent?.path === '/' ? '' : (file.parent?.path ?? '');
	if (current === target) return;
	const pathFor = (t: string) => normalizePath(target ? `${target}/${t}.md` : `${t}.md`);
	const title = uniqueTitle(file.basename, (t) => app.vault.getAbstractFileByPath(pathFor(t)) !== null);
	await app.fileManager.renameFile(file, pathFor(title));
}
