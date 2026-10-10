// List Actions, filtered by Matter, status, type, Sphere, person, due range and waiting. Closed Actions are left out
// unless asked for (or the status asked for is closed). Order as the list view: Matters in board order, then status
// in workflow order, then card order. Names that match nothing are an error.

import { compareCards } from '../model/actions';
import { orderMatters } from '../services/boardModel';
import { peoplePaths } from '../services/notesModel';
import { STRINGS } from '../strings';
import { fail, findMatter, findPerson, findSphere, findStatus, findType, readDate, readiness } from './fields';
import { publicField } from './fieldNames';
import { emptyPlan } from './plan';
import { actionSummary } from './summaries';
import type { ActionSummary, ListActionsInput, OpResult, Snapshot } from './types';
import { vaultView, type ActionNote } from './vaultView';

type Filter = (a: ActionNote) => boolean;

export function listActions(input: ListActionsInput, s: Snapshot): OpResult<ActionSummary[]> {
	const ready = readiness(s, false);
	if (ready.error) return { ok: false, error: ready.error };
	const view = vaultView(s);
	const filters: Filter[] = [];
	let includeClosed = input.done === true;

	if (input.matter !== undefined) {
		const r = findMatter(input.matter, s);
		if (!r.ok) return r;
		filters.push((a) => a.item.effective.matterPath === r.value.path);
	}
	if (input.status !== undefined) {
		const r = findStatus(input.status, s);
		if (!r.ok) return r;
		if (r.value.category === 'closed') includeClosed = true;
		filters.push((a) => a.item.effective.status.id === r.value.id);
	}
	if (input.type !== undefined) {
		const r = findType(input.type, s);
		if (!r.ok) return r;
		filters.push((a) => a.item.effective.type.id === r.value.id);
	}
	if (input.sphere !== undefined) {
		const r = findSphere(input.sphere, s);
		if (!r.ok) return r;
		const inSphere = new Set(view.matters.filter((m) => m.sphere === r.value.id).map((m) => m.path));
		filters.push((a) => inSphere.has(a.item.effective.matterPath));
	}
	if (input.person !== undefined) {
		const r = findPerson('person', input.person, s);
		if (!r.ok) return r;
		filters.push((a) =>
			peoplePaths(a.note.frontmatter ?? {}, (t) => {
				const target = s.resolve(t, a.note.path);
				return target ? { path: target } : null;
			}).has(r.value.path),
		);
	}
	for (const [field, value, keep] of [
		['dueFrom', input.dueFrom, (due: string, day: string) => due >= day],
		['dueTo', input.dueTo, (due: string, day: string) => due <= day],
	] as const) {
		if (value === undefined) continue;
		const r = readDate(field, value, s);
		if (!r.ok) return r;
		if (r.value === null) return fail({ code: 'invalid', field: publicField(field), value, message: STRINGS.ops.badDate(value) });
		const day = r.value.slice(0, 10);
		filters.push((a) => !!a.item.due && keep(a.item.due.date, day));
	}
	if (input.waiting) filters.push((a) => a.item.waitingOn !== null);
	if (!includeClosed) filters.push((a) => a.item.category !== 'closed');

	const matterRank = new Map(orderMatters(view.matters, s.settings.spheres, s.settings.defaultInboxPosition).map((m, i) => [m.path, i]));
	const statusRank = new Map(s.settings.statuses.map((st, i) => [st.id, i]));
	const rank = (a: ActionNote) => [matterRank.get(a.item.effective.matterPath) ?? Infinity, statusRank.get(a.item.effective.status.id) ?? Infinity] as const;
	const value = view.actions
		.filter((a) => filters.every((f) => f(a)))
		.sort((a, b) => {
			const [ma, sa] = rank(a);
			const [mb, sb] = rank(b);
			return ma - mb || sa - sb || compareCards(a.item, b.item);
		})
		.map((a) => actionSummary(a.item, a.note.frontmatter, s));
	return { ok: true, value, plan: emptyPlan(), changes: [], warnings: ready.warnings };
}
