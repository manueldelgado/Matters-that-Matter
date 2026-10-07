// What the setup wizard will create and modify. Pure: the summary step renders this plan
// and the runner executes it, so the summary always matches what is written.
// Setup never overwrites a file: existing files are reused or, for Matter names, adopted.

import type { MattersSettings, StatusDef, TypeDef } from '../settings';
import { sanitiseTitle } from '../model/titles';
import { formatMtmDate, addDays, toYmd, type MtmDate } from '../model/dates';
import { normalise } from './fuzzy';

export type Folders = MattersSettings['folders'];

export const SAMPLE_FOLDER = 'MTM/Sample';
export const INBOX_NAME = 'Inbox';
export const BOARD_NAME = 'Matters';

/** A link to another planned or existing note; the runner writes the shortest link text. */
export interface LinkTo {
	linkTo: string;
}

export type PlannedValue = string | number | boolean | LinkTo;

export function isLinkTo(value: unknown): value is LinkTo {
	return typeof value === 'object' && value !== null && typeof (value as LinkTo).linkTo === 'string';
}

export interface PlannedNote {
	path: string;
	kind: 'matter' | 'inbox' | 'board' | 'action';
	frontmatter: Record<string, PlannedValue>;
	body: string;
	sample?: boolean;
}

export interface PlannedChange {
	path: string;
	add: Record<string, PlannedValue>;
}

export interface SetupPlan {
	folders: string[];
	create: PlannedNote[];
	modify: PlannedChange[];
	/** Existing files used as they are (the Inbox, the board, Matters that already exist). */
	reuse: string[];
	inboxPath: string;
	boardPath: string;
}

export interface SetupChoices {
	folders: Folders;
	statuses: StatusDef[];
	types: TypeDef[];
	/** Text of the "New Matters" box: one name per line. */
	newMatters: string;
	/** Paths of existing notes to adopt as Matters. */
	adopt: string[];
	sample: boolean;
	/** Current settings paths: reused when the files still exist. */
	inboxPath: string;
	boardPath: string;
	baseContent: string;
	now: Date;
}

export interface VaultSnapshot {
	/** Whether a file or folder exists at the path. */
	exists(path: string): boolean;
	/** Whether the note at the path already has mtm-kind: matter. */
	isMatter(path: string): boolean;
	/** The highest mtm-lane-order among existing Matters, or null. */
	maxLaneOrder: number | null;
}

export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** Every folder level that does not exist yet, parents first. */
function missingFolders(paths: readonly string[], vault: VaultSnapshot): string[] {
	const out: string[] = [];
	for (const path of paths) {
		const parts = path.split('/').filter(Boolean);
		for (let i = 1; i <= parts.length; i++) {
			const level = parts.slice(0, i).join('/');
			if (!vault.exists(level) && !out.includes(level)) out.push(level);
		}
	}
	return out;
}

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Matter names from the text box: sanitised, without blanks or duplicates. */
export function matterNames(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const line of text.split('\n')) {
		const name = sanitiseTitle(line);
		const key = normalise(name);
		if (!name || seen.has(key)) continue;
		seen.add(key);
		out.push(name);
	}
	return out;
}

export function planSetup(choices: SetupChoices, vault: VaultSnapshot): SetupPlan {
	const { folders } = choices;
	const create: PlannedNote[] = [];
	const modify: PlannedChange[] = [];
	const reuse: string[] = [];

	const inboxPath = vault.exists(choices.inboxPath) ? choices.inboxPath : joinPath(folders.matters, `${INBOX_NAME}.md`);
	const boardPath = vault.exists(choices.boardPath) ? choices.boardPath : joinPath(folders.boards, `${BOARD_NAME}.base`);

	if (vault.exists(inboxPath)) reuse.push(inboxPath);
	else
		create.push({
			path: inboxPath,
			kind: 'inbox',
			frontmatter: { 'mtm-kind': 'matter', 'mtm-icon': 'inbox', 'mtm-state': 'active' },
			body: '',
		});

	if (vault.exists(boardPath)) reuse.push(boardPath);
	else create.push({ path: boardPath, kind: 'board', frontmatter: {}, body: choices.baseContent });

	let laneOrder = vault.maxLaneOrder === null ? 0 : Math.floor(vault.maxLaneOrder);
	const adopt = new Set(choices.adopt);
	for (const name of matterNames(choices.newMatters)) {
		const path = joinPath(folders.matters, `${name}.md`);
		if (path === inboxPath || vault.isMatter(path)) reuse.push(path);
		else if (vault.exists(path)) adopt.add(path);
		else
			create.push({
				path,
				kind: 'matter',
				frontmatter: { 'mtm-kind': 'matter', 'mtm-state': 'active', 'mtm-lane-order': ++laneOrder },
				body: '',
			});
	}
	for (const path of adopt) {
		if (path === inboxPath || vault.isMatter(path)) continue;
		modify.push({ path, add: { 'mtm-kind': 'matter', 'mtm-state': 'active' } });
	}

	if (choices.sample) create.push(...sampleNotes(choices, vault, laneOrder));

	const folderPaths = [folders.matters, folders.actions, folders.boards, folders.people, ...create.map((n) => parentOf(n.path))];
	return { folders: missingFolders(folderPaths.filter(Boolean), vault), create, modify, reuse, inboxPath, boardPath };
}

// ——— Sample content ———

interface SampleAction {
	title: string;
	type: string;
	matter: 0 | 1;
	priority?: 1 | 2 | 3;
	/** Days from today, with an optional time. */
	due?: [number, string?];
	start?: number;
	details: string;
}

const SAMPLE_MATTERS = [
	{ name: 'Kitchen renovation', icon: 'hammer', review: '1w', about: 'A sample Matter. Every lane on the board is a Matter note like this one.' },
	{ name: 'Weekend in Porto', icon: 'plane', review: '2w', about: 'A sample Matter with a few dated Actions for the calendar and timeline.' },
];

const SAMPLE_ACTIONS: SampleAction[] = [
	{ title: 'Call the plumber about the sink', type: 'call', matter: 0, priority: 1, due: [0, '10:00'], details: 'Ask whether the old pipes can stay.' },
	{ title: 'Message Ana about the tiles', type: 'message', matter: 0, due: [2], details: 'She has the supplier’s catalogue.' },
	{ title: 'Write the list of appliances', type: 'write', matter: 0, details: 'Oven, hob, fridge, dishwasher.' },
	{ title: 'Meet the kitchen designer', type: 'meet', matter: 0, priority: 2, due: [3, '16:00'], details: 'Bring the measurements.' },
	{ title: 'Buy paint samples', type: 'buy', matter: 0, priority: 2, due: [-1], details: 'Three shades of white.' },
	{ title: 'Visit the showroom', type: 'visit', matter: 0, due: [-2], details: 'Check the opening hours first.' },
	{ title: 'Book the train to Porto', type: 'buy', matter: 1, priority: 1, due: [5], details: 'Window seats if possible.' },
	{ title: 'Walk along the river', type: 'visit', matter: 1, start: 10, due: [11], details: 'A two-day Action: it spans the dates on the calendar and timeline.' },
];

function sampleNotes(choices: SetupChoices, vault: VaultSnapshot, laneOrder: number): PlannedNote[] {
	const notes: PlannedNote[] = [];
	const free = (name: string) => {
		let path = joinPath(SAMPLE_FOLDER, `${name}.md`);
		for (let n = 2; vault.exists(path); n++) path = joinPath(SAMPLE_FOLDER, `${name} ${n}.md`);
		return path;
	};

	const matterPaths = SAMPLE_MATTERS.map((m) => {
		const path = free(m.name);
		notes.push({
			path,
			kind: 'matter',
			sample: true,
			frontmatter: {
				'mtm-kind': 'matter',
				'mtm-icon': m.icon,
				'mtm-state': 'active',
				'mtm-lane-order': ++laneOrder,
				'mtm-review-every': m.review,
				'mtm-sample': true,
			},
			body: `${m.about}\n`,
		});
		return path;
	});

	const today = toYmd(choices.now);
	const date = (days: number, time?: string): string => {
		const d: MtmDate = time ? { date: addDays(today, days), time } : { date: addDays(today, days) };
		return formatMtmDate(d);
	};
	const { statuses, types } = choices;

	SAMPLE_ACTIONS.forEach((a, i) => {
		// Cycle through the workflow so every status and type appears.
		const status = statuses[i % statuses.length];
		const type = types.find((t) => t.id === a.type) ?? types[i % types.length];
		if (!status || !type) return;
		const fm: Record<string, PlannedValue> = {
			'mtm-kind': 'action',
			'mtm-type': type.id,
			'mtm-status': status.id,
			'mtm-matter': { linkTo: matterPaths[a.matter] ?? '' },
		};
		if (a.start !== undefined) fm['mtm-start'] = date(a.start);
		if (a.due) fm['mtm-due'] = date(a.due[0], a.due[1]);
		if (a.priority) fm['mtm-priority'] = a.priority;
		if (status.category === 'closed') fm['mtm-completed'] = today;
		fm['mtm-sample'] = true;
		notes.push({ path: free(a.title), kind: 'action', sample: true, frontmatter: fm, body: `${a.details}\n\n- [ ] A checklist item\n` });
	});
	return notes;
}
