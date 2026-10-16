// The operations' snapshot of the vault, read from Obsidian's metadata cache.

import { getLinkpath, type App } from 'obsidian';
import type { Snapshot } from '../ops/types';
import type { MattersSettings } from '../settings';
import { now } from './clock';
import { frontmatterOf, newNoteId, pathTaken } from './notes';

/**
 * Takes a snapshot for the operations. The content of every Action note is read ahead (`cachedRead`), so `content`
 * answers at once; `contents: false` skips that for operations that never read content (adding an Action, finding a note by name).
 */
export async function buildSnapshot(app: App, settings: MattersSettings, options: { contents?: boolean } = {}): Promise<Snapshot> {
	const { vault, metadataCache } = app;
	const files = vault.getMarkdownFiles();
	const notes = files.map((file) => ({ path: file.path, basename: file.basename, frontmatter: frontmatterOf(app, file) }));
	const contents = new Map<string, string>();
	if (options.contents !== false) {
		const actions = files.filter((file, i) => notes[i]?.frontmatter?.['mtm-kind'] === 'action');
		await Promise.all(actions.map(async (file) => contents.set(file.path, await vault.cachedRead(file))));
	}
	return {
		settings,
		now: now(),
		notes,
		content: (path) => contents.get(path) ?? null,
		links: (path) => {
			const file = vault.getFileByPath(path);
			return (file && metadataCache.getFileCache(file)?.links?.map((l) => l.link)) ?? [];
		},
		embeds: (path) => {
			const file = vault.getFileByPath(path);
			return (file && metadataCache.getFileCache(file)?.embeds?.map((e) => e.link)) ?? [];
		},
		resolve: (link, fromPath) => metadataCache.getFirstLinkpathDest(getLinkpath(link), fromPath)?.path ?? null,
		linkText: (path, fromPath) => {
			const file = vault.getFileByPath(path);
			return file ? metadataCache.fileToLinktext(file, fromPath, true) : path.replace(/\.md$/i, '');
		},
		exists: (path) => pathTaken(app, path),
		newId: newNoteId,
	};
}
