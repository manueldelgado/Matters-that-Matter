// Mark as reviewed: today in mtm-last-reviewed, as the Matter's "Mark as reviewed" writes it, and with a note, a line
// at the end of the note as the review session writes it. The Inbox isn't reviewed. Reviewed today already and no
// note: nothing is planned.

import { cleanReviewNote } from '../model/body';
import { applyBodyEdit, PlanBuilder } from './plan';
import { fail, findMatter, readiness } from './fields';
import { matterInfoAfter, missingNote } from './matterWrite';
import { matterSummary } from './summaries';
import { STRINGS } from '../strings';
import type { BodyEdit, MarkReviewedInput, MatterWrite, OpResult, Snapshot } from './types';
import { vaultView } from './vaultView';

export function markReviewed(input: MarkReviewedInput, s: Snapshot): OpResult<MatterWrite> {
	const ready = readiness(s, true);
	if (ready.error) return { ok: false, error: ready.error };
	const found = findMatter(input.matter, s);
	if (!found.ok) return found;
	const matter = found.value;
	if (matter.isInbox) return fail({ code: 'invalid', field: 'matter', value: input.matter, message: STRINGS.ops.inboxNotReviewed });
	const view = vaultView(s);
	const note = view.byPath.get(matter.path);
	if (!note) return missingNote(matter.path, input.matter);

	const before = note.frontmatter ?? {};
	const after: Record<string, unknown> = { ...before, 'mtm-last-reviewed': view.today };
	const builder = new PlanBuilder(s);
	builder.edit(matter.path, before, after);
	let content = s.content(matter.path) ?? '';
	const text = input.note === undefined ? '' : cleanReviewNote(input.note);
	if (text) {
		const edit: BodyEdit = { kind: 'review-note', date: view.today, text };
		builder.body(matter.path, content, edit);
		builder.ensureId(matter.path, after);
		content = applyBodyEdit(content, edit);
	}
	const value = matterSummary(matterInfoAfter(matter, after, s), view.actionsByMatter.get(matter.path) ?? [], s, after, content);
	return { ok: true, value: { matter: value, changed: builder.changes.length > 0 }, plan: builder.plan, changes: builder.changes, warnings: ready.warnings };
}
