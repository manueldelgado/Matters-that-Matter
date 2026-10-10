// Where the command line meets the plugin's files layer (src/files): the vault read as Obsidian reads it, and a
// plan turned into file contents. The command line itself only reads and writes the bytes.

import { VaultIndex, type VaultReader } from '../../src/files/index';
import { filesSnapshot } from '../../src/files/snapshot';
import type { Plan, Snapshot } from '../../src/ops/types';
import type { MattersSettings } from '../../src/settings';

/** The operations' snapshot of a vault on disk: its notes, links and link text, as Obsidian's cache gives them. */
export function snapshotOf(reader: VaultReader, configDir: string, settings: MattersSettings, now: Date): Snapshot {
	return filesSnapshot(new VaultIndex(reader, { configDir }), settings, now);
}

/** One file a plan writes. */
export interface FileWrite {
	/** Where the file goes. */
	path: string;
	/** Where it is now: the same path, the old path of a renamed note, or null for a new file. */
	from: string | null;
	/** Its content when the plan was made (null for a new file); the write is refused if the file differs by then. */
	before: string | null;
	/** Its whole new content. */
	after: string;
}

/** Links a rename rewrote in a note: the note's path (after the plan) and the lines (1-based). */
export interface LinkUpdate {
	path: string;
	lines: number[];
}

/** Everything a plan does to the files. */
export interface FileOutcome {
	files: FileWrite[];
	/** Links to a renamed note that were rewritten (Obsidian's "Automatically update internal links" on). */
	links: LinkUpdate[];
	/** Links left pointing to a renamed note's old name (that setting off). */
	danglingLinks: number;
}

/** Turns a plan into file contents, reading what it needs through `reader`. */
export type ContentsAfter = (plan: Plan, reader: VaultReader, options: { configDir: string }) => FileOutcome;

/**
 * The plan applier. It comes from the files layer's writing code (setting `mtm-` keys while keeping everything else,
 * new notes in the plugin's key order, body edits, renames with link rewriting); until that is wired in, this
 * build of the command line plans and shows changes (`--dry-run`) but doesn't write.
 */
export const contentsAfter: ContentsAfter | null = null;
