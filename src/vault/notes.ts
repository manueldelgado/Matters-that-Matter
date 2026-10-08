// Reading MTM notes through metadataCache, and creating files and folders.

import { normalizePath, TFile, type App } from 'obsidian';
import { parseLaneOrder } from '../model/matters';
import { sanitiseTitle, uniqueTitle } from '../model/titles';

export type Frontmatter = Record<string, unknown>;

export function frontmatterOf(app: App, file: TFile): Frontmatter | undefined {
	return app.metadataCache.getFileCache(file)?.frontmatter;
}

/** Notes are identified by mtm-kind, never by folder. */
export function notesOfKind(app: App, kind: 'matter' | 'action'): TFile[] {
	return app.vault.getMarkdownFiles().filter((f) => frontmatterOf(app, f)?.['mtm-kind'] === kind);
}

export function maxLaneOrder(app: App): number | null {
	const orders = notesOfKind(app, 'matter')
		.map((f) => parseLaneOrder(frontmatterOf(app, f)?.['mtm-lane-order']))
		.filter((n): n is number => n !== null);
	return orders.length ? Math.max(...orders) : null;
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
		await app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
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
	const title = uniqueTitle(sanitiseTitle(name) || name, (t) => app.vault.getAbstractFileByPath(`${folder}/${t}.md`) !== null);
	return app.vault.create(`${folder}/${title}.md`, '');
}
