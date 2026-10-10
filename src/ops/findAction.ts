// Naming an Action: its path (`.md` optional) or its title, as a wikilink would resolve it or as quick add matches
// names. Several matches are an error that lists them: without an exact path, title or link, every strong fuzzy match
// counts, not only the best, so a write never lands on a guess.

import { matchNote } from '../services/match';
import { STRINGS } from '../strings';
import { done, fail, type Read } from './fields';
import type { Snapshot } from './types';
import { vaultView, type ActionNote } from './vaultView';

export function findAction(ref: string, s: Snapshot): Read<ActionNote> {
	const actions = vaultView(s).actions;
	const m = matchNote(
		ref,
		actions.map((a) => ({ path: a.note.path, name: a.note.basename, action: a })),
		(t) => s.resolve(t, ''),
		{ anyStrong: true },
	);
	if (m.kind === 'match') return done(m.item.action);
	if (m.kind === 'ambiguous') {
		return fail({ code: 'ambiguous', field: 'action', value: ref, message: STRINGS.ops.severalActions(ref), candidates: m.items.map((i) => i.path).sort() });
	}
	return fail({ code: 'not-found', field: 'action', value: ref, message: STRINGS.ops.actionNotFound(ref) });
}
