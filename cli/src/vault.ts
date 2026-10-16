// Finding the vault and the plugin's settings in it. A folder without an Obsidian configuration folder, or without the
// plugin's settings, isn't ready: nothing is read from it and nothing is written to it. Without --config-dir the
// configuration folder is found by itself: .obsidian when it holds the plugin's settings, else the one dot-folder in
// the vault's root that does; several are refused rather than guessed between (each device can have its own). Settings go through the
// plugin's own migrations, as the plugin reads them; settings from a newer version are read as they are (the
// operations then warn on reads and refuse writes).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { migrateSettings } from '../../src/services/migrations';
import type { MattersSettings } from '../../src/settings';
import { CLI } from './strings';

/** Obsidian's default configuration folder; `--config-dir` names another. */
export const DEFAULT_CONFIG_DIR = '.obsidian';
export const PLUGIN_ID = 'matters-that-matter';

export interface Vault {
	/** The vault's folder, absolute. */
	root: string;
	configDir: string;
	settings: MattersSettings;
	/** A SHA-256 of the settings file as read, so a write can tell they changed since. */
	settingsVersion?: string;
}

export type VaultResult = { ok: true; vault: Vault } | { ok: false; message: string };

const isDir = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const real = (path: string): string | null => {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
};

/**
 * A note named by its full path (from tab completion, `find` or `ls`) as a path in the vault, when it lies inside
 * it; anything else as it was given.
 */
export function inVault(ref: string, root: string): string {
	if (!isAbsolute(ref)) return ref;
	const roots = [root, real(root)].filter((r): r is string => r !== null);
	const refs = [resolve(ref), real(ref)].filter((r): r is string => r !== null);
	for (const base of roots) {
		for (const full of refs) {
			const rel = relative(base, full);
			if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return rel.split(sep).join('/');
		}
	}
	return ref;
}

/** `~/Notes` → the home folder's Notes; relative paths from `cwd`. */
export function vaultPath(given: string, cwd: string, home: string): string {
	const expanded = given === '~' ? home : given.startsWith('~/') ? join(home, given.slice(2)) : given;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

/** The settings file of the plugin, relative to the configuration folder. */
const SETTINGS_IN_CONFIG = `plugins/${PLUGIN_ID}/data.json`;
/** The settings file of the plugin in a vault, relative to the vault. */
export const settingsPath = (configDir: string) => `${configDir}/${SETTINGS_IN_CONFIG}`;

/** Dot-folders in the vault's root that are never a configuration folder. */
const NOT_CONFIG = new Set(['.trash', '.git']);
/** What only an Obsidian configuration folder holds (one of them is enough). */
const CONFIG_SIGNS = ['app.json', 'appearance.json', 'core-plugins.json', 'workspace.json'];

/** One dot-folder in the vault's root, as far as finding the configuration folder goes. */
export interface DotFolder {
	name: string;
	/** It holds `plugins/matters-that-matter/data.json`. */
	hasSettings: boolean;
	/** It holds one of Obsidian's own settings files or a `plugins` folder. */
	looksLikeConfig: boolean;
}

export type ConfigDirChoice =
	| { ok: true; configDir: string }
	| { ok: false; reason: 'several'; folders: string[] }
	| { ok: false; reason: 'no-settings'; folders: string[] }
	| { ok: false; reason: 'not-a-vault' };

/**
 * The configuration folder to use when `--config-dir` isn't given, from the vault root's dot-folders (pure). `.obsidian`
 * with the plugin's settings first; else the one dot-folder with them; several are refused. Without any: the folder
 * the plugin's settings are missing from (`.obsidian`, else the folders that look like Obsidian's), or not a vault.
 */
export function chooseConfigDir(folders: readonly DotFolder[]): ConfigDirChoice {
	const candidates = folders.filter((f) => !NOT_CONFIG.has(f.name));
	if (candidates.some((f) => f.name === DEFAULT_CONFIG_DIR && f.hasSettings)) return { ok: true, configDir: DEFAULT_CONFIG_DIR };
	const withSettings = candidates.filter((f) => f.hasSettings).map((f) => f.name).sort();
	const [only, ...more] = withSettings;
	if (only !== undefined && !more.length) return { ok: true, configDir: only };
	if (more.length) return { ok: false, reason: 'several', folders: withSettings };
	if (candidates.some((f) => f.name === DEFAULT_CONFIG_DIR)) return { ok: false, reason: 'no-settings', folders: [DEFAULT_CONFIG_DIR] };
	const lookalikes = candidates.filter((f) => f.looksLikeConfig).map((f) => f.name).sort();
	return lookalikes.length ? { ok: false, reason: 'no-settings', folders: lookalikes } : { ok: false, reason: 'not-a-vault' };
}

/** The vault root's dot-folders and what each holds, for `chooseConfigDir`. */
function dotFolders(root: string): DotFolder[] {
	let names: string[];
	try {
		names = readdirSync(root).filter((name) => name.startsWith('.') && !NOT_CONFIG.has(name));
	} catch {
		return [];
	}
	return names
		.filter((name) => isDir(join(root, name)))
		.map((name) => {
			const dir = join(root, name);
			return {
				name,
				hasSettings: existsSync(join(root, ...settingsPath(name).split('/'))),
				looksLikeConfig: CONFIG_SIGNS.some((file) => existsSync(join(dir, file))) || isDir(join(dir, 'plugins')),
			};
		});
}

/** The configuration folder `openVault` reads, or why there's none: the flag as given, else found by itself. */
function findConfigDir(root: string, given: string, configDirFlag: string | undefined): { ok: true; configDir: string } | { ok: false; message: string } {
	const flag = configDirFlag?.trim();
	if (flag) {
		// One folder in the vault's root, as Obsidian allows.
		if (/[/\\]/.test(flag) || flag === '.' || flag === '..') return { ok: false, message: CLI.badConfigDir(flag) };
		if (!isDir(join(root, flag))) return { ok: false, message: CLI.notAVault(given, flag) };
		return { ok: true, configDir: flag };
	}
	// Most vaults: no reads beyond this one.
	if (existsSync(join(root, ...settingsPath(DEFAULT_CONFIG_DIR).split('/')))) return { ok: true, configDir: DEFAULT_CONFIG_DIR };
	const choice = chooseConfigDir(dotFolders(root));
	if (choice.ok) return choice;
	switch (choice.reason) {
		case 'several':
			return { ok: false, message: CLI.severalConfigDirs(choice.folders) };
		case 'no-settings': {
			const [only, ...more] = choice.folders;
			const message = only !== undefined && !more.length ? CLI.noSettings(given, settingsPath(only)) : CLI.noSettingsIn(given, choice.folders, SETTINGS_IN_CONFIG);
			return { ok: false, message };
		}
		case 'not-a-vault':
			return { ok: false, message: `${CLI.notAVault(given, DEFAULT_CONFIG_DIR)} ${CLI.configDirHint}` };
	}
}

export function openVault(given: string | undefined, configDirFlag: string | undefined, cwd: string, home: string): VaultResult {
	if (!given?.trim()) return { ok: false, message: CLI.noVault };
	const root = vaultPath(given.trim(), cwd, home);
	if (!isDir(root)) return { ok: false, message: CLI.noFolder(given) };
	const found = findConfigDir(root, given, configDirFlag);
	if (!found.ok) return found;
	const configDir = found.configDir;

	const loaded = loadSettings(root, configDir);
	if (loaded === 'missing') return { ok: false, message: CLI.noSettings(given, settingsPath(configDir)) };
	if (loaded === 'bad') return { ok: false, message: CLI.badSettings(settingsPath(configDir)) };
	return { ok: true, vault: { root, configDir, ...loaded } };
}

/** The plugin's settings as they are on disk now, with a SHA-256 of the file. */
function loadSettings(root: string, configDir: string): Pick<Vault, 'settings' | 'settingsVersion'> | 'missing' | 'bad' {
	let text: string;
	try {
		text = readFileSync(join(root, ...settingsPath(configDir).split('/')), 'utf8');
	} catch {
		return 'missing';
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return 'bad';
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'bad';
	return { settings: migrateSettings(raw), settingsVersion: createHash('sha256').update(text, 'utf8').digest('hex') };
}

/** The vault with its settings read again (after they changed under a write), or why they can't be read now. */
export function withFreshSettings(vault: Vault): Vault | { message: string } {
	const loaded = loadSettings(vault.root, vault.configDir);
	if (loaded === 'missing') return { message: CLI.noSettings(vault.root, settingsPath(vault.configDir)) };
	if (loaded === 'bad') return { message: CLI.badSettings(settingsPath(vault.configDir)) };
	return { ...vault, ...loaded };
}
