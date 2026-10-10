// What MTM notes hold and what they mean, from plain data: the frontmatter of new Actions and Matters,
// the Matter list with the Inbox, people and the notes and files an Action links to. Pure: the vault
// layer passes paths, frontmatter and resolved link targets in.

import type { MattersSettings, StatusDef } from '../settings';
import type { Priority } from '../model/actions';
import type { Ymd } from '../model/dates';
import { matterState, parseCadence, parseLaneOrder, parseOutcome, reviewInfo, type Lane } from '../model/matters';
import type { ActionItem } from './actionItems';
import type { MatterInfo } from './boardModel';
import { linkText } from './effective';
import type { PersonEntry } from './personModel';
import type { NoteCandidate } from './quickAddParser';
import { effectiveSphere } from './spheres';

export type Frontmatter = Record<string, unknown>;

export const DEFAULT_MATTER_ICON = 'circle-dot';

/** A note as these rules need it: its path, its name without the extension, and its frontmatter. */
export interface NoteData {
	path: string;
	basename: string;
	frontmatter: Readonly<Frontmatter> | undefined;
}

/** A link target: anything with a path and an extension (a vault file, or its stand-in). */
export interface LinkTarget {
	path: string;
	extension: string;
}

/** Resolves link text (without a heading) to its target, or null. */
export type ResolveTarget<T extends { path: string } = { path: string }> = (linkpath: string) => T | null;

// ——— New notes ———

/**
 * The link written in mtm-matter: the shortest link text when the Matter note exists,
 * otherwise the bare name of its path.
 */
export function matterLink(matterPath: string, linktext: string | null): string {
	if (linktext !== null) return `[[${linktext}]]`;
	return `[[${matterPath.split('/').pop()?.replace(/\.md$/i, '') ?? matterPath}]]`;
}

export interface NewActionNote {
	statusId: string;
	typeId: string;
	/** As written in mtm-matter (see matterLink). */
	matterLink: string;
	priority?: Priority | null;
	/** As written: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
	start?: string | null;
	due?: string | null;
	/** As written in mtm-people: '[[link text]]'. */
	people?: readonly string[];
}

/** A new Action's frontmatter, keys in the order they are written. Status, type and Matter are always explicit. */
export function newActionFrontmatter(init: NewActionNote, statuses: readonly StatusDef[], today: Ymd): Frontmatter {
	const fm: Frontmatter = {
		'mtm-kind': 'action',
		'mtm-type': init.typeId,
		'mtm-status': init.statusId,
		'mtm-matter': init.matterLink,
	};
	if (init.start) fm['mtm-start'] = init.start;
	if (init.due) fm['mtm-due'] = init.due;
	if (init.priority) fm['mtm-priority'] = init.priority;
	if (init.people?.length) fm['mtm-people'] = [...init.people];
	if (statuses.find((s) => s.id === init.statusId)?.category === 'closed') fm['mtm-completed'] = today;
	return fm;
}

export interface NewMatterNote {
	icon: string;
	reviewEvery: string | null;
	sphereId?: string | null;
	outcome?: string | null;
}

/** A new, active Matter's frontmatter, keys in the order they are written. */
export function newMatterFrontmatter(init: NewMatterNote, laneOrder: number): Frontmatter {
	const fm: Frontmatter = {
		'mtm-kind': 'matter',
		'mtm-icon': init.icon,
		'mtm-state': 'active',
		'mtm-lane-order': laneOrder,
	};
	if (init.reviewEvery) fm['mtm-review-every'] = init.reviewEvery;
	if (init.sphereId) fm['mtm-sphere'] = init.sphereId;
	const outcome = parseOutcome(init.outcome);
	if (outcome) fm['mtm-outcome'] = outcome;
	return fm;
}

// ——— Matters ———

type MatterSettings = Pick<MattersSettings, 'inboxPath' | 'spheres'>;

export function matterInfo(note: NoteData, settings: MatterSettings, today: Ymd): MatterInfo {
	const fm = note.frontmatter ?? {};
	const isInbox = note.path === settings.inboxPath;
	const rawIcon = fm['mtm-icon'];
	const icon = typeof rawIcon === 'string' && rawIcon.trim() ? rawIcon.trim() : DEFAULT_MATTER_ICON;
	const state = isInbox ? 'active' : matterState(fm['mtm-state']);
	const cadence = parseCadence(fm['mtm-review-every']);
	const sphere = effectiveSphere(fm['mtm-sphere'], settings.spheres, isInbox);
	return {
		path: note.path,
		name: note.basename,
		laneOrder: parseLaneOrder(fm['mtm-lane-order']),
		isInbox,
		icon: isInbox && !rawIcon ? 'inbox' : icon,
		state,
		review: isInbox || !cadence ? null : reviewInfo(fm['mtm-review-every'], fm['mtm-last-reviewed'], today),
		sphere: sphere.id,
		sphereOrphan: sphere.orphan,
		outcome: isInbox ? null : parseOutcome(fm['mtm-outcome']),
	};
}

/** The Inbox's lane when its note is missing: named after its path. */
export function missingInbox(settings: Pick<MattersSettings, 'inboxPath'>): MatterInfo {
	const name = settings.inboxPath.split('/').pop()?.replace(/\.md$/i, '') ?? 'Inbox';
	return { path: settings.inboxPath, name, laneOrder: null, isInbox: true, icon: 'inbox', state: 'active', review: null, sphere: null, sphereOrphan: null, outcome: null };
}

/**
 * All Matters: the Matter notes (`mtm-kind: matter`), plus the Inbox even when its note (`inbox`, the note at
 * the Inbox path, or null when there is none) lost its mtm-kind, or a stand-in when the note is missing.
 */
export function matterList(matterNotes: readonly NoteData[], inbox: NoteData | null, settings: MatterSettings, today: Ymd): MatterInfo[] {
	const notes = [...matterNotes];
	if (inbox && !notes.some((n) => n.path === inbox.path)) notes.push(inbox);
	const matters = notes.map((n) => matterInfo(n, settings, today));
	if (!inbox) matters.push(missingInbox(settings));
	return matters;
}

/** The lanes counted for a new Matter's lane order: every Matter note, the Inbox marked so it doesn't count. */
export function laneOf(note: NoteData, inboxPath: string): Lane {
	return { path: note.path, name: note.basename, laneOrder: parseLaneOrder(note.frontmatter?.['mtm-lane-order']), isInbox: note.path === inboxPath };
}

// ——— People ———

/**
 * Identifies a person named in a frontmatter link: the resolved path, or the link text when it doesn't resolve.
 * Null for values that aren't links.
 */
export function personKey(raw: unknown, resolve: ResolveTarget): string | null {
	const text = linkText(raw);
	if (!text) return null;
	return resolve(text)?.path ?? text;
}

/** The note a frontmatter link value points to. */
export function linkedTarget<T extends { path: string }>(raw: unknown, resolve: ResolveTarget<T>): T | null {
	const text = linkText(raw);
	return text ? resolve(text) : null;
}

/** Resolved notes an Action names in mtm-people and mtm-waiting-on. */
export function peoplePaths(fm: Readonly<Frontmatter>, resolve: ResolveTarget): Set<string> {
	const raw = fm['mtm-people'];
	const values: unknown[] = [...(Array.isArray(raw) ? (raw as unknown[]) : [raw]), fm['mtm-waiting-on']];
	const out = new Set<string>();
	for (const v of values) {
		const target = linkedTarget(v, resolve);
		if (target) out.add(target.path);
	}
	return out;
}

/**
 * Reverse index of people: for every note an Action names in mtm-waiting-on or mtm-people, the Actions that
 * name it and whether they wait on it. `resolveFrom` resolves links from an Action; `itemOf` is asked only for
 * Actions that name someone.
 */
export function peopleIndex<T extends NoteData>(
	actions: readonly T[],
	resolveFrom: (sourcePath: string) => ResolveTarget,
	itemOf: (note: T) => ActionItem,
): Map<string, PersonEntry[]> {
	const index = new Map<string, PersonEntry[]>();
	for (const note of actions) {
		const fm = note.frontmatter ?? {};
		const resolve = resolveFrom(note.path);
		const people = peoplePaths(fm, resolve);
		if (!people.size) continue;
		const item = itemOf(note);
		const waitingOn = linkedTarget(fm['mtm-waiting-on'], resolve)?.path ?? null;
		for (const path of people) {
			const list = index.get(path) ?? [];
			list.push({ item, waiting: path === waitingOn });
			index.set(path, list);
		}
	}
	return index;
}

export interface PersonCandidate extends NoteCandidate {
	name: string;
	folder: string;
	inPeople: boolean;
}

/** The folder of a path, '' at the vault's root. */
export function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * Who quick add's `@` can name: every note without mtm-kind (Actions and Matters are never people),
 * those in the people folder first. `peopleFolder` is the normalised folder path.
 */
export function personCandidates(notes: readonly NoteData[], peopleFolder: string): PersonCandidate[] {
	const prefix = peopleFolder + '/';
	return notes
		.filter((n) => n.frontmatter?.['mtm-kind'] === undefined)
		.map((n) => {
			const inPeople = n.path.startsWith(prefix);
			return { path: n.path, name: n.basename, names: [n.basename], rank: inPeople ? 0 : 1, inPeople, folder: folderOf(n.path) };
		});
}

// ——— Links in an Action's body ———

const withoutHeading = (link: string) => link.split('#')[0] ?? '';

/**
 * Linked notes: the resolved targets of the body's links (`links`, as written, headings allowed) that are notes,
 * other than the note itself and the excluded paths (its Matter and people), each once, in order.
 */
export function linkedNotes<T extends LinkTarget>(links: readonly string[], sourcePath: string, resolve: ResolveTarget<T>, exclude: ReadonlySet<string>): T[] {
	const out = new Map<string, T>();
	for (const link of links) {
		const target = resolve(withoutHeading(link));
		if (target && target.extension === 'md' && target.path !== sourcePath && !exclude.has(target.path)) out.set(target.path, target);
	}
	return [...out.values()];
}

/** Attachments: the resolved targets of the body's embeds that are not notes, each once, in order. */
export function attachments<T extends LinkTarget>(embeds: readonly string[], resolve: ResolveTarget<T>): T[] {
	const out = new Map<string, T>();
	for (const embed of embeds) {
		const target = resolve(withoutHeading(embed));
		if (target && target.extension !== 'md') out.set(target.path, target);
	}
	return [...out.values()];
}
