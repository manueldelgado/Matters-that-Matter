// Following renames: the Inbox, the board and the four folders are stored in settings as paths.

import type { MattersSettings } from '../settings';

type PathSettings = Pick<MattersSettings, 'inboxPath' | 'boardPath' | 'folders'>;

/** Where `path` is once `oldPath` became `newPath`: the item itself or something inside it; null when unaffected. */
export function pathAfterRename(path: string, oldPath: string, newPath: string): string | null {
	if (path === oldPath) return newPath;
	if (path.startsWith(oldPath + '/')) return newPath + path.slice(oldPath.length);
	return null;
}

/**
 * The path settings after a file or folder rename, or null when none changed. A renamed folder carries the Inbox,
 * the board and the folder settings inside it; renaming the files one by one afterwards finds nothing more to change.
 */
export function pathSettingsAfterRename(settings: PathSettings, oldPath: string, newPath: string): PathSettings | null {
	const move = (p: string) => pathAfterRename(p, oldPath, newPath) ?? p;
	const folders = { ...settings.folders };
	for (const key of Object.keys(folders) as (keyof PathSettings['folders'])[]) folders[key] = move(folders[key]);
	const next: PathSettings = { inboxPath: move(settings.inboxPath), boardPath: move(settings.boardPath), folders };
	const changed =
		next.inboxPath !== settings.inboxPath ||
		next.boardPath !== settings.boardPath ||
		(Object.keys(folders) as (keyof PathSettings['folders'])[]).some((k) => folders[k] !== settings.folders[k]);
	return changed ? next : null;
}
