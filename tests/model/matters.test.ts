import { describe, expect, it } from 'vitest';
import {
	matterState,
	moveLane,
	moveLaneBy,
	nextLaneOrder,
	orderLanes,
	parseCadence,
	parseLaneOrder,
	reviewInfo,
	startsCollapsed,
	type Lane,
} from '../../src/model/matters';

describe('matterState', () => {
	it('reads known states and treats anything else as active', () => {
		expect(matterState('dormant')).toBe('dormant');
		expect(matterState('closed')).toBe('closed');
		expect(matterState(undefined)).toBe('active');
		expect(matterState('paused')).toBe('active');
	});

	it('collapses dormant and closed Matters', () => {
		expect(startsCollapsed('active')).toBe(false);
		expect(startsCollapsed('dormant')).toBe(true);
	});
});

describe('review', () => {
	const today = '2026-10-09';

	it('parses cadences', () => {
		expect(parseCadence('2w')).toEqual({ n: 2, unit: 'w' });
		expect(parseCadence(' 1M ')).toEqual({ n: 1, unit: 'm' });
		expect(parseCadence('0d')).toBeNull();
		expect(parseCadence('weekly')).toBeNull();
		expect(parseCadence(7)).toBeNull();
	});

	it('is never due without a cadence', () => {
		expect(reviewInfo(undefined, '2020-01-01', today)).toMatchObject({ cadence: null, due: false, daysSince: 2473 });
	});

	it('counts a Matter never reviewed as due', () => {
		expect(reviewInfo('1w', undefined, today)).toMatchObject({ due: true, lastReviewed: null, nextDue: null, daysSince: null });
	});

	it('is due on and after the next review date', () => {
		expect(reviewInfo('1w', '2026-10-02', today)).toMatchObject({ due: true, nextDue: '2026-10-09', daysSince: 7 });
		expect(reviewInfo('1w', '2026-10-03', today)).toMatchObject({ due: false, nextDue: '2026-10-10' });
		expect(reviewInfo('3d', '2026-10-05', today).due).toBe(true);
	});

	it('uses calendar months', () => {
		expect(reviewInfo('1m', '2026-08-31', today)).toMatchObject({ nextDue: '2026-09-30', due: true });
		expect(reviewInfo('1m', '2026-09-10', today)).toMatchObject({ nextDue: '2026-10-10', due: false });
	});

	it('reads a timed last-reviewed value by its day', () => {
		expect(reviewInfo('1d', '2026-10-08T23:00', today)).toMatchObject({ lastReviewed: '2026-10-08', due: true });
	});
});

describe('lanes', () => {
	const lane = (name: string, laneOrder: number | null, isInbox = false): Lane => ({ path: `M/${name}.md`, name, laneOrder, isInbox });
	const lanes = [lane('Zeta', null), lane('Kitchen', 2), lane('Inbox', null, true), lane('Alpha', null), lane('Garden', 1), lane('Bike', 2)];
	const names = (ls: Lane[]) => ls.map((l) => l.name);

	it('orders by lane order, then name, with unordered lanes last', () => {
		expect(names(orderLanes(lanes, 'top'))).toEqual(['Inbox', 'Garden', 'Bike', 'Kitchen', 'Alpha', 'Zeta']);
	});

	it('places or hides the Inbox', () => {
		expect(names(orderLanes(lanes, 'bottom')).at(-1)).toBe('Inbox');
		expect(names(orderLanes(lanes, 'hidden'))).not.toContain('Inbox');
	});

	it('parses lane order values', () => {
		expect(parseLaneOrder(3)).toBe(3);
		expect(parseLaneOrder('2.5')).toBe(2.5);
		expect(parseLaneOrder('')).toBeNull();
		expect(parseLaneOrder('first')).toBeNull();
	});

	it('gives a new Matter the highest order + 1', () => {
		expect(nextLaneOrder(lanes)).toBe(3);
		expect(nextLaneOrder([lane('A', null)])).toBe(1);
		expect(nextLaneOrder([lane('A', 2.5)])).toBe(3);
	});

	it('renumbers lanes after a move and returns only changes', () => {
		const ordered = orderLanes(lanes, 'top');
		const writes = moveLane(ordered, 'M/Zeta.md', 0);
		expect(writes).toEqual([
			{ path: 'M/Zeta.md', laneOrder: 1 },
			{ path: 'M/Garden.md', laneOrder: 2 },
			{ path: 'M/Bike.md', laneOrder: 3 },
			{ path: 'M/Kitchen.md', laneOrder: 4 },
			{ path: 'M/Alpha.md', laneOrder: 5 },
		]);
	});

	it('moves lanes up and down, and not past the ends', () => {
		const ordered = orderLanes([lane('A', 1), lane('B', 2), lane('C', 3)], 'top');
		expect(moveLaneBy(ordered, 'M/B.md', -1)).toEqual([
			{ path: 'M/B.md', laneOrder: 1 },
			{ path: 'M/A.md', laneOrder: 2 },
		]);
		expect(moveLaneBy(ordered, 'M/A.md', -1)).toEqual([]);
		expect(moveLaneBy(ordered, 'M/C.md', 1)).toEqual([]);
	});

	it('never moves the Inbox', () => {
		expect(moveLane(orderLanes(lanes, 'top'), 'M/Inbox.md', 3)).toEqual([]);
	});
});
