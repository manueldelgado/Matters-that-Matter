import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MattersSettings } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { actionNoteClasses, bannerDate, explorerClasses } from '../../src/services/noteDecor';

// Friday 9 October 2026, 12:00.
const now = new Date(2026, 9, 9, 12, 0);
const today = '2026-10-09';
const action = (fm: Record<string, unknown>, settings: MattersSettings = DEFAULT_SETTINGS) =>
	toActionItem('A/Test.md', 'Test', { 'mtm-kind': 'action', 'mtm-type': 'call', ...fm }, settings, () => null);

describe('actionNoteClasses', () => {
	it('carries type, tone, status, priority and due state', () => {
		expect(actionNoteClasses(action({ 'mtm-status': 'next', 'mtm-priority': 1, 'mtm-due': '2026-10-09' }), now)).toEqual([
			'mtm-action-note',
			'mtm-type-call',
			'mtm-tone-mint',
			'mtm-status-next',
			'mtm-status-tone-sky',
			'mtm-priority-1',
			'mtm-due-today',
		]);
		expect(actionNoteClasses(action({ 'mtm-status': 'next', 'mtm-due': '2026-10-08' }), now)).toContain('mtm-due-overdue');
		expect(actionNoteClasses(action({ 'mtm-status': 'next', 'mtm-due': '2026-10-09T11:00' }), now)).toContain('mtm-due-overdue');
	});

	it('marks every closed status as done, never overdue', () => {
		const settings: MattersSettings = {
			...DEFAULT_SETTINGS,
			statuses: [...DEFAULT_SETTINGS.statuses, { id: 'dropped', label: 'Dropped', tone: 'ink', category: 'closed' }],
		};
		const classes = actionNoteClasses(action({ 'mtm-status': 'dropped', 'mtm-due': '2026-10-01' }, settings), now);
		expect(classes).toContain('mtm-is-done');
		expect(classes).not.toContain('mtm-due-overdue');
		expect(explorerClasses(action({ 'mtm-status': 'dropped' }, settings))).toEqual([
			'mtm-nav-action',
			'mtm-type-call',
			'mtm-tone-mint',
			'mtm-status-dropped',
			'mtm-status-tone-ink',
			'mtm-is-done',
		]);
	});

	it('uses the effective type and status of orphans', () => {
		const classes = explorerClasses(action({ 'mtm-status': 'someday', 'mtm-type': 'shop' }));
		expect(classes).toEqual(['mtm-nav-action', 'mtm-type-write', 'mtm-tone-butter', 'mtm-status-later', 'mtm-status-tone-ink']);
	});
});

describe('bannerDate', () => {
	it('shows the due date, with its state', () => {
		expect(bannerDate(action({ 'mtm-due': '2026-10-09T10:00' }), now, today)).toEqual({ icon: 'circle-alert', label: 'Today 10:00', state: 'overdue' });
		expect(bannerDate(action({ 'mtm-due': '2026-10-09T15:00' }), now, today)).toEqual({ icon: 'clock', label: 'Today 15:00', state: 'today' });
		expect(bannerDate(action({ 'mtm-due': '2026-10-10' }), now, today)).toEqual({ icon: 'calendar', label: 'Tomorrow', state: null });
	});

	it('shows a span over several days as start → due', () => {
		expect(bannerDate(action({ 'mtm-start': '2026-10-15', 'mtm-due': '2026-10-18' }), now, today)?.label).toBe('Thursday → Sun 18 Oct');
		expect(bannerDate(action({ 'mtm-start': '2026-10-12T09:00', 'mtm-due': '2026-10-12T10:00' }), now, today)?.label).toBe('Monday 10:00');
	});

	it('uses the due date alone when the start is after it, and the start alone without a due date', () => {
		expect(bannerDate(action({ 'mtm-start': '2026-10-20', 'mtm-due': '2026-10-12' }), now, today)?.label).toBe('Monday');
		expect(bannerDate(action({ 'mtm-start': '2026-10-12' }), now, today)?.label).toBe('Monday');
		expect(bannerDate(action({}), now, today)).toBeNull();
	});

	it('shows when a closed Action was done, or nothing', () => {
		const done = (completed?: string) => bannerDate(action({ 'mtm-status': 'done', 'mtm-due': '2026-10-01', 'mtm-completed': completed }), now, today);
		expect(done('2026-10-09')?.label).toBe('Done today');
		expect(done('2026-10-08')?.label).toBe('Done yesterday');
		expect(done('2026-10-02')?.label).toBe('Done Fri 2 Oct');
		expect(done(undefined)).toBeNull();
	});
});
