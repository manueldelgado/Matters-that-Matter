// What the list shows: the board's lanes as groups, rows in column order. Pure.

import type { ActionItem } from './actionItems';
import type { BoardLane, BoardModel } from './boardModel';

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
