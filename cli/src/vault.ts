// Finding the vault and Matters' settings in it. A folder without an Obsidian configuration folder, or without the
// plugin's settings, isn't ready: nothing is read from it and nothing is written to it. Settings go through the
// plugin's own migrations, as the plugin reads them; settings from a newer version are read as they are (the
// operations then warn on reads and refuse writes).

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
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
}

export type VaultResult = { ok: true; vault: Vault } | { ok: false; message: string };

const isDir = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

/** `~/Notes` → the home folder's Notes; relative paths from `cwd`. */
export function vaultPath(given: string, cwd: string, home: string): string {
	const expanded = given === '~' ? home : given.startsWith('~/') ? join(home, given.slice(2)) : given;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

/** The settings file of the plugin in a vault, relative to the vault. */
export const settingsPath = (configDir: string) => `${configDir}/plugins/${PLUGIN_ID}/data.json`;

export function openVault(given: string | undefined, configDirFlag: string | undefined, cwd: string, home: string): VaultResult {
	if (!given?.trim()) return { ok: false, message: CLI.noVault };
	const root = vaultPath(given.trim(), cwd, home);
	if (!isDir(root)) return { ok: false, message: CLI.noFolder(given) };
	const configDir = configDirFlag?.trim() || DEFAULT_CONFIG_DIR;
	// One folder in the vault's root, as Obsidian allows.
	if (/[/\\]/.test(configDir) || configDir === '.' || configDir === '..') return { ok: false, message: CLI.badConfigDir(configDir) };
	if (!isDir(join(root, configDir))) return { ok: false, message: CLI.notAVault(given, configDir) };

	let text: string;
	try {
		text = readFileSync(join(root, ...settingsPath(configDir).split('/')), 'utf8');
	} catch {
		return { ok: false, message: CLI.noSettings(given, settingsPath(configDir)) };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, message: CLI.badSettings(settingsPath(configDir)) };
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: CLI.badSettings(settingsPath(configDir)) };
	return { ok: true, vault: { root, configDir, settings: migrateSettings(raw) } };
}
