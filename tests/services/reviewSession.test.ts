import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { reviewInfo } from '../../src/model/matters';
import { toYmd } from '../../src/model/dates';
import type { MatterInfo } from '../../src/services/boardModel';
import { samplePlan } from '../../src/services/samplePackage';
import { isLinkTo, type PlannedNote } from '../../src/services/setupPlan';
import { emptyTally, longWaitsAcross, needsNoLook, nextReview, reviewQueue, reviewStep, tallyLines } from '../../src/services/reviewSession';
import { NO_SPHERE } from '../../src/services/spheres';
import { parseCadence } from '../../src/model/matters';

// The sample package, written and read on Friday 9 October 2026 at noon.
const now = new Date(2026, 9, 9, 12, 0);
const inboxPath = DEFAULT_SETTINGS.inboxPath;
const plan = samplePlan({ now, statuses: DEFAULT_SETTINGS.statuses, types: DEFAULT_SETTINGS.types, inboxPath, laneOrder: 0, exists: () => false });
const base = (p: string) => p.split('/').pop()?.replace(/\.md$/, '') ?? p;
const paths = new Map([...plan.map((n) => [base(n.path), n.path] as const), ['Inbox', inboxPath] as const]);
const link = (v: unknown) => (isLinkTo(v) ? `[[${base(v.linkTo)}]]` : v);
const matterPaths = new Set([inboxPath, ...plan.filter((n) => n.kind === 'matter').map((n) => n.path)]);
const resolve = (raw: string) => {
	const path = paths.get(raw.replace(/^\[\[|\]\]$/g, ''));
	return path ? { path, isMatter: matterPaths.has(path) } : null;
};
const frontmatter = (n: PlannedNote) => Object.fromEntries(Object.entries(n.frontmatter).map(([k, v]) => [k, Array.isArray(v) ? v.map(link) : link(v)]));

const items = plan.filter((n) => n.kind === 'action').map((n) => toActionItem(n.path, base(n.path), frontmatter(n), DEFAULT_SETTINGS, resolve));
const matters: MatterInfo[] = plan
	.filter((n) => n.kind === 'matter')
	.map((n, i) => {
		const fm = n.frontmatter;
		return {
			path: n.path,
			name: base(n.path),
			laneOrder: i,
			isInbox: false,
			icon: typeof fm['mtm-icon'] === 'string' ? fm['mtm-icon'] : 'circle-dot',
			state: fm['mtm-state'] as MatterInfo['state'],
			review: fm['mtm-review-every'] ? reviewInfo(fm['mtm-review-every'], fm['mtm-last-reviewed'], toYmd(now)) : null,
			sphere: typeof fm['mtm-sphere'] === 'string' ? fm['mtm-sphere'] : null,
			sphereOrphan: null,
			outcome: null,
		};
	});
const statuses = DEFAULT_SETTINGS.statuses;
const named = (name: string) => {
	const m = matters.find((x) => x.name === name);
	if (!m) throw new Error(name);
	return m;
};
const titles = (list: readonly { title: string }[]) => list.map((i) => i.title);

describe('reviewQueue on the sample package', () => {
	it('takes the active Matters due, never reviewed first, then the longest since the last review', () => {
		expect(reviewQueue(matters, { scope: 'due', sphere: null }).map((m) => m.name)).toEqual(['Advisory practice', 'Household admin', 'Half marathon']);
	});

	it('with "all", follows the due ones with every other active Matter in board order', () => {
		const all = reviewQueue(matters, { scope: 'all', sphere: null }).map((m) => m.name);
		expect(all.slice(0, 3)).toEqual(['Advisory practice', 'Household admin', 'Half marathon']);
		expect(all).toHaveLength(9);
		expect(all).not.toContain('Learn to sail');
		expect(all).not.toContain('Old blog');
	});

	it('narrows to one Sphere, or to the Matters without one', () => {
		expect(reviewQueue(matters, { scope: 'due', sphere: 'home' }).map((m) => m.name)).toEqual(['Household admin']);
		expect(reviewQueue(matters, { scope: 'due', sphere: NO_SPHERE }).map((m) => m.name)).toEqual(['Half marathon']);
	});

	it('adds dormant Matters only when their review is due, after the active ones', () => {
		// Learn to sail has no rhythm in the sample; give it one that is due.
		const sail = { ...named('Learn to sail'), review: { cadence: { n: 3, unit: 'm' as const }, lastReviewed: '2026-06-01', daysSince: 130, nextDue: '2026-09-01', due: true } };
		const withSail = matters.map((m) => (m.name === 'Learn to sail' ? sail : m));
		expect(reviewQueue(withSail, { scope: 'due', sphere: null }).map((m) => m.name)).toEqual(['Advisory practice', 'Household admin', 'Half marathon', 'Learn to sail']);
		expect(reviewQueue(matters, { scope: 'all', sphere: null }).map((m) => m.name)).not.toContain('Learn to sail');
	});
});

describe('reviewStep on the sample package', () => {
	it('Household admin: done since the last review, the overdue tax, named again as the next step', () => {
		const s = reviewStep(named('Household admin'), items, statuses, now);
		expect([s.since, s.sinceReview]).toEqual(['2026-08-30', true]);
		expect(titles(s.doneSince)).toEqual(['Cancel the gym membership']);
		expect(titles(s.overdue)).toEqual(['Pay the council tax']);
		expect(s.longWaits).toEqual([]);
		expect(s.noNextAction).toBe(false);
		expect(s.next).toEqual([]);
		expect(titles(s.nextAbove)).toEqual(['Pay the council tax']);
		expect(needsNoLook(s)).toBe(false);
	});

	it('Advisory practice: never reviewed, so "since" is the last 30 days; nothing needs a look', () => {
		const s = reviewStep(named('Advisory practice'), items, statuses, now);
		expect([s.since, s.sinceReview]).toEqual(['2026-09-09', false]);
		expect(titles(s.doneSince)).toEqual(['Proposal for the pricing review']);
		expect(needsNoLook(s)).toBe(true);
		expect(titles(s.next)).toEqual(['Reply to the new enquiry']);
	});

	it('Course redesign: no next Action', () => {
		const s = reviewStep(named('Course redesign'), items, statuses, now);
		expect(s.noNextAction).toBe(true);
		expect(s.next).toEqual([]);
		expect(s.doneSince).toEqual([]);
	});

	it('a long wait shows once: overdue wins', () => {
		expect(titles(reviewStep(named('Doctoral thesis'), items, statuses, now).longWaits)).toEqual(['Feedback on chapter 2']);
		const lakeside = reviewStep(named('Lakeside strategy review'), items, statuses, now);
		expect(titles(lakeside.overdue)).toEqual(['Data export from Bob']);
		expect(lakeside.longWaits).toEqual([]);
	});
});

describe('the end of a session', () => {
	it('lists the long waits across every Matter, the longest first', () => {
		expect(titles(longWaitsAcross(items, now))).toEqual(['Feedback on chapter 2', 'Data export from Bob']);
	});

	it('computes the next review from today and the rhythm', () => {
		expect(nextReview(parseCadence('1m'), '2026-10-09')).toBe('2026-11-09');
		expect(nextReview(parseCadence('2w'), '2026-10-09')).toBe('2026-10-23');
		expect(nextReview(null, '2026-10-09')).toBeNull();
	});

	it('tallies in a fixed order, without zeros', () => {
		const t = { ...emptyTally(), reviewed: 3, outcomes: 1, nextAdded: 1 };
		expect(tallyLines(t)).toEqual([
			{ key: 'reviewed', count: 3 },
			{ key: 'nextAdded', count: 1 },
			{ key: 'outcomes', count: 1 },
		]);
		expect(tallyLines(emptyTally())).toEqual([]);
	});
});
