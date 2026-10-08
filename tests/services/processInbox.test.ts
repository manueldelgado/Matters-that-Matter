import { describe, expect, it } from 'vitest';
import { delegateStatus, inboxOrder, nextStatuses, ProcessQueue, stripMtmProperties, tally } from '../../src/services/processInbox';
import { DEFAULT_SETTINGS, type StatusDef } from '../../src/settings';

const statuses = DEFAULT_SETTINGS.statuses;

describe('inboxOrder', () => {
	it('puts the oldest capture first', () => {
		const items = [
			{ title: 'B', ctime: 3 },
			{ title: 'A', ctime: 1 },
			{ title: 'C', ctime: 1 },
		];
		expect(inboxOrder(items).map((i) => i.title)).toEqual(['A', 'C', 'B']);
	});
});

describe('step statuses', () => {
	it('Do next offers the open and active statuses that are not the backlog', () => {
		expect(nextStatuses(statuses).map((s) => s.id)).toEqual(['next', 'doing', 'waiting']);
	});

	it('Delegate starts on the last active status, then remembers the choice', () => {
		expect(delegateStatus(statuses, null)?.id).toBe('waiting');
		expect(delegateStatus(statuses, 'doing')?.id).toBe('doing');
		expect(delegateStatus(statuses, 'done')?.id).toBe('waiting');
		expect(delegateStatus(statuses, 'gone')?.id).toBe('waiting');
	});

	it('Delegate falls back to the first offered status without an active one', () => {
		const noActive: StatusDef[] = [
			{ id: 'later', label: 'Later', tone: 'ink', category: 'open', backlog: true },
			{ id: 'next', label: 'Next', tone: 'sky', category: 'open' },
			{ id: 'done', label: 'Done', tone: 'mint', category: 'closed', done: true },
		];
		expect(delegateStatus(noActive, null)?.id).toBe('next');
	});
});

describe('stripMtmProperties', () => {
	it('removes only mtm- properties', () => {
		const fm: Record<string, unknown> = { 'mtm-kind': 'action', 'mtm-status': 'later', tags: ['x'], aliases: [] };
		stripMtmProperties(fm);
		expect(fm).toEqual({ tags: ['x'], aliases: [] });
	});
});

describe('ProcessQueue', () => {
	it('moves past processed items and keeps skipped ones', () => {
		const q = new ProcessQueue(['a', 'b', 'c', 'd']);
		expect(q.current).toBe('a');
		expect(q.forward()).toBe('b'); // skip a
		expect(q.complete()).toBe('c'); // b processed
		expect(q.back()).toBe('a'); // b is passed over
		expect(q.forward()).toBe('c');
		expect(q.complete()).toBe('d');
		expect(q.complete()).toBeNull();
		expect(q.processed).toBe(3);
		expect(q.left).toBe(1);
		expect(q.back()).toBe('a');
	});

	it('reopens an item for undo', () => {
		const q = new ProcessQueue(['a', 'b']);
		q.complete();
		q.reopen(0);
		expect(q.current).toBe('a');
		expect(q.processed).toBe(0);
	});
});

describe('tally', () => {
	it('groups decisions, Do next by status and Delegate by person', () => {
		const lines = tally([
			{ decision: 'trash' },
			{ decision: 'done' },
			{ decision: 'done' },
			{ decision: 'next', detail: 'Next' },
			{ decision: 'next', detail: 'Doing' },
			{ decision: 'next', detail: 'Next' },
			{ decision: 'delegate', detail: 'Marco' },
		]);
		expect(lines.map((l) => [l.decision, l.count, l.detail])).toEqual([
			['done', 2, undefined],
			['next', 2, 'Next'],
			['next', 1, 'Doing'],
			['delegate', 1, 'Marco'],
			['trash', 1, undefined],
		]);
	});

	it('drops the person when several were delegated to', () => {
		const [line] = tally([
			{ decision: 'delegate', detail: 'Marco' },
			{ decision: 'delegate', detail: 'Ana' },
		]);
		expect(line).toMatchObject({ count: 2, detail: undefined });
	});
});
