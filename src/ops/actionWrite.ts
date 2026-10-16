// What every write to an existing Action shares: status, type and Matter written explicitly, the completion date
// following the status, and the hand-made position dropped when the Action changes cell.

import type { StatusCategory, StatusDef } from '../settings';
import { toActionItem } from '../services/actionItems';
import { applyStatus } from '../services/completion';
import { matterLink } from '../services/notesModel';
import { STRINGS } from '../strings';
import { readiness } from './fields';
import { findAction } from './findAction';
import { PlanBuilder } from './plan';
import { actionSummary } from './summaries';
import type { ActionSummary, ActionWrite, OpResult, Snapshot } from './types';
import { vaultView } from './vaultView';

/** The keys every write to an Action names, even unchanged, so a write also clears orphan badges. */
export const EXPLICIT_KEYS = ['mtm-status', 'mtm-type', 'mtm-matter'] as const;

/** The position on boards ordered by hand; it belongs to one cell. */
export const ORDER_KEY = 'mtm-order';

export interface Placement {
	status: StatusDef;
	typeId: string;
	matterPath: string;
}

/**
 * Writes status (with mtm-completed following it), type and Matter into `fm`. `from` is where the Action is now;
 * moving to another status or Matter without a position removes mtm-order.
 */
export function place(fm: Record<string, unknown>, to: Placement, from: { statusId: string; category: StatusCategory; matterPath: string }, actionPath: string, s: Snapshot): void {
	applyStatus(fm, to.status, from.category, vaultView(s).today);
	fm['mtm-type'] = to.typeId;
	fm['mtm-matter'] = matterLink(to.matterPath, s.exists(to.matterPath) ? s.linkText(to.matterPath, actionPath) : null);
	if (to.status.id !== from.statusId || to.matterPath !== from.matterPath) delete fm[ORDER_KEY];
}

/** The Action as it reads after a write, at its new path. */
export function summaryAfter(path: string, title: string, fm: Readonly<Record<string, unknown>>, s: Snapshot): ActionSummary {
	return actionSummary(toActionItem(path, title, fm, s.settings, vaultView(s).resolveLink(path)), fm, s);
}

/**
 * Moves an Action to a status as "Mark as done" and "Reopen" do: nothing is planned when `already` says it is
 * there already.
 */
export function moveToStatus(ref: string, s: Snapshot, target: (statuses: readonly StatusDef[]) => StatusDef | undefined, already: (category: StatusCategory, statusId: string, targetId: string) => boolean): OpResult<ActionWrite> {
	const ready = readiness(s, true);
	if (ready.error) return { ok: false, error: ready.error };
	const found = findAction(ref, s);
	if (!found.ok) return found;
	const { note, item } = found.value;
	const status = target(s.settings.statuses);
	if (!status) return { ok: false, error: { code: 'not-ready', message: STRINGS.ops.noWorkflow } };
	const before = note.frontmatter ?? {};
	const after: Record<string, unknown> = { ...before };
	const builder = new PlanBuilder(s);
	const current = item.effective;
	if (!already(current.category, current.status.id, status.id)) {
		place(after, { status, typeId: current.type.id, matterPath: current.matterPath }, { statusId: current.status.id, category: current.category, matterPath: current.matterPath }, note.path, s);
		builder.edit(note.path, before, after, EXPLICIT_KEYS);
	}
	const changed = builder.changes.length > 0;
	return { ok: true, value: { action: summaryAfter(note.path, note.basename, after, s), changed }, plan: builder.plan, changes: builder.changes, warnings: ready.warnings };
}
