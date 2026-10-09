import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings';
import {
	SAMPLE_ACTIONS,
	SAMPLE_COUNTS,
	SAMPLE_MATTERS,
	SAMPLE_NOTES,
	SAMPLE_PEOPLE,
	SAMPLE_SPHERES,
	samplePlan,
	sampleStatus,
	sampleType,
	sampleTypeFallbacks,
	spheresWithoutSample,
	withSampleSpheres,
} from '../../src/services/samplePackage';
import { presetStatuses, presetTypes } from '../../src/services/presets';
import { sanitiseTitle } from '../../src/model/titles';

// The documentation quotes these facts. If one of these tests fails, the change breaks the docs:
// update both on purpose, or keep the package as it is.

const open = SAMPLE_ACTIONS.filter((a) => a.status !== 'done');
const titles = (list: readonly { title: string }[]) => list.map((a) => a.title).sort();

describe('sample package: what the documentation relies on', () => {
	it('has its size', () => {
		expect(SAMPLE_COUNTS).toEqual({ matters: 11, actions: 58, people: 8, notes: 5 });
		expect(SAMPLE_SPHERES.map((s) => s.label)).toEqual(['Home', 'Advisory', 'Research', 'Teaching']);
		expect(SAMPLE_PEOPLE.map((p) => p.name.split(' ')[0])).toEqual(['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi']);
	});

	it('groups the Matters by Sphere', () => {
		const inSphere = (id?: string) => SAMPLE_MATTERS.filter((m) => m.sphere === id).map((m) => m.name);
		expect(inSphere('home')).toEqual(['Kitchen renovation', 'Household admin', 'Learn to sail']);
		expect(inSphere('advisory')).toEqual(['Lakeside strategy review', 'Advisory practice']);
		expect(inSphere('research')).toEqual(['Doctoral thesis', 'Conference paper']);
		expect(inSphere('teaching')).toEqual(['Research methods course', 'Course redesign']);
		expect(inSphere(undefined)).toEqual(['Half marathon', 'Old blog']);
	});

	it('has one dormant and one closed Matter', () => {
		expect(SAMPLE_MATTERS.filter((m) => m.state === 'dormant').map((m) => m.name)).toEqual(['Learn to sail']);
		expect(SAMPLE_MATTERS.filter((m) => m.state === 'closed').map((m) => m.name)).toEqual(['Old blog']);
	});

	it('has four open Actions in the Inbox', () => {
		expect(open.filter((a) => a.matter === null)).toHaveLength(4);
	});

	it('waits on Alice in three Actions, two of them for 14 days or more across the package', () => {
		expect(titles(open.filter((a) => a.waitingOn === 'Alice Archer'))).toEqual(['Approval of the ethics amendment', 'Feedback on chapter 2', 'Signed progress report']);
		expect(titles(open.filter((a) => (a.waitingSince ?? 0) >= 14))).toEqual(['Data export from Bob', 'Feedback on chapter 2']);
		expect(open.filter((a) => a.waitingOn)).toHaveLength(7);
	});

	it('has four overdue Actions and two due today', () => {
		expect(titles(open.filter((a) => a.due && a.due[0] < 0))).toEqual(["Answer Eve's question about the essay", 'Data export from Bob', 'Pay the council tax', 'Visit the tile showroom']);
		expect(titles(open.filter((a) => a.due && a.due[0] === 0))).toEqual(['Confirm the worktop measurements', 'Reply to the new enquiry']);
	});

	it('has nothing open with Heidi: two done Actions, the last three days ago', () => {
		const heidi = SAMPLE_ACTIONS.filter((a) => a.people?.includes('Heidi Hughes') || a.waitingOn === 'Heidi Hughes');
		expect(heidi.every((a) => a.status === 'done')).toBe(true);
		expect(heidi.map((a) => a.completed).sort()).toEqual([3, 8]);
	});

	it('leaves Course redesign without a next Action', () => {
		const moving = SAMPLE_ACTIONS.filter((a) => a.matter === 'Course redesign' && a.status !== 'later' && a.status !== 'done');
		expect(moving).toEqual([]);
		// Every other active Matter has one.
		for (const m of SAMPLE_MATTERS.filter((x) => x.state === 'active' && x.name !== 'Course redesign')) {
			expect(SAMPLE_ACTIONS.some((a) => a.matter === m.name && a.status !== 'later' && a.status !== 'done')).toBe(true);
		}
	});

	it('reviews: Household admin and Half marathon are late, Advisory practice never reviewed', () => {
		const days = { '1w': 7, '2w': 14, '1m': 30 } as Record<string, number>;
		const late = SAMPLE_MATTERS.filter((m) => m.state === 'active' && m.review && (m.reviewed === undefined || m.reviewed > (days[m.review] ?? 0)));
		expect(late.map((m) => m.name)).toEqual(['Household admin', 'Advisory practice', 'Half marathon']);
		expect(SAMPLE_MATTERS.find((m) => m.name === 'Advisory practice')?.reviewed).toBeUndefined();
	});

	it('uses every status and type, and names every person', () => {
		expect(new Set(SAMPLE_ACTIONS.map((a) => a.status))).toEqual(new Set(['later', 'next', 'doing', 'waiting', 'done']));
		expect(new Set(SAMPLE_ACTIONS.map((a) => a.type))).toEqual(new Set(['call', 'message', 'write', 'meet', 'buy', 'visit']));
		for (const p of SAMPLE_PEOPLE) expect(SAMPLE_ACTIONS.some((a) => a.waitingOn === p.name || a.people?.includes(p.name))).toBe(true);
	});

	it('is internally consistent: Matters, people and linked notes exist, titles are unique', () => {
		const matters = new Set(SAMPLE_MATTERS.map((m) => m.name));
		const people = new Set(SAMPLE_PEOPLE.map((p) => p.name));
		const notes = new Set([...SAMPLE_NOTES.map((n) => n.name), ...matters]);
		for (const a of SAMPLE_ACTIONS) {
			if (a.matter !== null) expect(matters.has(a.matter)).toBe(true);
			for (const p of [...(a.people ?? []), ...(a.waitingOn ? [a.waitingOn] : [])]) expect(people.has(p)).toBe(true);
			for (const [, name] of a.details.matchAll(/\[\[([^\]|]+)\]\]/g)) if (!name?.endsWith('.svg')) expect(notes.has(name ?? '')).toBe(true);
			expect(a.waitingOn === undefined || a.status === 'waiting').toBe(true);
			expect(a.completed === undefined || a.status === 'done').toBe(true);
		}
		expect(new Set(SAMPLE_ACTIONS.map((a) => a.title)).size).toBe(SAMPLE_ACTIONS.length);
	});

	it('uses names Obsidian accepts as file names', () => {
		const names = [...SAMPLE_ACTIONS.map((a) => a.title), ...SAMPLE_MATTERS.map((m) => m.name), ...SAMPLE_PEOPLE.map((p) => p.name), ...SAMPLE_NOTES.map((n) => n.name)];
		for (const name of names) expect(sanitiseTitle(name)).toBe(name);
	});
});

describe('sample package in another workflow', () => {
	it('maps statuses by ID, then by flag, then by category', () => {
		const next = presetStatuses('next');
		expect(sampleStatus('later', next)?.backlog).toBe(true);
		expect(sampleStatus('done', next)?.done).toBe(true);
		const simple = presetStatuses('simple');
		expect(sampleStatus('next', simple)?.id).toBe(simple.find((s) => s.backlog)?.id);
		expect(sampleStatus('waiting', simple)?.category).toBe('active');
	});

	it('keeps its own types with the default types', () => {
		for (const id of ['call', 'message', 'write', 'meet', 'buy', 'visit'] as const) expect(sampleType(id, DEFAULT_SETTINGS.types)?.id).toBe(id);
		expect(sampleTypeFallbacks(DEFAULT_SETTINGS.types)).toBe(0);
	});

	it('maps to the contexts of "Get stuff done"', () => {
		const contexts = presetTypes('next');
		const map = Object.fromEntries((['call', 'message', 'write', 'meet', 'buy', 'visit'] as const).map((id) => [id, sampleType(id, contexts)?.id]));
		expect(map).toEqual({ call: 'calls', message: 'computer', write: 'computer', meet: 'agendas', buy: 'errands', visit: 'errands' });
		expect(sampleTypeFallbacks(contexts)).toBe(0);
	});

	it('follows type IDs, so renamed or recoloured types still map', () => {
		const renamed = presetTypes('next').map((t) => ({ ...t, label: `My ${t.label}`, tone: 'ink' as const }));
		expect(sampleType('meet', renamed)?.id).toBe('agendas');
		expect(sampleTypeFallbacks(renamed)).toBe(0);
	});

	it('falls back to the default type for missing types, and counts them for the warning', () => {
		const noVisit = DEFAULT_SETTINGS.types.filter((t) => t.id !== 'visit');
		expect(sampleType('visit', noVisit)?.default).toBe(true);
		expect(sampleTypeFallbacks(noVisit)).toBe(SAMPLE_ACTIONS.filter((a) => a.type === 'visit').length);
		const custom = [{ id: 'deep-work', label: 'Deep work', icon: 'brain', tone: 'sky' as const, default: true }];
		expect(sampleType('call', custom)?.id).toBe('deep-work');
		expect(sampleTypeFallbacks(custom)).toBe(SAMPLE_ACTIONS.length);
	});

	it('writes every Action whatever the workflow', () => {
		const notes = samplePlan({ now: new Date(2026, 9, 9), statuses: presetStatuses('simple'), types: presetTypes('next'), inboxPath: 'Inbox.md', laneOrder: 0, exists: () => false });
		expect(notes.filter((n) => n.kind === 'action')).toHaveLength(SAMPLE_ACTIONS.length);
	});
});

describe('sample Spheres in settings', () => {
	it('adds the missing ones, keeping the user’s', () => {
		const mine = { id: 'home', label: 'Casa', icon: 'house' };
		expect(withSampleSpheres([mine]).map((s) => s.id)).toEqual(['home', 'advisory', 'research', 'teaching']);
		expect(withSampleSpheres([mine])[0]).toBe(mine);
	});

	it('removes unused, unchanged sample Spheres only', () => {
		const changed = { id: 'teaching', label: 'Classes', icon: 'presentation' };
		const spheres = [...SAMPLE_SPHERES.slice(0, 3), changed, { id: 'family', label: 'Family', icon: 'heart' }];
		expect(spheresWithoutSample(spheres, new Set(['research'])).map((s) => s.id)).toEqual(['research', 'teaching', 'family']);
	});
});
