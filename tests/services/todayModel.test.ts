import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { reviewInfo } from '../../src/model/matters';
import { toYmd } from '../../src/model/dates';
import type { MatterInfo } from '../../src/services/boardModel';
import { samplePlan, SAMPLE_MATTERS } from '../../src/services/samplePackage';
import { isLinkTo, type PlannedNote } from '../../src/services/setupPlan';
import { todayModel } from '../../src/services/todayModel';

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
const input = { items, matters, statuses: DEFAULT_SETTINGS.statuses, inboxPath, now };

describe('todayModel on the sample package', () => {
	const m = todayModel(input);

	it('lists what is due today or late, in card order', () => {
		expect(m.due.map((i) => i.title)).toEqual([
			'Pay the council tax',
			'Confirm the worktop measurements',
			"Answer Eve's question about the essay",
			'Reply to the new enquiry',
			'Data export from Bob',
			'Visit the tile showroom',
		]);
		// At noon the 10:00 call is already late, as its card shows; at nine it is still due.
		expect([m.dueToday, m.late]).toEqual([1, 5]);
		const morning = todayModel({ ...input, now: new Date(2026, 9, 9, 9, 0) });
		expect([morning.dueToday, morning.late]).toEqual([2, 4]);
		expect(m.next).toEqual([]);
	});

	it('counts the Inbox, the reviews due and the waits', () => {
		expect(m.inbox).toBe(4);
		expect(m.reviews.map((r) => r.name)).toEqual(['Advisory practice', 'Household admin', 'Half marathon']);
		expect(m.waiting).toHaveLength(7);
		expect(m.waiting[0]?.title).toBe('Feedback on chapter 2');
		expect(m.longWaits).toBe(2);
	});

	it('shows what is next when nothing is due', () => {
		const later = todayModel({ ...input, items: items.filter((i) => !m.due.includes(i)) });
		expect(later.due).toEqual([]);
		expect(later.nextStatus?.id).toBe('next');
		expect(later.next.length).toBeGreaterThan(0);
		expect(later.next.every((i) => i.effective.status.id === 'next' && i.category !== 'closed')).toBe(true);
		expect(later.next[0]?.priority).toBe(1);
	});

	it('shows nothing next when there is nothing in Next either', () => {
		const quiet = todayModel({ ...input, items: items.filter((i) => !m.due.includes(i) && i.effective.status.id !== 'next') });
		expect([quiet.due, quiet.next]).toEqual([[], []]);
	});

	it('leaves out dormant and closed Matters and the Inbox from reviews', () => {
		expect(SAMPLE_MATTERS.filter((x) => x.state !== 'active').every((x) => !m.reviews.some((r) => r.name === x.name))).toBe(true);
	});
});
