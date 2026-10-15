// Reading MTM notes through metadataCache, and creating files and folders.

import { normalizePath, TFile, type App, type TAbstractFile } from 'obsidian';
import { plainFences } from '../files/fences';
import { parseLaneOrder } from '../model/matters';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import type { Frontmatter } from '../services/notesModel';
import { STRINGS } from '../strings';

export type { Frontmatter } from '../services/notesModel';

export function frontmatterOf(app: App, file: TFile): Frontmatter | undefined {
	return app.metadataCache.getFileCache(file)?.frontmatter;
}

/** Notes are identified by mtm-kind, never by folder. */
export function notesOfKind(app: App, kind: 'matter' | 'action'): TFile[] {
	return app.vault.getMarkdownFiles().filter((f) => frontmatterOf(app, f)?.['mtm-kind'] === kind);
}

/** The highest lane order among Matter notes, the Inbox included (setup numbers adopted Matters after it). */
export function maxLaneOrder(app: App): number | null {
	const orders = notesOfKind(app, 'matter')
		.map((f) => parseLaneOrder(frontmatterOf(app, f)?.['mtm-lane-order']))
		.filter((n): n is number => n !== null);
	return orders.length ? Math.max(...orders) : null;
}

/**
 * Whether a file already uses this path, ignoring case: macOS and Windows treat "Call Bob.md" and "call bob.md"
 * as the same file, so creating or renaming onto it fails. `except` is the file being renamed.
 */
export function pathTaken(app: App, path: string, except?: TAbstractFile): boolean {
	const target = normalizePath(path);
	const exact = app.vault.getAbstractFileByPath(target);
	if (exact) return exact !== except;
	const slash = target.lastIndexOf('/');
	const parent = slash < 0 ? app.vault.getRoot() : app.vault.getFolderByPath(target.slice(0, slash));
	const lower = target.toLowerCase();
	return !!parent?.children.some((child) => child !== except && child.path.toLowerCase() === lower);
}

/**
 * Whether a Markdown note anywhere in the vault already has this name, ignoring case. A new note with that name
 * would receive every link written to the other one by name. `except` is a note whose name may be shared.
 */
export function nameTaken(app: App, name: string, except?: TAbstractFile): boolean {
	return notesNamed(app, name, except).length > 0;
}

/** The Markdown notes anywhere in the vault with this name, ignoring case (see `nameTaken`). */
export function notesNamed(app: App, name: string, except?: TAbstractFile): TFile[] {
	const lower = name.toLowerCase();
	return app.vault.getMarkdownFiles().filter((f) => f !== except && f.basename.toLowerCase() === lower);
}

/**
 * Changes a note's properties through `FileManager.processFrontMatter`. Obsidian reads a properties block after a
 * byte-order mark, or between `---` lines with trailing spaces, but `processFrontMatter` doesn't find it there and
 * writes a second block in front, so the note would lose its properties: such fence lines are made plain first.
 */
export async function processFrontMatter(app: App, file: TFile, change: (fm: Frontmatter) => void): Promise<void> {
	// The adapter, because `Vault.read` hides a byte-order mark.
	if (plainFences(await app.vault.adapter.read(file.path)) !== null) {
		await app.vault.process(file, (content) => plainFences(content) ?? content);
	}
	await app.fileManager.processFrontMatter(file, change);
}

export function exists(app: App, path: string): boolean {
	return app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
}

/** Creates the folder and any missing parents. */
export async function ensureFolder(app: App, path: string): Promise<void> {
	const parts = normalizePath(path).split('/').filter(Boolean);
	for (let i = 1; i <= parts.length; i++) {
		const level = parts.slice(0, i).join('/');
		if (!app.vault.getAbstractFileByPath(level)) await app.vault.createFolder(level);
	}
}

/** Creates a note and sets its frontmatter through processFrontMatter, so Obsidian writes the YAML. */
export async function createNote(app: App, path: string, frontmatter: Frontmatter, body = ''): Promise<TFile> {
	const file = await app.vault.create(normalizePath(path), body);
	if (Object.keys(frontmatter).length > 0) {
		await processFrontMatter(app, file, (fm: Frontmatter) => {
			Object.assign(fm, frontmatter);
		});
	}
	return file;
}

/** The text of a link to `target` from `sourcePath`, shortest unambiguous form, in brackets. */
export function linkTo(app: App, target: TFile, sourcePath: string): string {
	return `[[${app.metadataCache.fileToLinktext(target, sourcePath, true)}]]`;
}

/** A person is a plain note in the people folder: people get no MTM properties. */
export async function createPersonNote(app: App, peopleFolder: string, name: string): Promise<TFile> {
	const folder = normalizePath(peopleFolder);
	await ensureFolder(app, folder);
	const title = uniqueTitle(sanitiseTitle(name) || STRINGS.untitledPerson, (t) => pathTaken(app, `${folder}/${t}.md`));
	return app.vault.create(`${folder}/${title}.md`, '');
}
