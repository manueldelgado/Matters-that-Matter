// Vault paths: `/`-separated, relative to the vault root, no leading slash. Pure.

/** The folder holding a path ('' at the root). */
export function parentOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/** The last part of a path, extension included. */
export function nameOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** The extension without the dot, lower case ('' when there is none). */
export function extensionOf(path: string): string {
	const name = nameOf(path);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The path without `.md` (other extensions kept). */
export function withoutMd(path: string): string {
	return extensionOf(path) === 'md' ? path.slice(0, -3) : path;
}

/** The name without `.md`: what a note is called. */
export function basenameOf(path: string): string {
	return withoutMd(nameOf(path));
}

/** Joins `relative` onto `folder`, resolving `.` and `..`; null when it climbs above the vault root. */
export function joinPath(folder: string, relative: string): string | null {
	const parts = folder === '' ? [] : folder.split('/');
	for (const part of relative.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (parts.length === 0) return null;
			parts.pop();
		} else parts.push(part);
	}
	return parts.join('/');
}

/** The path from `fromFolder` to `path`, with `../` to climb ('' folders mean the root). */
export function relativePath(fromFolder: string, path: string): string {
	const from = fromFolder === '' ? [] : fromFolder.split('/');
	const to = path.split('/');
	let common = 0;
	while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
	return [...Array<string>(from.length - common).fill('..'), ...to.slice(common)].join('/');
}

/** Code-unit order, as JavaScript's default sort (never the locale). */
export function byCodeUnit(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
