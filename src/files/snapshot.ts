// The operations' snapshot over the file index, so they run on plain files as they do inside Obsidian. Pure.

import type { Snapshot } from '../ops/types';
import type { MattersSettings } from '../settings';
import type { NoteData } from '../services/notesModel';
import type { VaultIndex } from './index';

/**
 * A snapshot of an indexed vault. The settings are the plugin's (already migrated), `now` is the caller's clock and
 * `timeZone` the zone it is read in (absent, the host's).
 * Every note's content is held by the index, so `content` answers for any note. Link text follows the vault's
 * "New link format", as Obsidian writes links.
 */
export function filesSnapshot(index: VaultIndex, settings: MattersSettings, now: Date, timeZone?: string): Snapshot {
	const notes: NoteData[] = index.notePaths.map((path) => {
		const note = index.note(path);
		return { path, basename: note?.basename ?? path, frontmatter: note?.frontmatter ?? undefined };
	});
	return {
		settings,
		now,
		...(timeZone ? { timeZone } : {}),
		notes,
		content: (path) => index.content(path),
		links: (path) => index.body(path)?.links.map((ref) => ref.link) ?? [],
		resolve: (link, fromPath) => index.resolve(link, fromPath),
		linkText: (path, fromPath) => index.linkText(path, fromPath),
		exists: (path) => index.existsIgnoringCase(path),
		updatesLinks: index.config.alwaysUpdateLinks,
	};
}
