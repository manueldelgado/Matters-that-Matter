// The vault's files on disk, as the files layer reads them: every file's vault path, and a file's text.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VaultReader } from '../../src/files/index';

/** Folders Obsidian never lists: the configuration folder, the vault's trash and any dot-folder. */
function skipped(name: string, relative: string, configDir: string): boolean {
	return name.startsWith('.') || relative === configDir || relative === '.trash';
}

/**
 * Lists every file under the vault (vault paths, `/`-separated) without entering the configuration folder, `.trash`
 * or dot-folders, and reads files as UTF-8 text (null when there is no such file). Reads of the configuration
 * folder still work, for `app.json`. Symbolic links (to files or folders) are skipped.
 */
export function fsVaultReader(root: string, configDir: string): VaultReader {
	return {
		list() {
			const out: string[] = [];
			const walk = (relative: string) => {
				let entries;
				try {
					entries = readdirSync(relative ? join(root, relative) : root, { withFileTypes: true });
				} catch {
					return;
				}
				for (const entry of entries) {
					const path = relative ? `${relative}/${entry.name}` : entry.name;
					if (skipped(entry.name, path, configDir)) continue;
					if (entry.isDirectory()) walk(path);
					else if (entry.isFile()) out.push(path);
				}
			};
			walk('');
			return out;
		},
		read(path) {
			try {
				return readFileSync(join(root, ...path.split('/')), 'utf8');
			} catch {
				return null;
			}
		},
	};
}

/** A reader that lists and reads each file once: later calls give the same answers. */
export function cachingReader(reader: VaultReader): VaultReader {
	const texts = new Map<string, string | null>();
	let files: string[] | null = null;
	return {
		list: () => (files ??= [...reader.list()]),
		read(path) {
			if (!texts.has(path)) texts.set(path, reader.read(path));
			return texts.get(path) ?? null;
		},
	};
}
