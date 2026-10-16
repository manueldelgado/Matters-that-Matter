// Where the command line meets the plugin's files layer (src/files): the vault read as Obsidian reads it, and a
// plan turned into file contents as Obsidian would leave them. The command line itself only reads and writes the
// bytes (apply.ts).

import { createHash, randomUUID } from 'node:crypto';
import { VaultIndex, type VaultReader } from '../../src/files/index';
import { filesSnapshot } from '../../src/files/snapshot';
import { contentsAfter as filesContentsAfter, type FileOutcome, type WriteOptions } from '../../src/files/write';
import type { Plan, Snapshot } from '../../src/ops/types';
import type { MattersSettings } from '../../src/settings';

export type { FileOutcome, FileWrite, LinkUpdate } from '../../src/files/write';
export { WriteError } from '../../src/files/write';

/**
 * The operations' snapshot of a vault on disk: its notes, links and link text, as Obsidian's cache gives them. New
 * Actions and Matters get an `mtm-id` from `newId` (a random UUID when absent; none when null). Each file's version is
 * a SHA-256 of its content as the reader saw it, so a plan records what it was computed from.
 */
export function snapshotOf(
	reader: VaultReader,
	configDir: string,
	settings: MattersSettings,
	now: Date,
	newId: (() => string) | null = randomUUID,
	settingsVersion?: string,
): Snapshot {
	const index = new VaultIndex(reader, { configDir });
	return {
		...filesSnapshot(index, settings, now),
		// With the embeds of each note, which show an Action's attachments.
		embeds: (path) => index.body(path)?.embeds.map((ref) => ref.link) ?? [],
		...(newId ? { newId } : {}),
		version: (path) => {
			let text: string | null;
			try {
				text = reader.read(path);
			} catch {
				text = null;
			}
			return text === null ? null : contentVersion(text);
		},
		...(settingsVersion !== undefined ? { settingsVersion } : {}),
	};
}

/** A file's version: a SHA-256 of its content. */
export const contentVersion = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Turns a plan into file contents, reading what it needs through `reader`: `mtm-` keys set and removed with every
 * other byte kept, new notes in the plugin's key order, body edits, renames with links rewritten when the vault's
 * "Automatically update internal links" is on. Throws a `WriteError` when the plan can't be applied.
 */
export type ContentsAfter = (plan: Plan, reader: VaultReader, options: WriteOptions) => FileOutcome;

export const contentsAfter: ContentsAfter = filesContentsAfter;
