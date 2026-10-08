// What the list shows: the board's lanes as groups, rows in column order. Pure.

import type { SphereDef } from '../settings';
import type { ActionItem } from './actionItems';
import type { BoardLane, BoardModel } from './boardModel';
import type { SphereCounts } from './spheres';

export interface ListGroup {
	lane: BoardLane;
	/** By status in workflow order, then in card order. */
	rows: ActionItem[];
}

/** Groups without rows are left out (the list never shows empty Matters). */
export function buildList(board: BoardModel): ListGroup[] {
	return board.lanes
		.map((lane) => ({ lane, rows: board.columns.flatMap((c) => lane.cells.get(c.id) ?? []) }))
		.filter((g) => g.rows.length > 0);
}

export interface ListSection {
	/** Null for "No Sphere". */
	sphere: SphereDef | null;
	counts: SphereCounts;
	collapsed: boolean;
	groups: ListGroup[];
}

export interface ListLayout {
	/** The Inbox group, shown before or after the sections; null when hidden or empty. */
	inbox: ListGroup | null;
	inboxFirst: boolean;
	/** Sphere sections, or null when there are no Spheres (then `groups` is the whole list). */
	sections: ListSection[] | null;
	groups: ListGroup[];
}

/** The list in Sphere sections, from the board's bands; sections whose Matters have no rows are left out. */
export function buildListLayout(board: BoardModel): ListLayout {
	const groups = buildList(board);
	if (!board.bands) return { inbox: null, inboxFirst: true, sections: null, groups };
	const inbox = groups.find((g) => g.lane.matter.isInbox) ?? null;
	const byPath = new Map(groups.map((g) => [g.lane.matter.path, g]));
	const sections = board.bands
		.map((band) => ({
			sphere: band.sphere,
			counts: band.counts,
			collapsed: band.collapsed,
			groups: band.lanes.map((l) => byPath.get(l.matter.path)).filter((g): g is ListGroup => !!g),
		}))
		.filter((s) => s.groups.length > 0);
	return { inbox, inboxFirst: board.lanes[0]?.matter.isInbox ?? true, sections, groups };
}
