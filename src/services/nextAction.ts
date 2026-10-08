// "No next Action": an active Matter with nothing in motion. Logic uses the backlog flag and categories, never status IDs. Pure.

import type { StatusDef } from '../settings';
import type { MatterState } from '../model/matters';
import type { ActionItem } from './actionItems';

type Moving = Pick<ActionItem, 'category' | 'waitingOn'> & { effective: { status: Pick<StatusDef, 'backlog'> } };

/** In motion: not closed, and either out of the backlog status or waiting on someone. */
export function isMoving(a: Moving): boolean {
	return a.category !== 'closed' && (!a.effective.status.backlog || a.waitingOn !== null);
}

/** An active Matter, not the Inbox, without any Action in motion. Dormant and closed Matters never lack one. */
export function lacksNextAction(matter: { isInbox: boolean; state: MatterState }, actions: readonly Moving[]): boolean {
	return !matter.isInbox && matter.state === 'active' && !actions.some(isMoving);
}

/** Where the next step goes: the first open status after the backlog in workflow order, else the first active one. */
export function nextStepStatus(statuses: readonly StatusDef[]): StatusDef | null {
	return statuses.find((s) => s.category === 'open' && !s.backlog) ?? statuses.find((s) => s.category === 'active') ?? null;
}
