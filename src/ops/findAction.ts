// Naming an Action: its `mtm-id`, its path (`.md` optional) or its title, as a wikilink would resolve it or as quick add matches
// names. Several matches are an error that lists them: without an exact path, title or link, every strong fuzzy match
// counts, not only the best, so a write never lands on a guess.

import type { MatterInfo } from '../services/boardModel';
import { matchNote, type Match } from '../services/match';
import { noteId } from '../services/notesModel';
import { STRINGS } from '../strings';
import { done, fail, type Read } from './fields';
import type { Snapshot } from './types';
import { vaultView, type ActionNote } from './vaultView';

const actionNotes = (s: Snapshot) => vaultView(s).actions.map((a) => ({ path: a.note.path, name: a.note.basename, id: noteId(a.note.frontmatter), action: a }));

export function findAction(ref: string, s: Snapshot): Read<ActionNote> {
	const m = matchNote(ref, actionNotes(s), (t) => s.resolve(t, ''), { anyStrong: true });
	if (m.kind === 'match') return done(m.item.action);
	if (m.kind === 'ambiguous') {
		return fail({ code: 'ambiguous', field: 'action', value: ref, message: STRINGS.ops.severalActions(ref), candidates: m.items.map((i) => i.path).sort() });
	}
	return fail({ code: 'not-found', field: 'action', value: ref, message: STRINGS.ops.actionNotFound(ref) });
}

/** An Action or a Matter, as `findActionOrMatter` finds it. */
export type ActionOrMatter = { kind: 'action'; action: ActionNote } | { kind: 'matter'; matter: MatterInfo };

type Named = { path: string; name: string; id: string | null; target: ActionOrMatter };

/**
 * An Action or a Matter, named by its path, its title or name, or link text. An exact match of either kind wins over
 * any fuzzy one; only when nothing matches exactly do Actions match as `findAction` does and Matters as the best
 * strong fuzzy match. Several matches, of either kind or both, are an error that lists them.
 */
export function findActionOrMatter(ref: string, s: Snapshot): Read<ActionOrMatter> {
	const resolve = (t: string) => s.resolve(t, '');
	const view = vaultView(s);
	const actions: Named[] = actionNotes(s).map((a) => ({ path: a.path, name: a.name, id: a.id, target: { kind: 'action', action: a.action } }));
	const matters: Named[] = view.matters.map((m) => ({ path: m.path, name: m.name, id: noteId(view.byPath.get(m.path)?.frontmatter), target: { kind: 'matter', matter: m } }));

	const exact = matchNote(ref, [...actions, ...matters], resolve, { exact: true });
	const found = (m: Match<Named>): Named[] => (m.kind === 'match' ? [m.item] : m.kind === 'ambiguous' ? m.items : []);
	let items = found(exact);
	if (!items.length) items = [...found(matchNote(ref, actions, resolve, { anyStrong: true })), ...found(matchNote(ref, matters, resolve))];

	const [only] = items;
	if (only && items.length === 1) return done(only.target);
	if (items.length) {
		const kinds = new Set(items.map((i) => i.target.kind));
		const message = kinds.size > 1 ? STRINGS.ops.severalActionsOrMatters(ref) : kinds.has('matter') ? STRINGS.ops.severalMatters(ref) : STRINGS.ops.severalActions(ref);
		// The field names the kind when all are of one (Matters: `matter`); mixed or Actions: `action`, as before.
		const field = kinds.size === 1 && kinds.has('matter') ? 'matter' : 'action';
		return fail({ code: 'ambiguous', field, value: ref, message, candidates: items.map((i) => i.path).sort() });
	}
	return fail({ code: 'not-found', field: 'action', value: ref, message: STRINGS.ops.actionNotFound(ref) });
}
