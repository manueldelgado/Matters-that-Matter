// Today: what the new tab's "What matters today?" shows (due today or late, else next up; Inbox, reviews and waits).

import { todayModel } from '../services/todayModel';
import { readiness } from './fields';
import { emptyPlan } from './plan';
import { actionSummary, matterSummary } from './summaries';
import type { OpResult, Snapshot, TodayValue } from './types';
import { vaultView } from './vaultView';

export function today(s: Snapshot): OpResult<TodayValue> {
	const ready = readiness(s, false);
	if (ready.error) return { ok: false, error: ready.error };
	const view = vaultView(s);
	const items = view.actions.map((a) => a.item);
	const fmOf = new Map(view.actions.map((a) => [a.note.path, a.note.frontmatter]));
	const model = todayModel({ items, matters: view.matters, statuses: s.settings.statuses, inboxPath: s.settings.inboxPath, now: s.now });
	const summary = (i: (typeof items)[number]) => actionSummary(i, fmOf.get(i.path), s);
	const value: TodayValue = {
		date: view.today,
		due: model.due.map(summary),
		dueToday: model.dueToday,
		late: model.late,
		nextStatus: model.nextStatus && { id: model.nextStatus.id, label: model.nextStatus.label },
		next: model.next.map(summary),
		inbox: model.inbox,
		reviews: model.reviews.map((m) => matterSummary(m, items, s)),
		waiting: model.waiting.map(summary),
		longWaits: model.longWaits,
	};
	return { ok: true, value, plan: emptyPlan(), changes: [], warnings: ready.warnings };
}
