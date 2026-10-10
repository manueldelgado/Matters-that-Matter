import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { toActionItem } from '../../src/services/actionItems';
import { embedItems, embedTitle, parseEmbedQuery, EMBED_LIMIT, type EmbedNames, type EmbedNote, type EmbedSubject } from '../../src/services/embedQuery';
import type { QuickAddContext } from '../../src/services/quickAddParser';
import { samplePlan } from '../../src/services/samplePackage';
import { isLinkTo, type PlannedNote } from '../../src/services/setupPlan';

// The sample package, written and read on Friday 9 October 2026 at noon.
const now = new Date(2026, 9, 9, 12, 0);
const today = '2026-10-09';
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
const toPath = (v: unknown) => (isLinkTo(v) ? v.linkTo : null);

const subjects: EmbedSubject[] = plan
	.filter((n) => n.kind === 'action')
	.map((n) => {
		const fm = n.frontmatter as Record<string, unknown>;
		const listed: unknown[] = Array.isArray(fm['mtm-people']) ? (fm['mtm-people'] as unknown[]) : [];
		const people = new Set([...listed, fm['mtm-waiting-on']].map(toPath).filter((p): p is string => !!p));
		return { item: toActionItem(n.path, base(n.path), frontmatter(n), DEFAULT_SETTINGS, resolve), people, waitingOn: toPath(fm['mtm-waiting-on']) };
	});

const ctx: QuickAddContext = {
	now,
	types: DEFAULT_SETTINGS.types.map((t) => ({ id: t.id, names: [t.label, t.id] })),
	matters: plan.filter((n) => n.kind === 'matter').map((n) => ({ path: n.path, names: [base(n.path)] })),
	people: plan.filter((n) => n.path.includes('/People/')).map((n) => ({ path: n.path, names: [base(n.path)], rank: 0 })),
};
const other: EmbedNote = { path: 'Daily/2026-10-09.md', kind: 'other' };
const names: EmbedNames = {
	matter: (p) => base(p),
	type: (id) => DEFAULT_SETTINGS.types.find((t) => t.id === id)?.label ?? id,
	person: (p) => base(p),
	status: (id) => DEFAULT_SETTINGS.statuses.find((s) => s.id === id)?.label ?? '',
};
const run = (source: string, note: EmbedNote = other) => {
	const q = parseEmbedQuery(source, ctx, note, today);
	const r = embedItems(subjects, q, DEFAULT_SETTINGS.statuses, now);
	return { q, titles: r.items.map((i) => i.title), total: r.total, head: embedTitle(q, names, DEFAULT_SETTINGS.statuses, today) };
};
const kitchen = paths.get('Kitchen renovation') ?? '';

describe('an empty block reads its note', () => {
	it('in a Matter note: its open Actions, in card order', () => {
		const r = run('', { path: kitchen, kind: 'matter' });
		expect(r.head).toBe('Open Actions · Kitchen renovation');
		expect(r.total).toBe(7);
		expect(r.titles[0]).toBe('Confirm the worktop measurements');
		expect(r.titles).not.toContain('Pick up paint samples');
		expect(r.q.context).toBe('matter');
	});

	it('in a person note: the open Actions with them, waiting first', () => {
		const charlie = [...paths.entries()].find(([n]) => n.startsWith('Charlie'))?.[1] ?? '';
		const r = run('', { path: charlie, kind: 'person' });
		expect(r.head).toBe(`Open Actions · with ${base(charlie)}`);
		expect(r.titles[0]).toBe('Revised quote from Charlie');
	});

	it('anywhere else: due today or late', () => {
		const r = run('');
		expect(r.head).toBe('Due today or late');
		expect(r.titles).toContain('Confirm the worktop measurements');
		expect(r.titles).toContain('Visit the tile showroom');
		expect(r.titles).not.toContain('Order the worktop');
	});
});

describe('tokens and words', () => {
	it('narrows by Matter and type, and widens within a kind', () => {
		expect(run('#Kitchen renovation /buy').titles.sort()).toEqual(['Choose cabinet handles', 'Order the worktop']);
		const two = run('#Kitchen renovation #Household admin /call');
		expect(two.head).toBe('Open Actions · Kitchen renovation, Household admin · Call');
		expect(two.titles).toContain('Renew the home insurance');
	});

	it('reads waiting on a person', () => {
		const r = run('@Charlie waiting');
		expect(r.head.startsWith('Waiting on Charlie')).toBe(true);
		expect(r.titles).toEqual(['Revised quote from Charlie']);
	});

	it('reads today the same as a word or a date', () => {
		expect(run('today').titles).toEqual(run('').titles);
		expect(run('/call today').head).toBe('Due today or late · Call');
	});

	it('reads the status words', () => {
		expect(run('next').head).toBe('Next');
		expect(run('next').total).toBe(16);
		expect(run('next').titles).toHaveLength(EMBED_LIMIT);
		expect(run('done #Kitchen renovation').titles.sort()).toEqual(['Pick up paint samples', 'Sketch the new layout']);
		expect(run('late').titles.every((t) => t !== 'Order the worktop')).toBe(true);
		expect(run('someday').head).toBe('Later');
	});

	it('reads a date as due by, and a range as due within', () => {
		const by = run('#Kitchen renovation monday');
		expect(by.head).toBe('Due by Monday · Kitchen renovation');
		expect(by.titles).toContain('Visit the tile showroom');
		expect(by.titles).not.toContain('Site meeting with Charlie');
	});

	it('shows what matches nothing and does not apply it', () => {
		const r = run('#Garden shed /call watiing');
		expect(r.q.invalid).toEqual(['#Garden shed', 'watiing']);
		expect(r.head).toBe('Open Actions · Call');
		expect(r.titles).toContain('Find a sailing school');
	});

	it('keeps the valid tokens for quick add', () => {
		expect(run('#Kitchen renovation /call today').q.prefill).toBe('#Kitchen renovation /call');
	});
});
