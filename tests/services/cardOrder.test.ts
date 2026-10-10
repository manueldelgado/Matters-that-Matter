import { describe, expect, it } from 'vitest';
import type { Priority } from '../../src/model/actions';
import { applyCardOrder, changesCell, dropWrites, moveWithin, ORDER_STEP, type CellCard } from '../../src/services/cardOrder';

const card = (path: string, order: number | null = null, extra: Partial<CellCard> = {}): CellCard => ({
	path,
	title: path,
	priority: null,
	due: null,
	order,
	...extra,
});

/** Applies writes and returns the cell's paths in hand order, as a By hand board would show them. */
function after(cell: CellCard[], writes: { path: string; order: number }[], moved?: CellCard): string[] {
	const byPath = new Map(writes.map((w) => [w.path, w.order]));
	const all = moved && !cell.some((c) => c.path === moved.path) ? [...cell, moved] : cell;
	return all
		.map((c) => ({ ...c, order: byPath.get(c.path) ?? c.order }))
		.sort((a, b) => {
			const oa = a.order ?? null, ob = b.order ?? null;
			if (oa !== null && ob !== null) return oa - ob;
			if ((oa === null) !== (ob === null)) return oa !== null ? -1 : 1;
			return a.title.localeCompare(b.title);
		})
		.filter((c) => c.shown !== false)
		.map((c) => c.path);
}

describe('dropWrites', () => {
	it('numbers the whole cell as shown on the first drop', () => {
		// Shown in the automatic order: a (high), b (medium), c, d.
		const cell = [card('c'), card('a', null, { priority: 1 as Priority }), card('d'), card('b', null, { priority: 2 as Priority })];
		const writes = dropWrites(cell, 'd', 0);
		expect(writes).toEqual([
			{ path: 'd', order: 10 },
			{ path: 'a', order: 20 },
			{ path: 'b', order: 30 },
			{ path: 'c', order: 40 },
		]);
	});

	it('writes only the moved card halfway between its neighbours later on', () => {
		const cell = [card('a', 10), card('b', 20), card('c', 30), card('d', 40)];
		expect(dropWrites(cell, 'd', 1)).toEqual([{ path: 'd', order: 15 }]);
		expect(after(cell, dropWrites(cell, 'd', 1))).toEqual(['a', 'd', 'b', 'c']);
	});

	it('moves to the top (halfway to zero) and to the bottom (one step on)', () => {
		const cell = [card('a', 10), card('b', 20), card('c', 30)];
		expect(dropWrites(cell, 'c', 0)).toEqual([{ path: 'c', order: 5 }]);
		expect(dropWrites(cell, 'a', 2)).toEqual([{ path: 'a', order: 30 + ORDER_STEP }]);
	});

	it('renumbers the cell when there is no gap', () => {
		const cell = [card('a', 10), card('b', 11), card('c', 30)];
		const writes = dropWrites(cell, 'c', 1);
		expect(after(cell, writes)).toEqual(['a', 'c', 'b']);
		// Only changed rows: a keeps 10.
		expect(writes).toEqual([
			{ path: 'c', order: 20 },
			{ path: 'b', order: 30 },
		]);
	});

	it('renumbers when the top has no room left', () => {
		const cell = [card('a', 1), card('b', 2)];
		expect(after(cell, dropWrites(cell, 'b', 0))).toEqual(['b', 'a']);
	});

	it('renumbers when neighbours share a number', () => {
		const cell = [card('a', 20), card('b', 20), card('c', 30)];
		const writes = dropWrites(cell, 'c', 1);
		expect(after(cell, writes)).toEqual(['a', 'c', 'b']);
	});

	it('writes nothing when the card lands where it was', () => {
		const cell = [card('a', 10), card('b', 20), card('c', 30)];
		expect(dropWrites(cell, 'b', 1)).toEqual([]);
		// Not even in an unnumbered cell.
		expect(dropWrites([card('x'), card('y')], 'x', 0)).toEqual([]);
	});

	it('always writes a card coming from another cell, with its place', () => {
		const cell = [card('a', 10), card('b', 20)];
		expect(dropWrites(cell, 'new', 1)).toEqual([{ path: 'new', order: 15 }]);
		expect(dropWrites([], 'new', 0)).toEqual([{ path: 'new', order: 10 }]);
		// Into an unnumbered cell: the whole cell is numbered, the newcomer included.
		expect(dropWrites([card('a'), card('b')], 'new', 2)).toEqual([
			{ path: 'a', order: 10 },
			{ path: 'b', order: 20 },
			{ path: 'new', order: 30 },
		]);
	});

	it('keeps an unnumbered moved card out of the numbering rule (only the others count)', () => {
		const cell = [card('a', 10), card('b', 20), card('x')];
		expect(dropWrites(cell, 'x', 0)).toEqual([{ path: 'x', order: 5 }]);
	});

	it('numbers the cell when a later card has no number yet', () => {
		const cell = [card('a', 10), card('b', 20), card('n')];
		expect(after(cell, dropWrites(cell, 'b', 0))).toEqual(['b', 'a', 'n']);
		expect(dropWrites(cell, 'b', 0)).toEqual([
			{ path: 'b', order: 10 },
			{ path: 'a', order: 20 },
			{ path: 'n', order: 30 },
		]);
	});

	describe('a cell with hidden cards', () => {
		it('keeps numbered hidden cards in their place and lands before the shown card dropped on', () => {
			// Shown: a, c; hidden: h between them.
			const cell = [card('a', 10), card('h', 20, { shown: false }), card('c', 30), card('d', 40)];
			// Drop d before c (index 1 among shown a, c): between h and c.
			expect(dropWrites(cell, 'd', 1)).toEqual([{ path: 'd', order: 25 }]);
			// At the end of the shown cards: after the last shown card.
			expect(dropWrites(cell, 'a', 2)).toEqual([{ path: 'a', order: 50 }]);
		});

		it('never writes unnumbered hidden cards', () => {
			const cell = [card('a'), card('b'), card('z', null, { shown: false })];
			const writes = dropWrites(cell, 'b', 0);
			expect(writes.map((w) => w.path)).not.toContain('z');
			expect(writes).toEqual([
				{ path: 'b', order: 10 },
				{ path: 'a', order: 20 },
			]);
		});

		it('renumbers numbered hidden cards with the rest when needed', () => {
			const cell = [card('a', 1), card('h', 2, { shown: false }), card('c', 3)];
			const writes = dropWrites(cell, 'c', 0);
			expect(writes).toEqual([
				{ path: 'c', order: 10 },
				{ path: 'a', order: 20 },
				{ path: 'h', order: 30 },
			]);
		});
	});

	it('clamps an index out of range', () => {
		const cell = [card('a', 10), card('b', 20)];
		expect(dropWrites(cell, 'a', 99)).toEqual([{ path: 'a', order: 30 }]);
		expect(dropWrites(cell, 'b', -3)).toEqual([{ path: 'b', order: 5 }]);
	});
});

describe('moveWithin', () => {
	const cell = [card('a', 10), card('b', 20), card('c', 30)];

	it('moves to the top, up and down', () => {
		expect(after(cell, moveWithin(cell, 'c', 'top'))).toEqual(['c', 'a', 'b']);
		expect(after(cell, moveWithin(cell, 'c', 'up'))).toEqual(['a', 'c', 'b']);
		expect(after(cell, moveWithin(cell, 'a', 'down'))).toEqual(['b', 'a', 'c']);
	});

	it('writes nothing when the card cannot move that way', () => {
		expect(moveWithin(cell, 'a', 'top')).toEqual([]);
		expect(moveWithin(cell, 'a', 'up')).toEqual([]);
		expect(moveWithin(cell, 'c', 'down')).toEqual([]);
		expect(moveWithin(cell, 'missing', 'up')).toEqual([]);
	});

	it('moves among the shown cards only', () => {
		const withHidden = [card('a', 10), card('h', 20, { shown: false }), card('c', 30)];
		expect(after(withHidden, moveWithin(withHidden, 'c', 'up'))).toEqual(['c', 'a']);
	});

	it('numbers an unnumbered cell in the order shown', () => {
		const plain = [card('b'), card('a'), card('c')];
		expect(moveWithin(plain, 'c', 'up')).toEqual([
			{ path: 'a', order: 10 },
			{ path: 'c', order: 20 },
			{ path: 'b', order: 30 },
		]);
	});
});

describe('a move to another cell', () => {
	it('tells a change of status or Matter from a change of type', () => {
		const from = { statusId: 'next', matterPath: 'M/Kitchen.md' };
		expect(changesCell(from, { ...from })).toBe(false);
		expect(changesCell(from, { ...from, statusId: 'done' })).toBe(true);
		expect(changesCell(from, { ...from, matterPath: 'M/Garden.md' })).toBe(true);
	});

	it('removes mtm-order unless the move gives a place', () => {
		const fm = (): Record<string, unknown> => ({ 'mtm-order': 20 });
		const moved = fm();
		applyCardOrder(moved, true);
		expect(moved).toEqual({});
		const placed = fm();
		applyCardOrder(placed, true, 15);
		expect(placed['mtm-order']).toBe(15);
		const kept = fm();
		applyCardOrder(kept, false);
		expect(kept['mtm-order']).toBe(20);
	});
});
