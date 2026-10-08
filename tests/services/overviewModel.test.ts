import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { overviewModel, reviewState } from '../../src/services/overviewModel';
import { reviewInfo } from '../../src/model/matters';
import type { ResolveLink } from '../../src/services/effective';

const settings = DEFAULT_SETTINGS;
// Friday 9 October 2026, 12:00.
const now = new Date(2026, 9, 9, 12, 0);
const today = '2026-10-09';
const resolve: ResolveLink = (text) => (text === 'Kitchen' ? { path: 'M/Kitchen.md', isMatter: true } : null);
const action = (title: string, fm: Record<string, unknown>) =>
	toActionItem(`A/${title}.md`, title, { 'mtm-kind': 'action', 'mtm-matter': '[[Kitchen]]', ...fm }, settings, resolve);

const items = [
	action('Buy tiles', { 'mtm-status': 'next', 'mtm-due': '2026-10-12' }),
	action('Call plumber', { 'mtm-status': 'next', 'mtm-priority': 1, 'mtm-due': '2026-10-09' }),
	action('Measure', { 'mtm-status': 'doing', 'mtm-due': '2026-10-01' }),
	action('Ask Ana', { 'mtm-status': 'waiting', 'mtm-waiting-on': '[[Ana Gil]]' }),
	action('Recent', { 'mtm-status': 'done', 'mtm-completed': '2026-10-08', 'mtm-due': '2026-10-01' }),
	action('Older', { 'mtm-status': 'done', 'mtm-completed': '2026-09-20' }),
	action('Ancient', { 'mtm-status': 'done', 'mtm-completed': '2026-08-01' }),
	action('Undated', { 'mtm-status': 'done' }),
];

describe('overviewModel', () => {
	it('counts open, today or late, waiting and closed', () => {
		expect(overviewModel(items, settings.statuses, now, today, false).stats).toEqual({ open: 4, today: 2, waiting: 1, closed: 4, total: 8 });
	});

	it('lists statuses in workflow order, leaving out empty ones, with cards in board order', () => {
		const { sections } = overviewModel(items, settings.statuses, now, today, false);
		expect(sections.map((s) => s.status.id)).toEqual(['next', 'doing', 'waiting', 'done']);
		expect(sections[0]?.items.map((i) => i.title)).toEqual(['Call plumber', 'Buy tiles']);
	});

	it('shows closed Actions from the last 30 days, newest first, until "Show all"', () => {
		const done = (all: boolean) => overviewModel(items, settings.statuses, now, today, all).sections.find((s) => s.status.id === 'done');
		expect(done(false)?.items.map((i) => i.title)).toEqual(['Recent', 'Older']);
		expect(done(false)?.hidden).toBe(2);
		expect(done(true)?.items.map((i) => i.title)).toEqual(['Recent', 'Older', 'Ancient', 'Undated']);
		expect(done(true)?.hidden).toBe(0);
	});

	it('keeps a closed section that has only older Actions, with all of them hidden', () => {
		const old = [action('Ancient', { 'mtm-status': 'done', 'mtm-completed': '2026-08-01' })];
		expect(overviewModel(old, settings.statuses, now, today, false).sections[0]).toMatchObject({ items: [], hidden: 1 });
	});
});

describe('reviewState', () => {
	it('tells on time, overdue (with days late) and never reviewed', () => {
		expect(reviewState(reviewInfo('1w', '2026-10-05', today), today)).toEqual({ state: 'ontime', daysLate: 0 });
		expect(reviewState(reviewInfo('1w', '2026-09-23', today), today)).toEqual({ state: 'overdue', daysLate: 9 });
		expect(reviewState(reviewInfo('1w', undefined, today), today)).toEqual({ state: 'never', daysLate: 0 });
	});
});
