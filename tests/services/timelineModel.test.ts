import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import type { MatterInfo } from '../../src/services/boardModel';
import { buildTimeline, dragDates, openingDay, timelineRange, weekStartOf } from '../../src/services/timelineModel';

const resolve = (text: string) => ({ path: `M/${text}.md`, isMatter: true });
const action = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', 'mtm-status': 'next', ...fm }, DEFAULT_SETTINGS, resolve);
const matter = (name: string): MatterInfo => ({ path: `M/${name}.md`, name, laneOrder: null, isInbox: false, icon: 'circle-dot', state: 'active', review: null });

// Thursday 8 October 2026.
const today = '2026-10-08';

describe('range', () => {
	it('opens at the week before today', () => {
		expect(weekStartOf(today, 'monday')).toBe('2026-10-05');
		expect(weekStartOf(today, 'sunday')).toBe('2026-10-04');
		expect(openingDay(today, 'monday')).toBe('2026-09-28');
	});

	it('spans six months back to a year ahead, in whole weeks', () => {
		const range = timelineRange(today, 'monday');
		expect(range.from).toBe('2026-04-06');
		expect(range.days % 7).toBe(0);
		expect(range.days).toBeGreaterThanOrEqual(182 + 365);
	});
});

describe('buildTimeline', () => {
	const range = { from: '2026-09-28', days: 42 };

	it('groups rows by Matter in lane order, sorted by start, with bars and diamonds', () => {
		const groups = buildTimeline(
			[
				action('Brief', { 'mtm-matter': '[[Kitchen]]', 'mtm-start': '2026-10-12', 'mtm-due': '2026-10-15' }),
				action('Call', { 'mtm-matter': '[[Kitchen]]', 'mtm-due': '2026-10-08T10:00' }),
				action('Trip', { 'mtm-matter': '[[Porto]]', 'mtm-start': '2026-10-16', 'mtm-due': '2026-10-20' }),
				action('Undated', { 'mtm-matter': '[[Porto]]' }),
			],
			[matter('Porto'), matter('Kitchen'), matter('Empty')],
			range,
		);
		expect(groups.map((g) => g.matter.name)).toEqual(['Porto', 'Kitchen']);
		expect(groups[1]?.rows.map((r) => [r.item.title, r.start, r.span, r.milestone])).toEqual([
			['Call', 10, 1, true],
			['Brief', 14, 4, false],
		]);
	});

	it('clips bars to the range and leaves out what lies outside it', () => {
		const groups = buildTimeline(
			[
				action('Long', { 'mtm-matter': '[[Kitchen]]', 'mtm-start': '2026-09-20', 'mtm-due': '2026-10-02' }),
				action('Gone', { 'mtm-matter': '[[Kitchen]]', 'mtm-due': '2026-08-01' }),
			],
			[matter('Kitchen')],
			range,
		);
		expect(groups[0]?.rows.map((r) => [r.item.title, r.start, r.span])).toEqual([['Long', 0, 5]]);
	});
});

describe('dragDates', () => {
	const start = { date: '2026-10-12' };
	const due = { date: '2026-10-15', time: '10:00' };

	it('moves both dates and keeps times', () => {
		expect(dragDates(start, due, 'move', 3)).toEqual({ start: { date: '2026-10-15' }, due: { date: '2026-10-18', time: '10:00' } });
		expect(dragDates(null, due, 'move', -1)).toEqual({ due: { date: '2026-10-14', time: '10:00' } });
	});

	it('changes one end, never past the other', () => {
		expect(dragDates(start, due, 'start', -2)).toEqual({ start: { date: '2026-10-10' } });
		expect(dragDates(start, due, 'start', 9)).toEqual({ start: { date: '2026-10-15' } });
		expect(dragDates(start, due, 'end', 2)).toEqual({ due: { date: '2026-10-17', time: '10:00' } });
		expect(dragDates(start, due, 'end', -9)).toEqual({ due: { date: '2026-10-12', time: '10:00' } });
		expect(dragDates(null, due, 'end', 1)).toEqual({});
	});
});
