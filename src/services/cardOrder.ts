// Cards in your own order: what a drop or a menu move writes to mtm-order, and when a move clears it. Pure.
//
// Numbers are whole and positive: a cell is numbered 10, 20, 30…, a later drop takes the whole number halfway
// between its neighbours, and when there is none (neighbours one apart) the cell is numbered again. Whole numbers
// read well in the note and in Obsidian's Properties, and never drift like fractions.
//
// Hidden cards (switched off by a type chip, outside "Show done from the last N days", or outside the board's
// filter) belong to the cell all the same: one number per Action, whichever board shows it.
// - Numbered hidden cards keep their place relative to the shown ones and are renumbered with them when needed.
// - Unnumbered hidden cards are left alone: they sort after every numbered card anyway, so they never jump in front.
// A drop lands right before the shown card it was dropped on (after the last shown card at the end).

import { compareCardsByHand, type CardKey } from '../model/actions';

/** The gap between numbered cards. */
export const ORDER_STEP = 10;

export interface CellCard extends CardKey {
	path: string;
	/** False for a card this board doesn't show (absent means shown). */
	shown?: boolean;
}

export interface OrderWrite {
	path: string;
	order: number;
}

const isShown = (c: CellCard) => c.shown !== false;
const orderOf = (c: CellCard) => c.order ?? null;

/**
 * What a drop writes. `cell` is every card in the target cell (in any order; the moved card may be in it or come
 * from another cell); `index` is where it lands among the shown cards other than itself (the drop placeholder's
 * place). Only changed rows are written; a drop that changes nothing writes nothing. When the moved card comes
 * from another cell, it is always in the result: its position goes with the move.
 */
export function dropWrites(cell: readonly CellCard[], movedPath: string, index: number): OrderWrite[] {
	const sorted = [...cell].sort(compareCardsByHand);
	const inCell = sorted.find((c) => c.path === movedPath) ?? null;
	const moved: CellCard = inCell ?? { path: movedPath, title: '', priority: null, due: null, order: null };
	// Unnumbered hidden cards stay out of it.
	const counted = (c: CellCard) => isShown(c) || orderOf(c) !== null;
	const seq = sorted.filter((c) => c !== inCell && counted(c));
	const shown = seq.filter(isShown);
	const at = Math.max(0, Math.min(Math.trunc(index), shown.length));

	// Right before the shown card it was dropped on; after the last shown card at the end.
	const before = shown[at];
	const last = shown[shown.length - 1];
	const pos = before ? seq.indexOf(before) : last ? seq.indexOf(last) + 1 : seq.length;
	const next = [...seq.slice(0, pos), moved, ...seq.slice(pos)];

	if (inCell) {
		const old = sorted.filter(counted);
		if (old.every((c, i) => c === next[i])) return [];
	}

	const changed = ({ c, order }: { c: CellCard; order: number }) => orderOf(c) !== order || (c === moved && !inCell);
	const toWrite = (list: { c: CellCard; order: number }[]) => list.filter(changed).map(({ c, order }) => ({ path: c.path, order }));

	// A shown card without a number: number the whole cell as it will be shown.
	const unnumbered = seq.some((c) => isShown(c) && orderOf(c) === null);
	const prev = next[pos - 1];
	const after = next[pos + 1];
	const target = unnumbered ? null : between(prev ? orderOf(prev) : undefined, after ? orderOf(after) : undefined);
	if (target === null) return toWrite(next.map((c, i) => ({ c, order: (i + 1) * ORDER_STEP })));
	return toWrite([{ c: moved, order: target }]);
}

/**
 * The whole number between two neighbours (undefined: no neighbour on that side), or null when there is no room.
 * At the top the lower bound is 0, so numbers stay positive.
 */
function between(prev: number | null | undefined, next: number | null | undefined): number | null {
	if (prev === null || next === null) return null;
	if (prev === undefined && next === undefined) return ORDER_STEP;
	if (next === undefined) return Math.floor(prev ?? 0) + ORDER_STEP;
	const lo = prev ?? 0;
	const mid = Math.floor((lo + next) / 2);
	return mid > lo && mid < next ? mid : null;
}

export type MoveWithin = 'top' | 'up' | 'down';

/** Moves a card to the top of its cell, or one place up or down among the shown cards; nothing when it can't move. */
export function moveWithin(cell: readonly CellCard[], path: string, move: MoveWithin): OrderWrite[] {
	const shown = [...cell].sort(compareCardsByHand).filter(isShown);
	const i = shown.findIndex((c) => c.path === path);
	if (i < 0) return [];
	const index = move === 'top' ? 0 : move === 'up' ? i - 1 : i + 1;
	if (index < 0 || index >= shown.length || index === i) return [];
	return dropWrites(cell, path, index);
}

// ——— Moves to another cell ———

export interface CellRef {
	statusId: string;
	matterPath: string;
}

/** Whether a move takes the card to another cell (another status or another Matter). */
export function changesCell(from: CellRef, to: CellRef): boolean {
	return from.statusId !== to.statusId || from.matterPath !== to.matterPath;
}

/**
 * mtm-order on a plugin write: a position given with the move is written; any other move to another cell removes
 * the number, so the card joins the new cell after its numbered cards.
 */
export function applyCardOrder(fm: Record<string, unknown>, cellChanged: boolean, order?: number): void {
	if (order !== undefined) fm['mtm-order'] = order;
	else if (cellChanged) delete fm['mtm-order'];
}
