// The sample package: a small, coherent life in Matters, written by setup's "sample content" option.
// One source for setup, development vaults and the documentation, which quotes its facts
// ("Alice is waited on in three Actions"); tests pin those facts, so change them only on purpose.
// Dates are days from the day it is written, so "today", "overdue" and long waits stay true whenever it is loaded.
// Pure: no Obsidian imports.

import type { SphereDef, StatusDef, TypeDef } from '../settings';
import { addDays, formatMtmDate, toYmd } from '../model/dates';
import type { LinkTo, PlannedNote, PlannedValue } from './setupPlan';

export const SAMPLE_FOLDER = 'MTM/Sample';
const FOLDERS = { matters: 'Matters', actions: 'Actions', people: 'People', notes: 'Notes' } as const;

/** Statuses and types the package is written for: the Default workflow. Other workflows get the closest match. */
export type SampleStatus = 'later' | 'next' | 'doing' | 'waiting' | 'done';
export type SampleType = 'call' | 'message' | 'write' | 'meet' | 'buy' | 'visit';

export const SAMPLE_SPHERES: readonly SphereDef[] = [
	{ id: 'home', label: 'Home', icon: 'house' },
	{ id: 'advisory', label: 'Advisory', icon: 'briefcase' },
	{ id: 'research', label: 'Research', icon: 'graduation-cap' },
	{ id: 'teaching', label: 'Teaching', icon: 'presentation' },
];

export interface SamplePerson {
	name: string;
	about: string;
}

export const SAMPLE_PEOPLE: readonly SamplePerson[] = [
	{ name: 'Alice Archer', about: 'Supervises the doctoral thesis.' },
	{ name: 'Bob Baker', about: 'Operations director at Lakeside, the advisory client.' },
	{ name: 'Charlie Carter', about: 'The builder doing the kitchen.' },
	{ name: 'Dave Dawson', about: 'Coordinates the research methods course.' },
	{ name: 'Eve Ellis', about: 'A student on the research methods course.' },
	{ name: 'Frank Foster', about: 'Accountant, for the household and the advisory practice.' },
	{ name: 'Grace Green', about: 'Co-author of the conference paper.' },
	{ name: 'Heidi Hughes', about: 'Organises the conference.' },
];

export interface SampleMatter {
	name: string;
	icon: string;
	sphere?: string;
	state: 'active' | 'dormant' | 'closed';
	review?: string;
	/** Days since the last review; absent = never reviewed. */
	reviewed?: number;
	outcome?: string;
	about: string;
}

export const SAMPLE_MATTERS: readonly SampleMatter[] = [
	{ name: 'Kitchen renovation', icon: 'hammer', sphere: 'home', state: 'active', review: '1w', reviewed: 3, outcome: 'A working kitchen before the winter holidays.', about: 'New units, worktop and tiles. Charlie is doing the work; ideas and measurements are in [[Kitchen ideas]].' },
	{ name: 'Household admin', icon: 'wallet', sphere: 'home', state: 'active', review: '1m', reviewed: 40, outcome: 'Bills paid on time and papers filed by the end of each month.', about: 'Bills, insurance and the tax return.' },
	{ name: 'Learn to sail', icon: 'sailboat', sphere: 'home', state: 'dormant', about: 'Parked until the spring.' },
	{ name: 'Lakeside strategy review', icon: 'briefcase', sphere: 'advisory', state: 'active', review: '1w', reviewed: 1, outcome: 'The board approves a three-year plan.', about: 'Advisory project for Lakeside. Bob is the contact.' },
	{ name: 'Advisory practice', icon: 'lightbulb', sphere: 'advisory', state: 'active', review: '2w', outcome: 'Every enquiry answered within a week.', about: 'Running the practice itself: enquiries, proposals, invoices.' },
	{ name: 'Doctoral thesis', icon: 'graduation-cap', sphere: 'research', state: 'active', review: '1w', reviewed: 5, outcome: 'A full draft ready for the examiners.', about: 'Alice supervises. The structure is in [[Thesis outline]].' },
	{ name: 'Conference paper', icon: 'file-text', sphere: 'research', state: 'active', review: '2w', reviewed: 10, outcome: 'The paper accepted and presented.', about: 'Written with Grace.' },
	{ name: 'Research methods course', icon: 'presentation', sphere: 'teaching', state: 'active', review: '1w', reviewed: 2, outcome: 'Twelve sessions taught, every assignment marked within a week.', about: 'Twelve weekly sessions. See [[Course syllabus]].' },
	{ name: 'Course redesign', icon: 'pencil-ruler', sphere: 'teaching', state: 'active', review: '1m', reviewed: 12, about: 'Rethinking the course for next year. Nothing is moving yet.' },
	{ name: 'Half marathon', icon: 'footprints', state: 'active', review: '1w', reviewed: 9, outcome: 'Finish in under two hours.', about: 'Training plan and race admin.' },
	{ name: 'Old blog', icon: 'rss', state: 'closed', about: 'Closed: the posts were exported.' },
];

export interface SampleNote {
	name: string;
	body: string;
}

export const SAMPLE_NOTES: readonly SampleNote[] = [
	{ name: 'Kitchen ideas', body: 'For [[Kitchen renovation]].\n\n- Pale oak worktop, matt white units\n- Tiles to the ceiling behind the hob\n- Keep the window wall clear\n\n![[Kitchen floor plan.svg]]\n' },
	{ name: 'Thesis outline', body: 'For [[Doctoral thesis]].\n\n1. Introduction\n2. Literature review\n3. Methods\n4. Findings\n5. Discussion\n' },
	{ name: 'Course syllabus', body: 'For [[Research methods course]].\n\nTwelve sessions: design, sampling, interviews, surveys, analysis, writing up.\n' },
	{ name: 'Lakeside interview notes', body: 'For [[Lakeside strategy review]].\n\nThemes so far: slow handovers between shifts, stock counted twice.\n' },
];

/** Non-note files, embedded from the notes and Actions (they show as attachments). */
export const SAMPLE_FILES: readonly SampleNote[] = [
	{
		name: 'Kitchen floor plan.svg',
		body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200"><rect x="10" y="10" width="300" height="180" fill="none" stroke="#888" stroke-width="4"/><rect x="10" y="10" width="300" height="40" fill="#e8dcc8"/><rect x="10" y="10" width="40" height="180" fill="#e8dcc8"/><rect x="200" y="186" width="70" height="8" fill="#9ccbe8"/><text x="160" y="120" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#666">Kitchen</text></svg>\n',
	},
];

export interface SampleAction {
	title: string;
	/** A Matter name, or null for the Inbox. */
	matter: string | null;
	type: SampleType;
	status: SampleStatus;
	priority?: 1 | 2 | 3;
	start?: number;
	/** Days from today, with an optional time. */
	due?: [number, string?];
	waitingOn?: string;
	/** Days since the wait began. */
	waitingSince?: number;
	/** People involved besides the one waited on (who is always included). */
	people?: string[];
	/** Days ago it was completed (closed Actions). */
	completed?: number;
	details: string;
	checklist?: [boolean, string][];
}

const K = 'Kitchen renovation';
const H = 'Household admin';
const L = 'Lakeside strategy review';
const A = 'Advisory practice';
const T = 'Doctoral thesis';
const C = 'Conference paper';
const R = 'Research methods course';
const D = 'Course redesign';
const M = 'Half marathon';

export const SAMPLE_ACTIONS: readonly SampleAction[] = [
	// Inbox: captured, not processed yet.
	{ title: 'Renew the passport', matter: null, type: 'visit', status: 'later', details: 'It expires in the spring.' },
	{ title: 'Ask Frank about the pension letter', matter: null, type: 'message', status: 'later', people: ['Frank Foster'], details: 'The letter that came last week.' },
	{ title: 'Book a dentist appointment', matter: null, type: 'call', status: 'later', due: [6], details: 'Check-up and clean.' },
	{ title: 'Farewell gift for Dave', matter: null, type: 'buy', status: 'later', details: 'Something for the department to sign.' },

	{ title: 'Confirm the worktop measurements', matter: K, type: 'call', status: 'next', priority: 1, due: [0, '10:00'], people: ['Charlie Carter'], details: 'Before the worktop is ordered.', checklist: [[true, 'Measure the window wall'], [false, 'Check the corner unit']] },
	{ title: 'Choose cabinet handles', matter: K, type: 'buy', status: 'later', priority: 3, details: 'Brushed brass or black.' },
	{ title: 'Order the worktop', matter: K, type: 'buy', status: 'doing', priority: 1, due: [3], details: 'Pale oak, see [[Kitchen ideas]].\n\n![[Kitchen floor plan.svg]]' },
	{ title: 'Revised quote from Charlie', matter: K, type: 'message', status: 'waiting', due: [2], waitingOn: 'Charlie Carter', waitingSince: 4, details: 'With the tiles included.' },
	{ title: 'Visit the tile showroom', matter: K, type: 'visit', status: 'next', due: [-2], details: 'Bring a sample of the worktop.' },
	{ title: 'Site meeting with Charlie', matter: K, type: 'meet', status: 'next', due: [7, '09:00'], people: ['Charlie Carter'], details: 'Walk through the plan for the first week.' },
	{ title: 'Stay away during the works', matter: K, type: 'visit', status: 'next', start: 10, due: [14], details: 'Five days without a kitchen.' },
	{ title: 'Pick up paint samples', matter: K, type: 'buy', status: 'done', completed: 6, details: 'Three shades of white.' },
	{ title: 'Sketch the new layout', matter: K, type: 'write', status: 'done', completed: 45, details: 'The first sketch, now in [[Kitchen ideas]].' },

	{ title: 'Tax return draft from Frank', matter: H, type: 'message', status: 'waiting', due: [10], waitingOn: 'Frank Foster', waitingSince: 9, details: 'He has all the documents.' },
	{ title: 'Pay the council tax', matter: H, type: 'buy', status: 'next', priority: 1, due: [-1], details: 'Second instalment.' },
	{ title: 'Renew the home insurance', matter: H, type: 'call', status: 'later', due: [20], details: 'Compare two quotes first.' },
	{ title: 'File the energy bills', matter: H, type: 'write', status: 'doing', details: 'Scan, name, file.', checklist: [[true, 'Electricity'], [false, 'Gas'], [false, 'Water']] },
	{ title: 'Cancel the gym membership', matter: H, type: 'call', status: 'done', completed: 2, details: 'Confirmation number noted.' },

	{ title: 'Find a sailing school', matter: 'Learn to sail', type: 'call', status: 'later', details: 'Weekend courses near the coast.' },

	{ title: 'Interview the operations team', matter: L, type: 'meet', status: 'doing', start: -1, due: [1], people: ['Bob Baker'], details: 'Notes in [[Lakeside interview notes]].' },
	{ title: 'Draft the market analysis', matter: L, type: 'write', status: 'next', priority: 1, start: 2, due: [4], details: 'Three competitors, two scenarios.' },
	{ title: 'Data export from Bob', matter: L, type: 'message', status: 'waiting', due: [-3], waitingOn: 'Bob Baker', waitingSince: 16, details: 'Twelve months of stock movements.' },
	{ title: 'Present the findings to the board', matter: L, type: 'meet', status: 'later', due: [21, '15:00'], people: ['Bob Baker'], details: 'Thirty minutes, then questions.' },
	{ title: 'Visit the Lakeside warehouse', matter: L, type: 'visit', status: 'next', due: [1], details: 'Morning shift change.' },
	{ title: 'Kick-off meeting with Bob', matter: L, type: 'meet', status: 'done', completed: 20, people: ['Bob Baker'], details: 'Scope and timeline agreed.' },

	{ title: 'Reply to the new enquiry', matter: A, type: 'message', status: 'next', priority: 2, due: [0], details: 'A small firm asking about a strategy review.' },
	{ title: "Send this month's invoices to Frank", matter: A, type: 'message', status: 'later', due: [9], people: ['Frank Foster'], details: 'Lakeside and the two smaller jobs.' },
	{ title: 'Update the services page', matter: A, type: 'write', status: 'later', details: 'Add the strategy reviews.' },
	{ title: 'Proposal for the pricing review', matter: A, type: 'write', status: 'done', completed: 12, details: 'Sent to the firm.' },

	{ title: 'Feedback on chapter 2', matter: T, type: 'message', status: 'waiting', waitingOn: 'Alice Archer', waitingSince: 20, details: 'The literature review.' },
	{ title: 'Signed progress report', matter: T, type: 'message', status: 'waiting', due: [8], waitingOn: 'Alice Archer', waitingSince: 6, details: 'Due to the graduate school.' },
	{ title: 'Approval of the ethics amendment', matter: T, type: 'write', status: 'waiting', waitingOn: 'Alice Archer', waitingSince: 2, details: 'For the second round of interviews.' },
	{ title: 'Write the methods chapter', matter: T, type: 'write', status: 'doing', priority: 1, start: -7, due: [12], details: 'Following [[Thesis outline]].', checklist: [[true, 'Sampling'], [false, 'Instruments'], [false, 'Limitations']] },
	{ title: 'Meet Alice to plan chapter 4', matter: T, type: 'meet', status: 'next', due: [3, '11:30'], people: ['Alice Archer'], details: 'Bring the first findings.' },
	{ title: 'Call the library about the loan', matter: T, type: 'call', status: 'next', due: [2], details: 'The interlibrary loan is late.' },
	{ title: 'Buy the statistics textbook', matter: T, type: 'buy', status: 'later', priority: 3, details: 'Second-hand is fine.' },
	{ title: 'Visit the university archive', matter: T, type: 'visit', status: 'later', start: 25, due: [26], details: 'Two days with the original records.' },
	{ title: 'Submit the annual review form', matter: T, type: 'write', status: 'done', completed: 33, details: 'Accepted.' },

	{ title: 'Revise the paper with Grace', matter: C, type: 'write', status: 'doing', priority: 2, due: [6], people: ['Grace Green'], details: 'Answer the reviewers point by point.' },
	{ title: 'Register for the conference', matter: C, type: 'buy', status: 'done', completed: 8, people: ['Heidi Hughes'], details: 'Early rate.' },
	{ title: 'Confirm the session slot with Heidi', matter: C, type: 'message', status: 'done', completed: 3, people: ['Heidi Hughes'], details: 'Second day, morning.' },
	{ title: 'Book the hotel', matter: C, type: 'buy', status: 'next', priority: 2, due: [15], details: 'Walking distance from the venue.' },
	{ title: 'Rehearse the talk with Grace', matter: C, type: 'meet', status: 'later', due: [18, '17:00'], people: ['Grace Green'], details: 'Twenty minutes, timed.' },
	{ title: 'Travel to the conference', matter: C, type: 'visit', status: 'later', start: 24, due: [27], details: 'Train there and back.' },

	{ title: 'Mark the first assignment', matter: R, type: 'write', status: 'doing', priority: 1, due: [1], details: 'Rubric in the [[Course syllabus]].', checklist: [[true, 'Group A'], [true, 'Group B'], [false, 'Group C'], [false, 'Group D']] },
	{ title: "Answer Eve's question about the essay", matter: R, type: 'message', status: 'next', priority: 2, due: [-1], people: ['Eve Ellis'], details: 'Can the essay use secondary data?' },
	{ title: 'Room change from Dave', matter: R, type: 'message', status: 'waiting', waitingOn: 'Dave Dawson', waitingSince: 3, details: 'The current room has no projector.' },
	{ title: 'Prepare session 5 slides', matter: R, type: 'write', status: 'next', due: [6], details: 'Surveys and questionnaires.' },
	{ title: 'Teach session 5', matter: R, type: 'meet', status: 'next', due: [7, '10:00'], details: 'Room to be confirmed.' },
	{ title: 'Teach session 4', matter: R, type: 'meet', status: 'done', completed: 1, details: 'Interviews.' },
	{ title: 'Call Eve about her extension', matter: R, type: 'call', status: 'done', completed: 4, people: ['Eve Ellis'], details: 'One week granted.' },

	{ title: "Collect feedback from last year's students", matter: D, type: 'write', status: 'later', details: 'A short survey.' },
	{ title: 'Discuss the new module with Dave', matter: D, type: 'meet', status: 'later', people: ['Dave Dawson'], details: 'After the term ends.' },
	{ title: 'Read the curriculum guidelines', matter: D, type: 'write', status: 'done', completed: 15, details: 'Notes taken.' },

	{ title: 'Register for the race', matter: M, type: 'buy', status: 'next', priority: 1, due: [3], details: 'Places are running out.' },
	{ title: 'Long run along the river', matter: M, type: 'visit', status: 'next', due: [2, '08:00'], details: 'Eighteen kilometres, easy pace.' },
	{ title: 'Buy running shoes', matter: M, type: 'buy', status: 'done', completed: 10, details: 'Half a size up.' },

	{ title: 'Export the old posts', matter: 'Old blog', type: 'write', status: 'done', completed: 60, details: 'Saved as Markdown.' },
];

// ——— Writing the package ———

/** The closest status in another workflow: the same ID, else the backlog or done flag, else the first of the same category. */
export function sampleStatus(id: SampleStatus, statuses: readonly StatusDef[]): StatusDef | undefined {
	const same = statuses.find((s) => s.id === id);
	if (same) return same;
	if (id === 'later') return statuses.find((s) => s.backlog);
	if (id === 'done') return statuses.find((s) => s.done);
	const category = id === 'next' ? 'open' : 'active';
	return statuses.find((s) => s.category === category && !s.backlog) ?? statuses.find((s) => s.backlog);
}

/** The same type, else the default one. */
export function sampleType(id: SampleType, types: readonly TypeDef[]): TypeDef | undefined {
	return types.find((t) => t.id === id) ?? types.find((t) => t.default);
}

/** The settings' Spheres plus the package's ones they lack (matched by ID). */
export function withSampleSpheres(spheres: readonly SphereDef[]): SphereDef[] {
	return [...spheres, ...SAMPLE_SPHERES.filter((s) => !spheres.some((x) => x.id === s.id))];
}

export interface SampleContext {
	now: Date;
	statuses: readonly StatusDef[];
	types: readonly TypeDef[];
	inboxPath: string;
	/** Lane orders continue after this one. */
	laneOrder: number;
	exists(path: string): boolean;
}

export const samplePath = (folder: keyof typeof FOLDERS, name: string) => `${SAMPLE_FOLDER}/${FOLDERS[folder]}/${name}`;

/** Every note and file of the package, ready for the setup runner. Existing paths get " 2", " 3"… */
export function samplePlan(ctx: SampleContext): PlannedNote[] {
	const out: PlannedNote[] = [];
	const taken = new Set<string>();
	const free = (folder: keyof typeof FOLDERS, name: string, ext = '.md') => {
		let path = samplePath(folder, `${name}${ext}`);
		for (let n = 2; ctx.exists(path) || taken.has(path); n++) path = samplePath(folder, `${name} ${n}${ext}`);
		taken.add(path);
		return path;
	};
	const today = toYmd(ctx.now);
	const day = (offset: number) => addDays(today, offset);

	const people = new Map<string, string>();
	for (const p of SAMPLE_PEOPLE) {
		const path = free('people', p.name);
		people.set(p.name, path);
		out.push({ path, kind: 'note', sample: true, frontmatter: { 'mtm-sample': true }, body: `${p.about}\n` });
	}
	for (const n of SAMPLE_NOTES) out.push({ path: free('notes', n.name), kind: 'note', sample: true, frontmatter: { 'mtm-sample': true }, body: n.body });
	for (const f of SAMPLE_FILES) out.push({ path: free('notes', f.name, ''), kind: 'file', sample: true, frontmatter: {}, body: f.body });

	const matters = new Map<string, string>();
	let laneOrder = ctx.laneOrder;
	for (const m of SAMPLE_MATTERS) {
		const path = free('matters', m.name);
		matters.set(m.name, path);
		const fm: Record<string, PlannedValue> = { 'mtm-kind': 'matter', 'mtm-icon': m.icon, 'mtm-state': m.state, 'mtm-lane-order': ++laneOrder };
		if (m.sphere) fm['mtm-sphere'] = m.sphere;
		if (m.review) fm['mtm-review-every'] = m.review;
		if (m.reviewed !== undefined) fm['mtm-last-reviewed'] = day(-m.reviewed);
		if (m.outcome) fm['mtm-outcome'] = m.outcome;
		fm['mtm-sample'] = true;
		out.push({ path, kind: 'matter', sample: true, frontmatter: fm, body: `${m.about}\n` });
	}

	const link = (path: string | undefined): LinkTo => ({ linkTo: path ?? '' });
	for (const a of SAMPLE_ACTIONS) {
		const status = sampleStatus(a.status, ctx.statuses);
		const type = sampleType(a.type, ctx.types);
		if (!status || !type) continue;
		const fm: Record<string, PlannedValue> = {
			'mtm-kind': 'action',
			'mtm-type': type.id,
			'mtm-status': status.id,
			'mtm-matter': link(a.matter === null ? ctx.inboxPath : matters.get(a.matter)),
		};
		if (a.start !== undefined) fm['mtm-start'] = day(a.start);
		if (a.due) fm['mtm-due'] = formatMtmDate(a.due[1] ? { date: day(a.due[0]), time: a.due[1] } : { date: day(a.due[0]) });
		if (a.priority) fm['mtm-priority'] = a.priority;
		if (a.waitingOn) fm['mtm-waiting-on'] = link(people.get(a.waitingOn));
		const involved = [...(a.waitingOn ? [a.waitingOn] : []), ...(a.people ?? []).filter((p) => p !== a.waitingOn)];
		if (involved.length) fm['mtm-people'] = involved.map((p) => link(people.get(p)));
		if (a.waitingOn && a.waitingSince !== undefined) fm['mtm-waiting-since'] = day(-a.waitingSince);
		if (status.category === 'closed') fm['mtm-completed'] = day(-(a.completed ?? 0));
		fm['mtm-sample'] = true;
		const checklist = a.checklist?.map(([done, text]) => `- [${done ? 'x' : ' '}] ${text}`).join('\n');
		out.push({ path: free('actions', a.title), kind: 'action', sample: true, frontmatter: fm, body: `${a.details}\n${checklist ? `\n${checklist}\n` : ''}` });
	}
	return out;
}

/** Non-note files the package adds (Remove sample content trashes them too). */
export const SAMPLE_FILE_PATHS: readonly string[] = SAMPLE_FILES.map((f) => samplePath('notes', f.name));

/** How much the package adds, for setup's summary. */
export const SAMPLE_COUNTS = {
	matters: SAMPLE_MATTERS.length,
	actions: SAMPLE_ACTIONS.length,
	people: SAMPLE_PEOPLE.length,
	notes: SAMPLE_NOTES.length + SAMPLE_FILES.length,
} as const;

/**
 * After removing the sample: the settings' Spheres without the package's ones that no Matter uses and that the user
 * hasn't changed (same ID, label and icon). A Sphere of the user's own is never removed.
 */
export function spheresWithoutSample(spheres: readonly SphereDef[], used: ReadonlySet<string>): SphereDef[] {
	return spheres.filter((s) => {
		const sample = SAMPLE_SPHERES.find((x) => x.id === s.id);
		return !sample || used.has(s.id) || sample.label !== s.label || sample.icon !== s.icon;
	});
}
