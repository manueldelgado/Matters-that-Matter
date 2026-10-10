// The workflow: statuses, types and Spheres with their IDs, labels, categories and flags. Read only.

import { readiness } from './fields';
import { emptyPlan } from './plan';
import type { OpResult, Snapshot, WorkflowValue } from './types';

export function getWorkflow(s: Snapshot): OpResult<WorkflowValue> {
	const ready = readiness(s, false);
	if (ready.error) return { ok: false, error: ready.error };
	const { statuses, types, spheres } = s.settings;
	const value: WorkflowValue = {
		statuses: statuses.map((x) => ({ id: x.id, label: x.label, category: x.category, tone: x.tone, backlog: !!x.backlog, done: !!x.done })),
		types: types.map((x) => ({ id: x.id, label: x.label, icon: x.icon, tone: x.tone, default: !!x.default })),
		spheres: spheres.map((x) => ({ id: x.id, label: x.label, icon: x.icon })),
	};
	return { ok: true, value, plan: emptyPlan(), changes: [], warnings: ready.warnings };
}
