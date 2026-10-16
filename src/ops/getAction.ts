// Get one Action: raw and effective values, orphan badges, details, checklist, people and the names of linked notes
// and attachments (never their content).

import { checklistItems, getDetails } from '../model/body';
import { startsAfterDue } from '../model/dates';
import { peopleList } from '../services/actionEdit';
import { attachments, linkedNotes, peoplePaths } from '../services/notesModel';
import { readiness } from './fields';
import { findAction } from './findAction';
import { emptyPlan } from './plan';
import { actionSummary, noteRef } from './summaries';
import type { ActionDetail, NoteRef, OpResult, Snapshot } from './types';
import { baseName, targetOf } from './vaultView';

export function getAction(action: string, s: Snapshot): OpResult<ActionDetail> {
	const ready = readiness(s, false);
	if (ready.error) return { ok: false, error: ready.error };
	const found = findAction(action, s);
	if (!found.ok) return found;
	const { note, item } = found.value;
	const path = note.path;
	const fm = note.frontmatter ?? {};
	const content = s.content(path) ?? '';

	const exclude = peoplePaths(fm, (t) => {
		const target = s.resolve(t, path);
		return target ? { path: target } : null;
	});
	exclude.add(item.effective.matterPath);
	const linked = linkedNotes(s.links(path), path, (t) => targetOf(s.resolve(t, path)), exclude);
	const embedded = attachments(s.embeds?.(path) ?? [], (t) => targetOf(s.resolve(t, path)));

	const value: ActionDetail = {
		...actionSummary(item, fm, s),
		details: getDetails(content),
		checklist: checklistItems(content).map(({ text, checked }) => ({ text, checked })),
		linkedNotes: linked.map((t) => ({ path: t.path, name: baseName(t.path) })),
		attachments: embedded.map((t) => ({ path: t.path, name: t.path.split('/').pop() ?? t.path })),
		people: peopleList(fm['mtm-people'])
			.map((raw) => noteRef(raw, path, s))
			.filter((p): p is NoteRef => p !== null),
		startsAfterDue: startsAfterDue(item.start, item.due),
	};
	return { ok: true, value, plan: emptyPlan(), changes: [], warnings: ready.warnings };
}
