// What the setup wizard will create and modify. Pure: the summary step renders this plan
// and the runner executes it, so the summary always matches what is written.
// Setup never overwrites a file: existing files are reused or, for Matter names, adopted.

import type { MattersSettings, StatusDef, TypeDef } from '../settings';
import { sanitiseTitle, uniqueTitle } from '../model/titles';
import { normalise } from './fuzzy';
import { samplePlan } from './samplePackage';

export type Folders = MattersSettings['folders'];

export { SAMPLE_FOLDER } from './samplePackage';
export const INBOX_NAME = 'Inbox';
export const BOARD_NAME = 'Matters';

/** A link to another planned or existing note; the runner writes the shortest link text. */
export interface LinkTo {
	linkTo: string;
}

export type PlannedValue = string | number | boolean | LinkTo | LinkTo[];

export function isLinkTo(value: unknown): value is LinkTo {
	return typeof value === 'object' && value !== null && typeof (value as LinkTo).linkTo === 'string';
}

export interface PlannedNote {
	path: string;
	/** A board or a file is written as its body alone; the others are notes with frontmatter. */
	kind: 'matter' | 'inbox' | 'board' | 'action' | 'note' | 'file';
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
	/** Whether the note at the path is another MTM note (an Action): it is never adopted as a Matter. */
	isOtherKind?(path: string): boolean;
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
	for (const typed of matterNames(choices.newMatters)) {
		let path = joinPath(folders.matters, `${typed}.md`);
		// An Action with that name (Matters and Actions share a folder) keeps its note; the Matter gets "Name 2".
		if (vault.isOtherKind?.(path)) path = joinPath(folders.matters, `${uniqueTitle(typed, (t) => vault.exists(joinPath(folders.matters, `${t}.md`)))}.md`);
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
		if (path === inboxPath || vault.isMatter(path) || vault.isOtherKind?.(path)) continue;
		modify.push({ path, add: { 'mtm-kind': 'matter', 'mtm-state': 'active' } });
	}

	if (choices.sample)
		create.push(
			...samplePlan({ now: choices.now, statuses: choices.statuses, types: choices.types, inboxPath, laneOrder, exists: (p) => vault.exists(p) }),
		);

	const folderPaths = [folders.matters, folders.actions, folders.boards, folders.people, ...create.map((n) => parentOf(n.path))];
	return { folders: missingFolders(folderPaths.filter(Boolean), vault), create, modify, reuse, inboxPath, boardPath };
}
