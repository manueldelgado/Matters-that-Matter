// `mtm open`: an `obsidian://mtm-open` link for an Action or a Matter, handed to the system to open. The plugin
// handles the link (it needs a version of the plugin with links).
//
// The link names the vault by its ID when Obsidian's own list of vaults (`obsidian.json`) knows the folder, so two
// vaults with the same folder name can't be confused; otherwise by the folder's name, as Obsidian shows it.

import { spawn, type SpawnOptions } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { clearTimeout, setTimeout } from 'node:timers';
import { basename, join } from 'node:path';

export type Opener = (url: string) => Promise<void>;

/** What a link opens: an Action note (`file`, as Obsidian's own links name notes), a Matter or a board. */
export type OpenTarget = { file: string } | { matter: string } | { board: string };

/** The link the plugin opens: `obsidian://mtm-open?vault=<ID or name>&file=<path>` (or `matter=`, `board=`). */
export function openUrl(vault: string, target: OpenTarget): string {
	const [key, value] = Object.entries(target)[0] as [string, string];
	return `obsidian://mtm-open?vault=${encodeURIComponent(vault)}&${key}=${encodeURIComponent(value)}`;
}

/**
 * Obsidian's own settings folder, which holds `obsidian.json`: `~/Library/Application Support/obsidian` on macOS,
 * `%APPDATA%\obsidian` on Windows, `$XDG_CONFIG_HOME/obsidian` (or `~/.config/obsidian`) elsewhere.
 */
export function obsidianSettingsDir(platform: string, env: Readonly<Record<string, string | undefined>>, home: string): string | null {
	if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'obsidian');
	if (platform === 'win32') return env.APPDATA ? join(env.APPDATA, 'obsidian') : null;
	return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'obsidian');
}

const real = (path: string): string | null => {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
};

/**
 * How a link names this vault: its ID in `obsidian.json` when a listed vault is this folder (both paths resolved),
 * else the name of the folder (resolved too, so a link to the vault opens the vault itself).
 */
export function vaultRef(root: string, obsidianDir: string | null): string {
	const here = real(root) ?? root;
	if (obsidianDir) {
		try {
			const listed = (JSON.parse(readFileSync(join(obsidianDir, 'obsidian.json'), 'utf8')) as { vaults?: Record<string, { path?: unknown }> }).vaults ?? {};
			for (const [id, vault] of Object.entries(listed)) {
				if (typeof vault?.path === 'string' && real(vault.path) === here) return id;
			}
		} catch {
			// No list, or one that can't be read: the folder's name.
		}
	}
	return basename(here);
}

/** What the opener needs of a started process (Node's `ChildProcess` has it); tests pass a fake. */
export interface OpenerChild {
	once(event: 'error', listener: (e: Error) => void): unknown;
	once(event: 'spawn', listener: () => void): unknown;
	once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
	unref(): void;
}

export type Spawner = (command: string, args: readonly string[], options: SpawnOptions) => OpenerChild;

/** How long to wait for the system's opener to say whether it could open the link. */
export const OPENER_WAIT_MS = 3000;

/**
 * Asks the system to open a link: `open` on macOS, `xdg-open` on Linux and others, `start` through `cmd` on Windows
 * (the link quoted as one argument; not yet tried on Windows). The opener's exit code says whether anything handles
 * `obsidian://` links: a non-zero code (or one that couldn't start) fails; one still running after a few seconds is
 * taken as opening it.
 */
export function systemOpener(platform: string = process.platform, spawner: Spawner = spawn, waitMs: number = OPENER_WAIT_MS): Opener {
	return (url) =>
		new Promise((resolve, reject) => {
			const child =
				platform === 'darwin'
					? spawner('open', [url], { stdio: 'ignore', detached: true })
					: platform === 'win32'
						? spawner('cmd', ['/d', '/s', '/c', `start "" "${url}"`], { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: true })
						: spawner('xdg-open', [url], { stdio: 'ignore', detached: true });
			let timer: ReturnType<typeof setTimeout> | null = null;
			let settled = false;
			const settle = (error: Error | null) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				child.unref();
				if (error) reject(error);
				else resolve();
			};
			child.once('error', (e) => settle(e));
			child.once('spawn', () => {
				timer = setTimeout(() => settle(null), waitMs);
			});
			child.once('exit', (code, signal) => settle(code === 0 ? null : new Error(`The opener ended with ${code ?? signal}`)));
		});
}
