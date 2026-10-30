// What the writes to a Matter share: the Matter as it reads after the write, and the Inbox that isn't there.

import type { MatterInfo } from '../services/boardModel';
import { matterInfo } from '../services/notesModel';
import { STRINGS } from '../strings';
import { fail } from './fields';
import type { OpError, Snapshot } from './types';
import { vaultView } from './vaultView';

/** The Matter as it reads with `frontmatter`, the properties a write leaves it with. */
export function matterInfoAfter(matter: MatterInfo, frontmatter: Record<string, unknown>, s: Snapshot): MatterInfo {
	return matterInfo({ path: matter.path, basename: matter.name, frontmatter }, s.settings, vaultView(s).today);
}

/** A Matter with no note to write to: only the Inbox, which Obsidian creates again. */
export function missingNote(path: string, value: string): { ok: false; error: OpError } {
	return fail({ code: 'not-found', field: 'matter', value, message: STRINGS.ops.missingInbox(path) });
}
