// `mtm open`: an `obsidian://mtm-open` link for an Action or a Matter, handed to the system to open. The plugin
// handles the link (it needs a version of Matters with links).

import { spawn } from 'node:child_process';

export type Opener = (url: string) => Promise<void>;

/** What a link opens: an Action note (`file`, as Obsidian's own links name notes), a Matter or a board. */
export type OpenTarget = { file: string } | { matter: string } | { board: string };

/** The link Matters opens: `obsidian://mtm-open?vault=<name>&file=<path>` (or `matter=`, `board=`). */
export function openUrl(vaultName: string, target: OpenTarget): string {
	const [key, value] = Object.entries(target)[0] as [string, string];
	return `obsidian://mtm-open?vault=${encodeURIComponent(vaultName)}&${key}=${encodeURIComponent(value)}`;
}

/** Asks the system to open a link: `open` on macOS, `start` on Windows, `xdg-open` elsewhere. */
export function systemOpener(platform: string = process.platform): Opener {
	return (url) =>
		new Promise((resolve, reject) => {
			const [command, args] =
				platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
			const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
			child.once('error', reject);
			child.once('spawn', () => {
				child.unref();
				resolve();
			});
		});
}
