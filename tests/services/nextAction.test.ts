import { describe, expect, it } from 'vitest';
import { isMoving, lacksNextAction, nextStepStatus } from '../../src/services/nextAction';
import { DEFAULT_SETTINGS, type StatusDef } from '../../src/settings';

const backlog = { backlog: true };
const next = {};
const a = (status: { backlog?: boolean }, category: 'open' | 'active' | 'closed', waitingOn: string | null = null) => ({ category, waitingOn, effective: { status } });
const active = { isInbox: false, state: 'active' as const };

describe('isMoving', () => {
	it('counts anything out of the backlog that is not closed', () => {
		expect(isMoving(a(next, 'open'))).toBe(true);
		expect(isMoving(a(next, 'active'))).toBe(true);
		expect(isMoving(a(backlog, 'open'))).toBe(false);
		expect(isMoving(a(next, 'closed'))).toBe(false);
	});

	it('counts waiting on someone, even in the backlog', () => {
		expect(isMoving(a(backlog, 'open', 'Lucía'))).toBe(true);
		expect(isMoving(a(next, 'closed', 'Lucía'))).toBe(false);
	});
});

describe('lacksNextAction', () => {
	it('flags an active Matter with only backlog or closed Actions, or none', () => {
		expect(lacksNextAction(active, [])).toBe(true);
		expect(lacksNextAction(active, [a(backlog, 'open'), a(next, 'closed')])).toBe(true);
		expect(lacksNextAction(active, [a(backlog, 'open'), a(next, 'open')])).toBe(false);
	});

	it('never flags the Inbox, dormant or closed Matters', () => {
		expect(lacksNextAction({ isInbox: true, state: 'active' }, [])).toBe(false);
		expect(lacksNextAction({ isInbox: false, state: 'dormant' }, [])).toBe(false);
		expect(lacksNextAction({ isInbox: false, state: 'closed' }, [])).toBe(false);
	});
});

describe('nextStepStatus', () => {
	it('is the first open status after the backlog', () => {
		expect(nextStepStatus(DEFAULT_SETTINGS.statuses)?.id).toBe('next');
	});

	it('falls back to the first active status', () => {
		const simple: StatusDef[] = [
			{ id: 'later', label: 'Later', tone: 'ink', category: 'open', backlog: true },
			{ id: 'doing', label: 'Doing', tone: 'butter', category: 'active' },
			{ id: 'done', label: 'Done', tone: 'mint', category: 'closed', done: true },
		];
		expect(nextStepStatus(simple)?.id).toBe('doing');
		expect(nextStepStatus([simple[0]!, simple[2]!])).toBeNull();
	});
});
