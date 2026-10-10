// Show on board: what the board opens or switches on to bring a Matter's lane into view,
// and when it can't without changing a choice the user made. Pure.

import type { BoardModel, BoardOptions, MatterInfo } from './boardModel';
import { NO_SPHERE } from './spheres';

/** How long a reveal waits for its board to render before it is dropped. */
export const REVEAL_WAIT_MS = 10_000;

export type RevealStep =
	/** Turn this Sphere chip on (NO_SPHERE for "No Sphere"). */
	| { kind: 'sphere-on'; key: string }
	/** Expand this Sphere band (NO_SPHERE for "No Sphere"). */
	| { kind: 'expand-band'; key: string }
	/** Expand the Matter's lane. */
	| { kind: 'expand-lane'; path: string };

export type RevealBlock =
	/** No Actions on this board, and the board hides empty lanes. */
	| 'hidden-empty'
	/** The Inbox, on a board that hides it. */
	| 'inbox-hidden'
	/** Not a Matter the board knows. */
	| 'missing';

export type RevealPlan = { steps: RevealStep[]; blocked: null } | { steps: []; blocked: RevealBlock };

/**
 * What to change so a Matter's lane shows: its Sphere chip on, its band expanded, its lane expanded, in that order.
 * `model` is the board built with every Sphere chip on (an empty `spheresOff`), so a lane hidden only by its chip
 * still tells whether it has cards; `options` are the board's own, chips included. Never changes "Hide empty lanes"
 * or the Inbox position: those block the reveal instead.
 */
export function revealPlan(model: BoardModel, options: BoardOptions, matterPath: string, matters: readonly MatterInfo[]): RevealPlan {
	const matter = matters.find((m) => m.path === matterPath);
	if (!matter) return { steps: [], blocked: 'missing' };
	if (matter.isInbox && options.inboxPosition === 'hidden') return { steps: [], blocked: 'inbox-hidden' };
	const lane = model.lanes.find((l) => l.matter.path === matterPath);
	if (!lane) return { steps: [], blocked: options.hideEmptyLanes ? 'hidden-empty' : 'missing' };

	const steps: RevealStep[] = [];
	// The Inbox sits outside the bands and always shows, whatever the chips say.
	if (!matter.isInbox && model.sphereKeys.length) {
		const key = matter.sphere ?? NO_SPHERE;
		if (options.spheresOff.has(key)) steps.push({ kind: 'sphere-on', key });
		const band = model.bands?.find((b) => (b.sphere?.id ?? NO_SPHERE) === key);
		if (band?.collapsed) steps.push({ kind: 'expand-band', key });
	}
	if (lane.collapsed) steps.push({ kind: 'expand-lane', path: matterPath });
	return { steps, blocked: null };
}

export interface PendingReveal {
	matterPath: string;
	boardPath: string;
	/** Epoch milliseconds after which the reveal is dropped. */
	expires: number;
}

/** What a board view rendering `boardPath` does with the pending reveal: take it, drop it (expired) or leave it. */
export function pendingRevealFor(pending: PendingReveal | null, boardPath: string, now: number): 'take' | 'drop' | 'keep' {
	if (!pending) return 'keep';
	if (now > pending.expires) return 'drop';
	return pending.boardPath === boardPath ? 'take' : 'keep';
}
