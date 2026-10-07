import { describe, expect, it } from 'vitest';
import {
	compareCards,
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
