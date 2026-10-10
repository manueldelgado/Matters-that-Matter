// Where the command line meets the plugin's files layer (src/files): the vault read as Obsidian reads it, and a
// plan turned into file contents as Obsidian would leave them. The command line itself only reads and writes the
// bytes (apply.ts).

import { VaultIndex, type VaultReader } from '../../src/files/index';
import { filesSnapshot } from '../../src/files/snapshot';
import { contentsAfter as filesContentsAfter, type FileOutcome, type WriteOptions } from '../../src/files/write';
import type { Plan, Snapshot } from '../../src/ops/types';
import type { MattersSettings } from '../../src/settings';

export type { FileOutcome, FileWrite, LinkUpdate } from '../../src/files/write';
export { WriteError } from '../../src/files/write';

/** The operations' snapshot of a vault on disk: its notes, links and link text, as Obsidian's cache gives them. */
export function snapshotOf(reader: VaultReader, configDir: string, settings: MattersSettings, now: Date): Snapshot {
	return filesSnapshot(new VaultIndex(reader, { configDir }), settings, now);
}

/**
 * Turns a plan into file contents, reading what it needs through `reader`: `mtm-` keys set and removed with every
 * other byte kept, new notes in the plugin's key order, body edits, renames with links rewritten when the vault's
 * "Automatically update internal links" is on. Throws a `WriteError` when the plan can't be applied.
 */
export type ContentsAfter = (plan: Plan, reader: VaultReader, options: WriteOptions) => FileOutcome;

export const contentsAfter: ContentsAfter = filesContentsAfter;
