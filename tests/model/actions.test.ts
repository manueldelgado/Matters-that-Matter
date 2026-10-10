import { describe, expect, it } from 'vitest';
import {
	compareCards,
	compareCardsByHand,
	parseOrder,
	resolveCardOrder,
	waitAge,
	isShownByDone,
	isToday,
	isWaiting,
	parsePriority,
	progress,
	resolveInboxPosition,
	resolveShowDone,
	type CardKey,
} from '../../src/model/actions';

describe('parsePriority', () => {
	it('reads 1 to 3 as numbers or digit strings', () => {
		expect(parsePriority(1)).toBe(1);
		expect(parsePriority('3')).toBe(3);
	});

	it('treats anything else as no priority', () => {
		for (const raw of [0, 4, 1.5, '', 'high', null, undefined]) expect(parsePriority(raw)).toBeNull();
	});
});

describe('derived values', () => {
	const now = new Date(2026, 9, 9, 12, 0);

	it('Waiting: has mtm-waiting-on and is not closed', () => {
		expect(isWaiting('[[Marco Rossi]]', 'active')).toBe(true);
		expect(isWaiting('[[Marco Rossi]]', 'closed')).toBe(false);
		expect(isWaiting('', 'open')).toBe(false);
		expect(isWaiting([], 'open')).toBe(false);
		expect(isWaiting(undefined, 'open')).toBe(false);
	});

	it('Today: due today or overdue, not closed', () => {
		expect(isToday({ date: '2026-10-09', time: '18:00' }, 'open', now)).toBe(true);
		expect(isToday({ date: '2026-10-01' }, 'active', now)).toBe(true);
		expect(isToday({ date: '2026-10-10' }, 'open', now)).toBe(false);
		expect(isToday({ date: '2026-10-09' }, 'closed', now)).toBe(false);
		expect(isToday(null, 'open', now)).toBe(false);
	});

	it('progress is closed ÷ all', () => {
		expect(progress(['open', 'closed', 'active', 'closed'])).toEqual({ closed: 2, total: 4, ratio: 0.5 });
		expect(progress([])).toEqual({ closed: 0, total: 0, ratio: 0 });
	});
});

describe('compareCards', () => {
	const card = (title: string, priority: CardKey['priority'], due?: string, time?: string): CardKey => ({
		title,
		priority,
		due: due ? (time ? { date: due, time } : { date: due }) : null,
	});

	it('sorts by priority, then due date, then title', () => {
		const cards = [
			card('No priority', null, '2026-10-01'),
			card('Low', 3),
			card('High later', 1, '2026-10-20'),
			card('High undated', 1),
			card('High sooner', 1, '2026-10-10'),
			card('High same day timed', 1, '2026-10-10', '09:00'),
			card('Medium b', 2),
			card('Medium a', 2),
		];
		expect(cards.sort(compareCards).map((c) => c.title)).toEqual([
			'High sooner',
			'High same day timed',
			'High later',
			'High undated',
			'Medium a',
			'Medium b',
			'Low',
			'No priority',
		]);
	});

	it('compares titles naturally', () => {
		expect([card('Item 10', null), card('item 2', null)].sort(compareCards).map((c) => c.title)).toEqual(['item 2', 'Item 10']);
	});
});

describe('parseOrder', () => {
	it('reads any finite number, or a numeric string', () => {
		expect(parseOrder(15)).toBe(15);
		expect(parseOrder(-5)).toBe(-5);
		expect(parseOrder(2.5)).toBe(2.5);
		expect(parseOrder('20')).toBe(20);
		expect(parseOrder(' -5 ')).toBe(-5);
		expect(parseOrder('12.5')).toBe(12.5);
	});

	it('treats anything else as no number', () => {
		for (const raw of ['', 'first', null, undefined, Number.NaN, Infinity, [], {}, '0x10', '1e3', 'Infinity', '.5', '5.', '+5']) expect(parseOrder(raw)).toBeNull();
	});
});

describe('compareCardsByHand', () => {
	const card = (title: string, order: number | null, priority: CardKey['priority'] = null): CardKey => ({ title, priority, due: null, order });

	it('puts numbered cards first, lower first, then the rest in the automatic order', () => {
		const cards = [card('Unnumbered high', null, 1), card('Thirty', 30), card('Unnumbered low', null, 3), card('Ten', 10, 3), card('Twenty', 20)];
		expect(cards.sort(compareCardsByHand).map((c) => c.title)).toEqual(['Ten', 'Twenty', 'Thirty', 'Unnumbered high', 'Unnumbered low']);
	});

	it('falls back to the automatic order for equal numbers', () => {
		expect([card('B', 10), card('A', 10, 1)].sort(compareCardsByHand).map((c) => c.title)).toEqual(['A', 'B']);
	});

	it('is the automatic order when no card has a number', () => {
		const cards = [card('b', null), card('a', null, 2), card('c', null, 1)];
		expect([...cards].sort(compareCardsByHand)).toEqual([...cards].sort(compareCards));
	});

	it('the automatic order ignores mtm-order', () => {
		expect([card('A', 30), card('B', 10)].sort(compareCards).map((c) => c.title)).toEqual(['A', 'B']);
	});

	it('resolves the view option, automatic by default', () => {
		expect(resolveCardOrder(undefined)).toBe('auto');
		expect(resolveCardOrder('auto')).toBe('auto');
		expect(resolveCardOrder('manual')).toBe('manual');
		expect(resolveCardOrder('nonsense')).toBe('auto');
	});
});

describe('board options', () => {
	it('resolves Show done', () => {
		expect(resolveShowDone('show', false)).toBe(true);
		expect(resolveShowDone('hide', true)).toBe(false);
		expect(resolveShowDone('inherit', true)).toBe(true);
		expect(resolveShowDone(undefined, false)).toBe(false);
	});

	it('resolves the Inbox position', () => {
		expect(resolveInboxPosition('hidden', 'top')).toBe('hidden');
		expect(resolveInboxPosition('inherit', 'bottom')).toBe('bottom');
		expect(resolveInboxPosition(undefined, 'top')).toBe('top');
	});
});

describe('isShownByDone', () => {
	const today = '2026-10-09';

	it('always shows Actions that are not closed', () => {
		expect(isShownByDone('open', undefined, false, 7, today)).toBe(true);
	});

	it('hides closed Actions when Show done is off', () => {
		expect(isShownByDone('closed', today, false, null, today)).toBe(false);
	});

	it('shows all closed Actions without a window', () => {
		expect(isShownByDone('closed', undefined, true, null, today)).toBe(true);
	});

	it('limits closed Actions to the last N days, counting today', () => {
		expect(isShownByDone('closed', '2026-10-09', true, 1, today)).toBe(true);
		expect(isShownByDone('closed', '2026-10-08', true, 1, today)).toBe(false);
		expect(isShownByDone('closed', '2026-10-03', true, 7, today)).toBe(true);
		expect(isShownByDone('closed', '2026-10-02', true, 7, today)).toBe(false);
	});

	it('hides closed Actions without mtm-completed inside a window', () => {
		expect(isShownByDone('closed', undefined, true, 30, today)).toBe(false);
	});
});

describe('waitAge', () => {
	it('counts days under two weeks, then weeks, then months', () => {
		expect(waitAge('2026-10-08', '2026-10-08')).toMatchObject({ days: 0, long: 'today', short: 'today', isLong: false });
		expect(waitAge('2026-10-07', '2026-10-08')).toMatchObject({ long: '1 day', short: '1d' });
		expect(waitAge('2026-09-28', '2026-10-08')).toMatchObject({ days: 10, long: '10 days', short: '10d', isLong: false });
		expect(waitAge('2026-09-24', '2026-10-08')).toMatchObject({ days: 14, long: '2 weeks', short: '2w', isLong: true });
		expect(waitAge('2026-09-15', '2026-10-08')).toMatchObject({ long: '3 weeks', short: '3w' });
		expect(waitAge('2026-08-01', '2026-10-08')).toMatchObject({ long: '2 months', short: '2mo' });
	});

	it('treats a future date as today', () => {
		expect(waitAge('2026-10-20', '2026-10-08').long).toBe('today');
	});
});
