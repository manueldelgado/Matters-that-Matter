import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type StatusDef, type TypeDef } from '../../src/settings';
import {
	closedStatuses,
	addStatus,
	addType,
	backlogStatus,
	canDeleteStatus,
	canDeleteType,
	checkFlags,
	defaultType,
	doneStatus,
	moveItem,
	normaliseFlags,
	setBacklog,
	setCategory,
	setDefaultType,
	setDone,
} from '../../src/model/workflow';

const statuses = DEFAULT_SETTINGS.statuses;
const types = DEFAULT_SETTINGS.types;

describe('lookups', () => {
	it('finds the flagged items', () => {
		expect(backlogStatus(statuses)?.id).toBe('later');
		expect(doneStatus(statuses)?.id).toBe('done');
		expect(defaultType(types)?.id).toBe('write');
	});
});

describe('checkFlags', () => {
	it('accepts the defaults', () => {
		expect(checkFlags(statuses, types)).toEqual([]);
	});

	it('reports every broken rule', () => {
		const bad: StatusDef[] = [
			{ id: 'a', label: 'A', tone: 'ink', category: 'closed', backlog: true },
			{ id: 'a', label: 'B', tone: 'ink', category: 'open', done: true },
		];
		const badTypes: TypeDef[] = [
			{ id: 't', label: 'T', icon: 'x', tone: 'ink', default: true },
			{ id: 'u', label: 'U', icon: 'x', tone: 'ink', default: true },
		];
		expect(checkFlags(bad, badTypes).sort()).toEqual(
			['backlog-closed', 'default-type-count', 'done-not-closed', 'duplicate-status-id'].sort(),
		);
		expect(checkFlags([], [])).toEqual(expect.arrayContaining(['no-statuses', 'no-types', 'backlog-count', 'done-count']));
	});
});

describe('setting flags', () => {
	it('marking another backlog status unmarks the previous one', () => {
		const next = setBacklog(statuses, 'next')!;
		expect(next.filter((s) => s.backlog).map((s) => s.id)).toEqual(['next']);
		expect(next.find((s) => s.id === 'later')).not.toHaveProperty('backlog');
		expect(checkFlags(next, types)).toEqual([]);
	});

	it('refuses a closed backlog status', () => {
		expect(setBacklog(statuses, 'done')).toBeNull();
		expect(setBacklog(statuses, 'missing')).toBeNull();
	});

	it('moves the done flag only to closed statuses', () => {
		const withArchive = [...statuses, { id: 'archived', label: 'Archived', tone: 'ink', category: 'closed' } as StatusDef];
		const next = setDone(withArchive, 'archived')!;
		expect(doneStatus(next)?.id).toBe('archived');
		expect(next.filter((s) => s.done)).toHaveLength(1);
		expect(setDone(statuses, 'doing')).toBeNull();
	});

	it('protects flags when changing categories', () => {
		expect(setCategory(statuses, 'later', 'closed')).toBeNull();
		expect(setCategory(statuses, 'done', 'active')).toBeNull();
		expect(setCategory(statuses, 'next', 'active')?.find((s) => s.id === 'next')?.category).toBe('active');
	});

	it('moves the default type', () => {
		const next = setDefaultType(types, 'call')!;
		expect(next.filter((t) => t.default).map((t) => t.id)).toEqual(['call']);
		expect(setDefaultType(types, 'missing')).toBeNull();
	});

	it('does not delete flagged items', () => {
		expect(canDeleteStatus(backlogStatus(statuses)!)).toBe(false);
		expect(canDeleteStatus(doneStatus(statuses)!)).toBe(false);
		expect(canDeleteStatus(statuses[1]!)).toBe(true);
		expect(canDeleteType(defaultType(types)!)).toBe(false);
		expect(canDeleteType(types[0]!)).toBe(true);
	});
});

describe('normaliseFlags', () => {
	it('leaves valid flags alone', () => {
		expect(normaliseFlags(statuses, types)).toEqual({ statuses, types });
	});

	it('repairs missing and duplicated flags', () => {
		const broken: StatusDef[] = statuses.map((s) => ({ ...s, backlog: true, done: true }));
		const brokenTypes: TypeDef[] = types.map((t) => ({ ...t, default: undefined }));
		const fixed = normaliseFlags(broken, brokenTypes);
		expect(checkFlags(fixed.statuses, fixed.types)).toEqual([]);
		expect(backlogStatus(fixed.statuses)?.id).toBe('later');
		expect(doneStatus(fixed.statuses)?.id).toBe('done');
		expect(defaultType(fixed.types)?.id).toBe('call');
	});

	it('moves a backlog flag off a closed status', () => {
		const broken = statuses.map((s) => ({ ...s, backlog: s.id === 'done' ? true : undefined }));
		expect(backlogStatus(normaliseFlags(broken, types).statuses)?.id).toBe('later');
	});
});

describe('adding and ordering', () => {
	it('adds statuses and types with generated IDs', () => {
		expect(addStatus(statuses, 'Next', 'sky', 'open').at(-1)).toEqual({ id: 'next-2', label: 'Next', tone: 'sky', category: 'open' });
		expect(addType(types, 'Follow up', 'reply', 'peach').at(-1)?.id).toBe('follow-up');
	});

	it('moves items', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
		expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
		expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
	});
});

describe('closedStatuses', () => {
	it('lists every closed status, the done status first', () => {
		const statuses: StatusDef[] = [
			{ id: 'later', label: 'Later', tone: 'ink', category: 'open', backlog: true },
			{ id: 'dropped', label: 'Dropped', tone: 'ink', category: 'closed' },
			{ id: 'done', label: 'Completed', tone: 'mint', category: 'closed', done: true },
		];
		expect(closedStatuses(statuses).map((s) => s.label)).toEqual(['Completed', 'Dropped']);
		expect(closedStatuses(DEFAULT_SETTINGS.statuses).map((s) => s.label)).toEqual(['Done']);
	});
});

