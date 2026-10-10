// The phone swipe board: the Matter pills, which Matter shows, and the column it opens on. Pure.

import type { SphereDef, StatusDef } from '../settings';
import { isToday } from '../model/actions';
import type { BoardLane, BoardModel } from './boardModel';

export type PillSignal = { kind: 'count'; n: number } | { kind: 'review' } | null;

export interface SwipePill {
	lane: BoardLane;
	/** Set on the first pill of a Sphere group: the Sphere, or null for "No Sphere". Undefined otherwise. */
	group?: SphereDef | null;
	/** Actions due today or late, else a review due; never a colour for the Matter. */
	signal: PillSignal;
	/** Dormant and closed Matters: dimmed, last in their group. */
	dim: boolean;
}

/** Active Matters first, then dormant, then closed; otherwise in board order. */
function activeFirst(lanes: readonly BoardLane[]): BoardLane[] {
	const rank = (l: BoardLane) => (l.matter.state === 'active' ? 0 : l.matter.state === 'dormant' ? 1 : 2);
	return lanes.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l);
}

export function pillSignal(lane: BoardLane, now: Date): PillSignal {
	let due = 0;
	for (const list of lane.cells.values()) for (const a of list) if (isToday(a.due, a.category, now)) due++;
	if (due) return { kind: 'count', n: due };
	const m = lane.matter;
	if (!m.isInbox && m.state !== 'closed' && m.review?.due) return { kind: 'review' };
	return null;
}

/** The pills in board order: the Inbox at its position; with Spheres, each Sphere's group, active Matters first. */
export function swipePills(model: BoardModel, now: Date): SwipePill[] {
	const pill = (lane: BoardLane, group?: SphereDef | null): SwipePill => ({
		lane,
		...(group !== undefined ? { group } : {}),
		signal: pillSignal(lane, now),
		dim: lane.matter.state !== 'active',
	});
	const inbox = model.lanes.find((l) => l.matter.isInbox);
	const inboxFirst = !!inbox && model.lanes[0] === inbox;

	const middle: SwipePill[] = [];
	if (model.bands) {
		for (const band of model.bands) {
			activeFirst(band.lanes).forEach((lane, i) => middle.push(pill(lane, i === 0 ? band.sphere : undefined)));
		}
	} else {
		for (const lane of activeFirst(model.lanes.filter((l) => !l.matter.isInbox))) middle.push(pill(lane));
	}
	if (!inbox) return middle;
	return inboxFirst ? [pill(inbox), ...middle] : [...middle, pill(inbox)];
}

/** The Matter to show: the one remembered if it still has a pill, else the first with open Actions, else the first. */
export function chosenPill(pills: readonly SwipePill[], remembered: string | null): SwipePill | null {
	return pills.find((p) => p.lane.matter.path === remembered) ?? pills.find((p) => p.lane.openCount > 0) ?? pills[0] ?? null;
}

/**
 * The column a Matter opens on: the ghost's column when it has no next Action; else the first column after the backlog
 * that has cards; else the first column with cards; else the next-step column, or the first.
 */
export function openingColumn(lane: BoardLane, columns: readonly StatusDef[], nextStepId: string | null): string | null {
	const ids = columns.map((c) => c.id);
	if (lane.noNextAction && nextStepId && ids.includes(nextStepId)) return nextStepId;
	const has = (id: string) => (lane.cells.get(id)?.length ?? 0) > 0;
	const backlog = columns.findIndex((c) => c.backlog);
	const after = ids.slice(backlog + 1).find(has);
	if (after) return after;
	return ids.find(has) ?? (nextStepId && ids.includes(nextStepId) ? nextStepId : (ids[0] ?? null));
}
