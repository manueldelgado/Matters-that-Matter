// List Matters: every lane in board order (the Inbox at its default place, then by Sphere and lane order), with
// state, Sphere, outcome, review and counts.

import { orderMatters } from '../services/boardModel';
import { readiness } from './fields';
import { emptyPlan } from './plan';
import { matterSummary } from './summaries';
import type { MatterSummary, OpResult, Snapshot } from './types';
import { vaultView } from './vaultView';

export function listMatters(s: Snapshot): OpResult<MatterSummary[]> {
	const ready = readiness(s, false);
	if (ready.error) return { ok: false, error: ready.error };
	const view = vaultView(s);
	const items = view.actions.map((a) => a.item);
	const value = orderMatters(view.matters, s.settings.spheres, s.settings.defaultInboxPosition).map((m) => matterSummary(m, items, s));
	return { ok: true, value, plan: emptyPlan(), changes: [], warnings: ready.warnings };
}
