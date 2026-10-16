// Quick add text as other tools pass it: parsed against the vault, with a warning for every name that matched nothing.

import { parseQuickAdd, type QuickAddContext, type QuickAddResult } from '../services/quickAddParser';
import { STRINGS } from '../strings';
import type { Snapshot, Warning } from './types';
import { vaultView } from './vaultView';

/** What quick add's tokens can name in this vault. */
export function quickAddContext(s: Snapshot): QuickAddContext {
	const view = vaultView(s);
	return {
		now: s.now,
		types: s.settings.types.map((t) => ({ id: t.id, names: [t.label, t.id] })),
		// The Inbox first among equal matches, as in the dialog.
		matters: view.matters.map((m) => ({ path: m.path, names: [m.name], rank: m.isInbox ? 0 : 1 })),
		people: view.people,
		languages: s.settings.dateLanguages,
		timeZone: s.timeZone,
	};
}

export function parseText(text: string, s: Snapshot): QuickAddResult {
	return parseQuickAdd(text, quickAddContext(s));
}

/** Which parts of the text are overridden by fields given separately (their tokens then don't matter). */
export interface Overrides {
	type: boolean;
	matter: boolean;
	people: boolean;
}

/**
 * Warnings for tokens that matched nothing (the fallback when nothing else set the value, otherwise "left out") and for
 * dates that weren't read.
 * `defaultType` is the default type's label; `added` says whether the Action was added or only parsed.
 */
export function tokenWarnings(result: QuickAddResult, overrides: Overrides, defaultType: string, added = true): Warning[] {
	const T = STRINGS.ops;
	const out: Warning[] = [];
	for (const chip of result.chips) {
		if (chip.kind === 'type' && chip.id === null && !overrides.type) {
			out.push({ code: 'unmatched-type', field: 'text', value: chip.query, message: result.typeId ? T.leftOut(chip.query, added) : T.noType(chip.query, defaultType) });
		} else if (chip.kind === 'matter' && chip.path === null && !overrides.matter) {
			out.push({ code: 'unmatched-matter', field: 'text', value: chip.query, message: result.matterPath ? T.leftOut(chip.query, added) : T.noMatter(chip.query, added) });
		} else if (chip.kind === 'person' && chip.path === null && !overrides.people) {
			out.push({ code: 'unmatched-person', field: 'text', value: chip.query, message: T.noPerson(chip.query, added) });
		} else if (chip.kind === 'invalid-date') {
			out.push({ code: 'unreadable-date', field: 'text', value: chip.text, message: T.unreadDate(chip.text, chip.problem === 'time-zone', added) });
		}
	}
	return out;
}
